package com.roboshop.shipping;

import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.core.read.ListAppender;
import ch.qos.logback.classic.spi.ILoggingEvent;
import org.slf4j.LoggerFactory;
import static org.junit.jupiter.api.Assertions.*;

class RequestLoggingTest {
    @Test void logsSafeRouteAndTraceWithoutAddressQueryOrBody() throws Exception {
        Logger logger=(Logger)LoggerFactory.getLogger(RequestLogging.class);
        var logs=new ListAppender<ILoggingEvent>();logs.start();logger.addAppender(logs);
        try {
            var req=new MockHttpServletRequest("POST","/api/shipping/quote");
            req.setQueryString("address=private-address");req.setContent("private-address".getBytes());
            req.addHeader("Authorization","Bearer secret");
            req.addHeader("traceparent","00-"+"a".repeat(32)+"-"+"b".repeat(16)+"-01");
            var response=new MockHttpServletResponse();
            new RequestLogging().doFilter(req,response,(r,s)->((jakarta.servlet.http.HttpServletResponse)s).setStatus(503));
            assertEquals("a".repeat(32),response.getHeader("X-Request-ID"));
            assertEquals(1,logs.list.size());
            String line=logs.list.getFirst().getFormattedMessage();
            assertTrue(line.contains("status=503"));assertTrue(line.contains("/api/shipping/quote"));
            assertFalse(line.contains("private-address"));assertFalse(line.contains("secret"));
        } finally { logger.detachAppender(logs);logs.stop(); }
    }
}
