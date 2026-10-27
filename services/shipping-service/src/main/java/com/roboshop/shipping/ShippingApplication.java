package com.roboshop.shipping;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import com.zaxxer.hikari.HikariDataSource;
import tools.jackson.databind.ObjectMapper;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;

@SpringBootApplication
public class ShippingApplication {
    public static void main(String[] args) throws Exception {
        // Verify deployed location data; schema checks remain compatible with existing databases.
        // Migrator serializes concurrent starts with a PostgreSQL advisory lock.
        // Fail before opening HTTP or consuming messages if initialization fails.
        // Spring has not configured logging yet; keep the migration pool's INFO
        // chatter out of the JSON stream. Spring resets levels when it starts.
        ((ch.qos.logback.classic.Logger) org.slf4j.LoggerFactory.getLogger("com.zaxxer.hikari")).setLevel(ch.qos.logback.classic.Level.WARN);
        try (var pool = Database.pool(true)) { Migrator.run(pool); }
        catch (Exception error) {
            // Spring's structured logging is not initialized yet; emit the same
            // single-line JSON shape instead of a multi-line stack trace.
            System.out.println(startupFailure(error, Instant.now()));
            System.exit(1);
        }
        SpringApplication.run(ShippingApplication.class, args);
    }
    static String startupEvent(String event, String level, Instant now, Map<String, Object> fields) {
        Map<String, Object> record = new LinkedHashMap<>();
        record.put("@timestamp", now.toString());
        record.put("level", level);
        record.put("service", "shipping-service");
        record.put("event", event);
        record.putAll(fields);
        return new ObjectMapper().writeValueAsString(record);
    }
    static String startupFailure(Throwable error, Instant now) {
        Throwable root = error;
        while (root.getCause() != null && root.getCause() != root) root = root.getCause();
        // Our own validation messages are safe; driver messages can carry connection details.
        boolean own = root instanceof IllegalStateException || root instanceof IllegalArgumentException;
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("errorType", root.getClass().getSimpleName());
        fields.put("reason", own ? root.getMessage() : "See errorType; dependency message omitted");
        return startupEvent("startup_failed", "ERROR", now, fields);
    }
    @Bean(destroyMethod = "close")
    HikariDataSource dataSource() { return Database.pool(false); }
}
