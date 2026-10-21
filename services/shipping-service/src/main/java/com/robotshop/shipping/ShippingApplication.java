package com.robotshop.shipping;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import com.zaxxer.hikari.HikariDataSource;

@SpringBootApplication
public class ShippingApplication {
    public static void main(String[] args) throws Exception {
        // Verify deployed location data; schema checks remain compatible with existing databases.
        // Migrator serializes concurrent starts with a PostgreSQL advisory lock.
        // Fail before opening HTTP or consuming messages if initialization fails.
        try (var pool = Database.pool(true)) { Migrator.run(pool); }
        SpringApplication.run(ShippingApplication.class, args);
    }
    @Bean(destroyMethod = "close")
    HikariDataSource dataSource() { return Database.pool(false); }
}
