package main

// Service-local OTLP/HTTP exporter: fixed names, bounded concurrency, no payloads.
import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

type traceKey struct{}
type traceContext struct{ ID, Span, Parent, Flags, State string }

var validParent = regexp.MustCompile(`^00-([a-f0-9]{32})-([a-f0-9]{16})-(0[01])$`)
var exportSlots = make(chan struct{}, 8)

func randomID(n int) string { b := make([]byte, n); _, _ = rand.Read(b); return hex.EncodeToString(b) }
func startTrace(ctx context.Context, parent, state string) (context.Context, traceContext) {
	t := traceContext{ID: randomID(16), Span: randomID(8), Flags: "01"}
	if p, ok := ctx.Value(traceKey{}).(traceContext); ok {
		t.ID = p.ID
		t.Parent = p.Span
		t.Flags = p.Flags
		t.State = p.State
	}
	if m := validParent.FindStringSubmatch(parent); m != nil && strings.Trim(m[1], "0") != "" && strings.Trim(m[2], "0") != "" {
		t.ID = m[1]
		t.Parent = m[2]
		t.Flags = m[3]
		if len(state) <= 512 && !strings.ContainsAny(state, "\r\n") {
			t.State = state
		}
	}
	return context.WithValue(ctx, traceKey{}, t), t
}
func (t traceContext) header() string { return "00-" + t.ID + "-" + t.Span + "-" + t.Flags }
func envOr(k, v string) string {
	if x := os.Getenv(k); x != "" {
		return x
	}
	return v
}
func exportTrace(t traceContext, start time.Time, name string, kind int, status int, attrs map[string]string) {
	endpoint := os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")
	if endpoint == "" || os.Getenv("OTEL_SDK_DISABLED") == "true" || t.Flags == "00" {
		return
	}
	route := attrs["http.route"]
	if status < 400 && (route == "/health" || route == "/ready" || route == "/metrics") {
		return
	}
	attributes := []any{}
	for k, v := range attrs {
		attributes = append(attributes, map[string]any{"key": k, "value": map[string]string{"stringValue": v}})
	}
	resources := []any{}
	for k, v := range map[string]string{"service.name": "currency-service", "service.namespace": envOr("OTEL_SERVICE_NAMESPACE", "roboshop-ai"), "service.version": envOr("OTEL_SERVICE_VERSION", "unknown"), "service.instance.id": envOr("POD_UID", envOr("HOSTNAME", "local")), "deployment.environment.name": envOr("DEPLOYMENT_ENVIRONMENT", "development")} {
		resources = append(resources, map[string]any{"key": k, "value": map[string]string{"stringValue": v}})
	}
	code := 0
	if status >= 400 {
		code = 2
	}
	span := map[string]any{"traceId": t.ID, "spanId": t.Span, "name": name, "kind": kind, "flags": 1, "traceState": t.State, "startTimeUnixNano": strconv.FormatInt(start.UnixNano(), 10), "endTimeUnixNano": strconv.FormatInt(time.Now().UnixNano(), 10), "attributes": attributes, "status": map[string]int{"code": code}}
	if t.Parent != "" {
		span["parentSpanId"] = t.Parent
	}
	payload, _ := json.Marshal(map[string]any{"resourceSpans": []any{map[string]any{"resource": map[string]any{"attributes": resources}, "scopeSpans": []any{map[string]any{"scope": map[string]string{"name": "roboshop.currency"}, "spans": []any{span}}}}}})
	select {
	case exportSlots <- struct{}{}:
	default:
		return
	}
	go func() {
		defer func() { <-exportSlots }()
		ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel()
		req, err := http.NewRequestWithContext(ctx, "POST", endpoint, bytes.NewReader(payload))
		if err != nil {
			return
		}
		req.Header.Set("Content-Type", "application/json")
		res, err := http.DefaultClient.Do(req)
		if err == nil {
			res.Body.Close()
		}
	}()
}
func drainTraces() {
	end := time.Now().Add(2 * time.Second)
	for len(exportSlots) > 0 && time.Now().Before(end) {
		time.Sleep(10 * time.Millisecond)
	}
}
