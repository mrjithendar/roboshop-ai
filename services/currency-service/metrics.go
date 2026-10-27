package main

import (
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"
)

// Prometheus default-style latency buckets in seconds; cumulative per route.
var latencyBounds = []float64{0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10}

type routeLatency struct {
	buckets []uint64
	sum     float64
	count   uint64
}

// metrics uses the same series names as the Python and Node services so one
// Grafana query covers every service. Routes are fixed templates, never raw paths.
type metrics struct {
	mu            sync.Mutex
	requests      map[[2]string]uint64 // {route, status}
	latency       map[string]*routeLatency
	refreshFailed uint64
	started       time.Time
}

var serviceMetrics = &metrics{requests: map[[2]string]uint64{}, latency: map[string]*routeLatency{}, started: time.Now()}

func (m *metrics) observe(route string, status int, elapsed time.Duration) {
	seconds := elapsed.Seconds()
	m.mu.Lock()
	defer m.mu.Unlock()
	m.requests[[2]string{route, strconv.Itoa(status)}]++
	l := m.latency[route]
	if l == nil {
		l = &routeLatency{buckets: make([]uint64, len(latencyBounds))}
		m.latency[route] = l
	}
	for i, bound := range latencyBounds {
		if seconds <= bound {
			l.buckets[i]++
		}
	}
	l.sum += seconds
	l.count++
}

func (m *metrics) refreshFailure() {
	m.mu.Lock()
	m.refreshFailed++
	m.mu.Unlock()
}

func (m *metrics) write(w http.ResponseWriter, c *rateCache, now time.Time) {
	w.Header().Set("Content-Type", "text/plain; version=0.0.4")
	m.mu.Lock()
	defer m.mu.Unlock()
	const svc = `service="currency-service"`
	fmt.Fprintln(w, "# TYPE roboshop_http_requests_total counter")
	keys := make([][2]string, 0, len(m.requests))
	for k := range m.requests {
		keys = append(keys, k)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i][0]+keys[i][1] < keys[j][0]+keys[j][1] })
	for _, k := range keys {
		fmt.Fprintf(w, "roboshop_http_requests_total{%s,route=%q,status=%q} %d\n", svc, k[0], k[1], m.requests[k])
	}
	fmt.Fprintln(w, "# TYPE http_server_request_duration_seconds histogram")
	routes := make([]string, 0, len(m.latency))
	for r := range m.latency {
		routes = append(routes, r)
	}
	sort.Strings(routes)
	for _, r := range routes {
		l := m.latency[r]
		for i, bound := range latencyBounds {
			fmt.Fprintf(w, "http_server_request_duration_seconds_bucket{%s,route=%q,le=%q} %d\n", svc, r, strconv.FormatFloat(bound, 'g', -1, 64), l.buckets[i])
		}
		fmt.Fprintf(w, "http_server_request_duration_seconds_bucket{%s,route=%q,le=\"+Inf\"} %d\n", svc, r, l.count)
		fmt.Fprintf(w, "http_server_request_duration_seconds_sum{%s,route=%q} %g\n", svc, r, l.sum)
		fmt.Fprintf(w, "http_server_request_duration_seconds_count{%s,route=%q} %d\n", svc, r, l.count)
	}
	fmt.Fprintln(w, "# TYPE roboshop_fx_refresh_failures_total counter")
	fmt.Fprintf(w, "roboshop_fx_refresh_failures_total{%s} %d\n", svc, m.refreshFailed)
	c.mu.RLock()
	checked, cached := c.checked, c.value != nil
	c.mu.RUnlock()
	if cached {
		fmt.Fprintln(w, "# TYPE roboshop_fx_rates_age_seconds gauge")
		fmt.Fprintf(w, "roboshop_fx_rates_age_seconds{%s} %g\n", svc, now.Sub(checked).Seconds())
	}
	fmt.Fprintln(w, "# TYPE roboshop_process_start_time_seconds gauge")
	fmt.Fprintf(w, "roboshop_process_start_time_seconds{%s} %d\n", svc, m.started.Unix())
}
