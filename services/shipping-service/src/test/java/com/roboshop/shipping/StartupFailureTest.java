package com.roboshop.shipping;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.ObjectMapper;
import java.sql.SQLException;
import java.time.Instant;
import java.util.Map;
import static org.junit.jupiter.api.Assertions.*;

class StartupFailureTest {
    @SuppressWarnings("unchecked")
    private Map<String, Object> parse(Throwable error) {
        String line = ShippingApplication.startupFailure(error, Instant.parse("2026-10-27T00:00:00Z"));
        assertFalse(line.contains("\\n"), "one line per record");
        return new ObjectMapper().readValue(line, Map.class);
    }
    @Test void ownValidationMessageIsKept() {
        var record = parse(new RuntimeException(new IllegalStateException("Shipping locations are not imported.")));
        assertEquals("startup_failed", record.get("event"));
        assertEquals("ERROR", record.get("level"));
        assertEquals("IllegalStateException", record.get("errorType"));
        assertEquals("Shipping locations are not imported.", record.get("reason"));
    }
    @Test void driverMessageIsOmitted() {
        var record = parse(new SQLException("Connection to db-host:5432 refused for user shipping"));
        assertEquals("SQLException", record.get("errorType"));
        assertFalse(record.get("reason").toString().contains("db-host"));
    }
}
