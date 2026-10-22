// Currency service provides display estimates only, never payment amounts.
package main

import (
	"context"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"math"
	"net/http"
	"os"
	"os/signal"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const sourceURL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml"

var codePattern = regexp.MustCompile(`^[A-Z]{3}$`)
var countries = func() map[string]string {
	m := map[string]string{"LI": "CHF"}
	territories := strings.Fields("US GB IN JP CN AU CA CH NZ SG HK KR ID MY PH TH ZA BR MX NO SE DK PL CZ HU RO TR IL IS")
	currencies := strings.Fields("USD GBP INR JPY CNY AUD CAD CHF NZD SGD HKD KRW IDR MYR PHP THB ZAR BRL MXN NOK SEK DKK PLN CZK HUF RON TRY ILS ISK")
	for i, country := range territories {
		m[country] = currencies[i]
	}
	for _, country := range strings.Fields("AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK") {
		m[country] = "EUR"
	}
	return m
}()

type quote struct {
	Base              string             `json:"base"`
	Rates             map[string]float64 `json:"rates"`
	AsOf              string             `json:"asOf"`
	Source            string             `json:"source"`
	DisplayOnly       bool               `json:"displayOnly"`
	Stale             bool               `json:"stale"`
	SuggestedCurrency *string            `json:"suggestedCurrency"`
}
type cube struct {
	Time     string `xml:"time,attr"`
	Currency string `xml:"currency,attr"`
	Rate     string `xml:"rate,attr"`
	Children []cube `xml:"Cube"`
}

func validDate(value string, now time.Time) bool {
	day, err := time.Parse("2006-01-02", value)
	age := now.UTC().Truncate(24 * time.Hour).Sub(day)
	return err == nil && age >= 0 && age <= 7*24*time.Hour
}
func parseRates(raw []byte, now time.Time) (*quote, error) {
	var envelope struct {
		Cubes []cube `xml:"Cube"`
	}
	if err := xml.Unmarshal(raw, &envelope); err != nil {
		return nil, err
	}
	var dated []cube
	var walk func([]cube)
	walk = func(nodes []cube) {
		for _, n := range nodes {
			if n.Time != "" {
				dated = append(dated, n)
			}
			walk(n.Children)
		}
	}
	walk(envelope.Cubes)
	if len(dated) != 1 || !validDate(dated[0].Time, now) {
		return nil, errors.New("invalid rate date")
	}
	rates := map[string]float64{"EUR": 1}
	for _, item := range dated[0].Children {
		rate, err := strconv.ParseFloat(item.Rate, 64)
		if err != nil || !codePattern.MatchString(item.Currency) || rates[item.Currency] != 0 || math.IsNaN(rate) || math.IsInf(rate, 0) || rate < 0.000001 || rate > 1000000 {
			return nil, errors.New("invalid exchange rate")
		}
		rates[item.Currency] = rate
	}
	if rates["USD"] == 0 || rates["INR"] == 0 {
		return nil, errors.New("incomplete feed")
	}
	return &quote{Base: "EUR", Rates: rates, AsOf: dated[0].Time, Source: sourceURL, DisplayOnly: true}, nil
}

type rateCache struct {
	mu      sync.RWMutex
	value   *quote // Immutable after publication; refresh swaps the pointer.
	checked time.Time
	client  *http.Client
}

func (c *rateCache) refresh(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return err
	}
	resp, err := c.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return errors.New("exchange feed unavailable")
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 65537))
	if err != nil {
		return err
	}
	if len(raw) > 65536 {
		return errors.New("oversized feed")
	}
	value, err := parseRates(raw, time.Now())
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.value = value
	c.checked = time.Now()
	c.mu.Unlock()
	return nil
}
func (c *rateCache) snapshot(country string, now time.Time) *quote {
	c.mu.RLock()
	defer c.mu.RUnlock()
	if c.value == nil || !validDate(c.value.AsOf, now) {
		return nil
	}
	result := *c.value
	result.Stale = now.Sub(c.checked) > 2*time.Hour
	if currency := countries[strings.ToUpper(country)]; result.Rates[currency] > 0 {
		result.SuggestedCurrency = &currency
	}
	return &result
}
func (c *rateCache) run(ctx context.Context) {
	ticker := time.NewTicker(time.Hour)
	defer ticker.Stop()
	for {
		if err := c.refresh(ctx); err != nil && ctx.Err() == nil {
			slog.Warn("fx_refresh_failed", "service", "currency-service", "action", "retaining_unexpired_cache", "errorCode", "FX_REFRESH_FAILED", "errorType", fmt.Sprintf("%T", err), "retryAfterSeconds", 3600)
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
func (c *rateCache) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	started := time.Now()
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	status := http.StatusOK
	var body any
	if r.Method != http.MethodGet {
		status = http.StatusMethodNotAllowed
		w.Header().Set("Allow", "GET")
		body = map[string]string{"error": "Method not allowed"}
	} else {
		switch r.URL.Path {
		case "/health":
			body = map[string]string{"status": "ok"}
		case "/ready", "/rates":
			if result := c.snapshot(r.URL.Query().Get("country"), time.Now()); result != nil {
				body = result
			} else {
				status = http.StatusServiceUnavailable
				body = map[string]string{"error": "Currency estimates unavailable; use original listing currency."}
			}
		default:
			status = http.StatusNotFound
			body = map[string]string{"error": "Not found"}
		}
	}
	route := "other"
	switch r.URL.Path {
	case "/health", "/ready", "/rates":
		route = r.URL.Path
	}
	if status >= 400 || route == "/rates" || route == "other" {
		level := slog.LevelInfo
		if status >= 400 {
			level = slog.LevelWarn
		}
		slog.Log(r.Context(), level, "request_completed", "service", "currency-service", "method", r.Method, "route", route, "status", status, "durationMs", time.Since(started).Milliseconds())
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}
func main() {
	level := slog.LevelInfo
	switch os.Getenv("LOG_LEVEL") {
	case "DEBUG":
		level = slog.LevelDebug
	case "WARN":
		level = slog.LevelWarn
	case "ERROR":
		level = slog.LevelError
	}
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level})))
	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()
	cache := &rateCache{client: &http.Client{Timeout: 5 * time.Second}}
	go cache.run(ctx)
	server := &http.Server{Addr: ":4111", Handler: cache, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second, IdleTimeout: 30 * time.Second, MaxHeaderBytes: 8192}
	go func() {
		<-ctx.Done()
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdown)
	}()
	slog.Info("service_listening", "service", "currency-service", "port", 4111)
	if err := server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("server_failed", "service", "currency-service", "errorType", "http_server_error")
		os.Exit(1)
	}
}
