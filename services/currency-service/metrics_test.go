package main

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestMetricsExposeRouteLatencyAndFxState(t *testing.T) {
	c := testCache(t)
	for _, path := range []string{"/rates", "/rates?country=IN", "/unknown/secret-path"} {
		c.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, path, nil))
	}
	rec := httptest.NewRecorder()
	c.ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	body := rec.Body.String()
	if rec.Code != http.StatusOK || !strings.HasPrefix(rec.Header().Get("Content-Type"), "text/plain") {
		t.Fatalf("unexpected metrics response %d %q", rec.Code, rec.Header().Get("Content-Type"))
	}
	for _, want := range []string{
		`roboshop_http_requests_total{service="currency-service",route="/rates",status="200"}`,
		`http_server_request_duration_seconds_bucket{service="currency-service",route="/rates",le="+Inf"}`,
		`http_server_request_duration_seconds_count{service="currency-service",route=""}`,
		`roboshop_fx_rates_age_seconds{service="currency-service"}`,
		`roboshop_fx_refresh_failures_total{service="currency-service"}`,
	} {
		if !strings.Contains(body, want) {
			t.Fatalf("metrics missing %s:\n%s", want, body)
		}
	}
	// Raw paths and query strings never become labels; the scrape itself is not counted.
	if strings.Contains(body, "secret-path") || strings.Contains(body, "country") || strings.Contains(body, `route="/metrics"`) {
		t.Fatalf("metrics leaked a raw path or counted scrapes:\n%s", body)
	}
}
