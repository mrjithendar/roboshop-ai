package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"
)

func TestTracePropagationAndPrivacy(t *testing.T) {
	ctx, parent := startTrace(context.Background(), "00-"+strings.Repeat("a", 32)+"-"+strings.Repeat("b", 16)+"-01", "vendor=value")
	_, child := startTrace(ctx, "", "")
	if child.ID != parent.ID || child.Parent != parent.Span || child.State != "vendor=value" {
		t.Fatal("broken propagation")
	}
	sent := make(chan map[string]any, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		json.NewDecoder(r.Body).Decode(&body)
		sent <- body
	}))
	defer server.Close()
	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", server.URL)
	t.Setenv("OTEL_SERVICE_VERSION", "test-sha")
	exportTrace(child, time.Now(), "GET /health", 2, 200, map[string]string{"http.route": "/health"})
	select {
	case <-sent:
		t.Fatal("successful health exported")
	case <-time.After(20 * time.Millisecond):
	}
	exportTrace(child, time.Now(), "GET /health", 2, 503, map[string]string{"http.route": "/health"})
	select {
	case payload := <-sent:
		raw, _ := json.Marshal(payload)
		if !strings.Contains(string(raw), "test-sha") || !strings.Contains(string(raw), parent.Span) {
			t.Fatal("missing resources/parent")
		}
	case <-time.After(time.Second):
		t.Fatal("error not exported")
	}
	drainTraces()
}

func TestClientResponseStatusIsNotTransportError(t *testing.T) {
	sent := make(chan map[string]any, 20)
	collector := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var payload map[string]any
		json.NewDecoder(r.Body).Decode(&payload)
		span := payload["resourceSpans"].([]any)[0].(map[string]any)["scopeSpans"].([]any)[0].(map[string]any)["spans"].([]any)[0].(map[string]any)
		if span["kind"].(float64) == 3 {
			sent <- span
		}
	}))
	defer collector.Close()
	t.Setenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT", collector.URL)
	for _, status := range []int{429, 400, 503, 200, 0} {
		c := &rateCache{client: &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
			if status == 0 {
				return nil, context.DeadlineExceeded
			}
			return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader("invalid feed")), Header: make(http.Header)}, nil
		})}}
		_ = c.refresh(context.Background())
		select {
		case span := <-sent:
			var actual any
			for _, raw := range span["attributes"].([]any) {
				a := raw.(map[string]any)
				if a["key"] == "http.response.status_code" {
					actual = a["value"].(map[string]any)["intValue"]
				}
			}
			if status == 0 && actual != nil {
				t.Fatalf("invented response: %v", actual)
			}
			if status != 0 && actual != strconv.Itoa(status) {
				t.Fatalf("got %v expected %d", actual, status)
			}
		case <-time.After(time.Second):
			t.Fatal("no client span")
		}
	}
	drainTraces()
}
