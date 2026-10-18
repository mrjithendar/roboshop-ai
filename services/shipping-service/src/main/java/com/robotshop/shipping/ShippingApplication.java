package com.robotshop.shipping;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import com.zaxxer.hikari.HikariDataSource;

@SpringBootApplication
public class ShippingApplication {
    public static void main(String[] args) throws Exception {
        if (java.util.Arrays.asList(args).contains("--migrate")) {
            try (var pool = Database.pool(true)) { Migrator.run(pool); }
            return;
        }
        SpringApplication.run(ShippingApplication.class, args);
    }
    @Bean(destroyMethod = "close")
    HikariDataSource dataSource() { return Database.pool(false); }
}
