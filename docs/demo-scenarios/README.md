# Demo scenarios

1. Run `npm run dev`; open http://localhost:3000. Search `mining`, select in-stock,
   and sort by price. The mining robot costs €42.
2. Open Find my match and ask `security under 1000 euros`. Expect the €700 Responsive
   Enforcer Droid. Without credentials, the panel explicitly labels catalogue search.
3. Add the recommendation to the bag. Reload and reopen the bag; it persists.
4. With Razorpay TEST keys and webhook configured, click Pay securely and complete a
   sandbox checkout. Expect an empty bag only after captured-payment verification.
   Without payment settings, the button stays disabled and explains why. Do not run
   live payments as part of a demo or automated test.
5. Open System status: health probes and timestamp appear. Stop a dependency and refresh
   to see degraded status and read-only runbook guidance.
6. With Compose available, inspect Prometheus requests and the matching trace in Jaeger.
   Correlate the x-request-id response header with the structured logs.
7. Run `npm test` and `npm run evaluate` for repeatable automated verification.
