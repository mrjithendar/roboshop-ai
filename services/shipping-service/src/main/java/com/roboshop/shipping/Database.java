package com.roboshop.shipping;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;

final class Database {
    static HikariDataSource pool(boolean migration) {
        String url = migration ? System.getenv("SHIPPING_MIGRATION_DATABASE_URL") : null;
        if (url == null || url.isBlank()) url = System.getenv("SHIPPING_DATABASE_URL");
        if (url == null || url.isBlank()) throw new IllegalArgumentException("SHIPPING_DATABASE_URL is required");
        URI uri = URI.create(url);
        if (!"postgresql".equals(uri.getScheme()) || uri.getHost() == null || uri.getRawQuery() != null || uri.getFragment() != null)
            throw new IllegalArgumentException("Use a postgresql:// URL without query parameters; configure TLS with SHIPPING_DB_TLS and SHIPPING_DB_CA_FILE");
        var config = new HikariConfig();
        String host = uri.getHost();
        config.setJdbcUrl("jdbc:postgresql://" + host + ":" + (uri.getPort() < 0 ? 5432 : uri.getPort()) + uri.getRawPath());
        String userInfo = uri.getRawUserInfo();
        if (userInfo != null) {
            String[] parts = userInfo.split(":", 2);
            config.setUsername(decode(parts[0]));
            if (parts.length == 2) config.setPassword(decode(parts[1]));
        }
        config.addDataSourceProperty("sslmode", "false".equals(System.getenv("SHIPPING_DB_TLS")) ? "disable" : "verify-full");
        String ca = System.getenv("SHIPPING_DB_CA_FILE");
        if (ca != null && !ca.isBlank()) config.addDataSourceProperty("sslrootcert", ca);
        config.addDataSourceProperty("ApplicationName", "roboshop-shipping");
        config.addDataSourceProperty("connectTimeout", "5");
        config.addDataSourceProperty("socketTimeout", "15");
        config.addDataSourceProperty("options", "-c statement_timeout=10000");
        config.setMaximumPoolSize(migration ? 2 : 10);
        config.setMinimumIdle(1);
        config.setConnectionTimeout(5000);
        config.setValidationTimeout(2000);
        config.setPoolName("shipping-postgres");
        return new HikariDataSource(config);
    }
    private static String decode(String s) { return URLDecoder.decode(s.replace("+", "%2B"), StandardCharsets.UTF_8); }
}
