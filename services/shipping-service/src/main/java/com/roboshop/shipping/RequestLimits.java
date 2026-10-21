package com.roboshop.shipping;

import jakarta.servlet.*;
import jakarta.servlet.http.*;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;
import java.io.*;

@Component
class RequestLimits extends OncePerRequestFilter {
    @Override protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain) throws ServletException, IOException {
        response.setHeader("X-Content-Type-Options","nosniff");
        response.setHeader("Cache-Control","no-store");
        if ("POST".equals(request.getMethod()) && "/api/shipping/quote".equals(request.getRequestURI())) {
            byte[] body = request.getInputStream().readNBytes(16385);
            if (body.length > 16384) {
                response.setStatus(413); response.setContentType("application/json"); response.getWriter().write("{\"error\":\"Request is too large.\"}"); return;
            }
            var wrapped = new HttpServletRequestWrapper(request) {
                @Override public ServletInputStream getInputStream() {
                    var stream = new ByteArrayInputStream(body);
                    return new ServletInputStream() {
                        @Override public int read() { return stream.read(); }
                        @Override public boolean isFinished() { return stream.available()==0; }
                        @Override public boolean isReady() { return true; }
                        @Override public void setReadListener(ReadListener listener) { throw new UnsupportedOperationException(); }
                    };
                }
            };
            chain.doFilter(wrapped,response);
        } else chain.doFilter(request,response);
    }
}
