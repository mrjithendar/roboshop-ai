package main

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func feed(day time.Time, rate string) string {
	return fmt.Sprintf(`<Envelope><Cube><Cube time="%s"><Cube currency="USD" rate="1.2"/><Cube currency="INR" rate="%s"/></Cube></Cube></Envelope>`, day.UTC().Format("2006-01-02"), rate)
}
func testCache(t *testing.T) *rateCache {
	t.Helper()
	value, err := parseRates([]byte(feed(time.Now(), "90")), time.Now())
	if err != nil {
		t.Fatal(err)
	}
	return &rateCache{value: value, checked: time.Now()}
}
func TestRatesAndCountry(t *testing.T) {
	c := testCache(t)
	for country, currency := range map[string]string{"in": "INR", "US": "USD", "ZZ": ""} {
		q := c.snapshot(country, time.Now())
		got := ""
		if q.SuggestedCurrency != nil {
			got = *q.SuggestedCurrency
		}
		if got != currency || q.Base != "EUR" || !q.DisplayOnly || q.Rates["INR"] != 90 {
			t.Fatalf("unexpected quote: %+v", q)
		}
	}
}
func TestInvalidFeeds(t *testing.T) {
	for _, rate := range []string{"NaN", "Inf", "0", "-1", "1000001", "x"} {
		if _, err := parseRates([]byte(feed(time.Now(), rate)), time.Now()); err == nil {
			t.Fatal(rate)
		}
	}
	for _, days := range []int{-8, 1} {
		if _, err := parseRates([]byte(feed(time.Now().AddDate(0, 0, days), "90")), time.Now()); err == nil {
			t.Fatal(days)
		}
	}
	for _, raw := range []string{"broken", `<Envelope/>`, strings.Replace(feed(time.Now(), "90"), "INR", "USD", 1)} {
		if _, err := parseRates([]byte(raw), time.Now()); err == nil {
			t.Fatal(raw)
		}
	}
}
func TestCacheExpiryAndHealth(t *testing.T) {
	c := testCache(t)
	c.checked = time.Now().Add(-3 * time.Hour)
	if !c.snapshot("IN", time.Now()).Stale {
		t.Fatal("expected stale")
	}
	c.value.AsOf = time.Now().AddDate(0, 0, -8).UTC().Format("2006-01-02")
	for path, status := range map[string]int{"/health": 200, "/ready": 503, "/rates": 503, "/missing": 404} {
		w := httptest.NewRecorder()
		c.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != status {
			t.Fatal(path, w.Code)
		}
	}
	w := httptest.NewRecorder()
	c.ServeHTTP(w, httptest.NewRequest("POST", "/rates", nil))
	if w.Code != 405 {
		t.Fatal(w.Code)
	}
}

type transport func(*http.Request) (*http.Response, error)

func (f transport) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }
func TestRefreshFailureRecoveryAndBounds(t *testing.T) {
	c := testCache(t)
	for _, scenario := range []string{"timeout", "large", "status", "valid"} {
		c.client = &http.Client{Transport: transport(func(r *http.Request) (*http.Response, error) {
			if r.URL.String() != sourceURL {
				t.Fatal("unexpected source")
			}
			if _, ok := r.Context().Deadline(); !ok {
				t.Fatal("missing deadline")
			}
			if scenario == "timeout" {
				return nil, context.DeadlineExceeded
			}
			body, status := feed(time.Now(), "91"), 200
			if scenario == "large" {
				body = strings.Repeat("x", 65537)
			}
			if scenario == "status" {
				status = 503
			}
			return &http.Response{StatusCode: status, Body: io.NopCloser(strings.NewReader(body)), Header: make(http.Header)}, nil
		})}
		err := c.refresh(context.Background())
		if scenario == "valid" {
			if err != nil || c.snapshot("IN", time.Now()).Rates["INR"] != 91 {
				t.Fatal("recovery", err)
			}
		} else if err == nil || c.snapshot("IN", time.Now()).Rates["INR"] != 90 {
			t.Fatal("cache changed on failure")
		}
	}
}
func TestConcurrentRefreshAndRequests(t *testing.T) {
	c := testCache(t)
	c.client = &http.Client{Transport: transport(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, Body: io.NopCloser(strings.NewReader(feed(time.Now(), "92")))}, nil
	})}
	var wg sync.WaitGroup
	for i := 0; i < 50; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if err := c.refresh(context.Background()); err != nil {
				t.Error(err)
			}
			w := httptest.NewRecorder()
			c.ServeHTTP(w, httptest.NewRequest("GET", "/rates?country=IN", nil))
			if w.Code != 200 {
				t.Error(w.Code)
			}
		}()
	}
	wg.Wait()
}
