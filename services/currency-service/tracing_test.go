package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
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
