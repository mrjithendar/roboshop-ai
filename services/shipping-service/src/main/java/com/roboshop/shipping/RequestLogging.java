package com.roboshop.shipping;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import java.io.IOException;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/** Log route templates and timings, never shipping addresses, query text or bodies. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class RequestLogging extends OncePerRequestFilter {
    private static final Logger LOG = LoggerFactory.getLogger(RequestLogging.class);
    private static final Set<String> ROUTES = Set.of("/health", "/metrics", "/api/shipping/ready", "/api/shipping/countries", "/api/shipping/cities", "/api/shipping/quote");
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        long started = System.nanoTime();
        String route = ROUTES.contains(request.getRequestURI()) ? request.getRequestURI() : "other";
        String method = Set.of("GET","POST","PUT","DELETE","PATCH","OPTIONS","HEAD").contains(request.getMethod()) ? request.getMethod() : "other";
        String parent = request.getHeader("traceparent");
        String traceId = parent != null && parent.matches("00-[a-f0-9]{32}-[a-f0-9]{16}-0[01]") ? parent.substring(3,35) : UUID.randomUUID().toString().replace("-", "");
        response.setHeader("X-Request-ID", traceId);
        boolean failed = false;
        try { chain.doFilter(request, response); }
        catch (IOException | ServletException | RuntimeException error) {
            failed = true;
            LOG.error("request_failed service=shipping-service errorCode=SHIPPING_REQUEST_FAILED route={} traceId={} errorType={}", route, traceId, error.getClass().getSimpleName());
            throw error;
        } finally {
            int status = failed ? 500 : response.getStatus();
            if (status >= 400 || !Set.of("/health","/metrics","/api/shipping/ready").contains(route)) {
                if (status >= 400) LOG.warn("request_completed service=shipping-service method={} route={} status={} errorCode=HTTP_{} durationMs={} traceId={}", method, route, status, status, (System.nanoTime()-started)/1_000_000, traceId);
                else LOG.info("request_completed service=shipping-service method={} route={} status={} errorCode=HTTP_{} durationMs={} traceId={}", method, route, status, status, (System.nanoTime()-started)/1_000_000, traceId);
            }
        }
    }
}
