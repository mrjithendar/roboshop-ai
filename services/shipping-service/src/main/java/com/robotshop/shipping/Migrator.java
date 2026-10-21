package com.robotshop.shipping;

import javax.sql.DataSource;
import tools.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

final class Migrator {
    static byte[] resource(String path) throws Exception {
        try (var in = Migrator.class.getResourceAsStream(path)) {
            if (in == null) throw new IllegalStateException("Missing migration resource");
            return in.readAllBytes();
        }
    }
    static String hash(byte[] bytes) throws Exception { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes)); }
    static void run(DataSource pool) throws Exception {
        var mapper = new ObjectMapper();
        try (var connection = pool.getConnection()) {
            connection.setAutoCommit(false);
            try (var statement = connection.createStatement()) {
                statement.execute("SELECT pg_advisory_xact_lock(74103106)");
                statement.execute("CREATE TABLE IF NOT EXISTS public.shipping_migrations (version integer PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
                for (int version=1; version<=2; version++) {
                byte[] sql = resource(version==1 ? "/migrations/001_locations.sql" : "/migrations/002_shipments.sql");
                String checksum = hash(sql);
                boolean applied;
                try (var rows = statement.executeQuery("SELECT checksum FROM public.shipping_migrations WHERE version="+version)) {
                    applied = rows.next();
                    if (applied && !checksum.equals(rows.getString(1))) throw new IllegalStateException("Applied migration checksum changed");
                }
                if (!applied) {
                    statement.execute(new String(sql,StandardCharsets.UTF_8));
                    try (var insert = connection.prepareStatement("INSERT INTO public.shipping_migrations(version,checksum) VALUES(?,?)")) { insert.setInt(1,version); insert.setString(2,checksum); insert.executeUpdate(); }
                }
                }
                String seedHash = mapper.readTree(resource("/data/manifest.json")).get("sha256").asText();
                boolean seeded;
                try (var rows = statement.executeQuery("SELECT value FROM shipping.metadata WHERE key='seed'")) { seeded = rows.next() && seedHash.equals(rows.getString(1)); }
                if (!seeded) {
                    throw new IllegalStateException("Shipping locations are not imported. Deploy services/postgres/shipping.sql before starting shipping-service.");
                }
                // Local database role; externally provisioned roles receive grants from the DBA.
                statement.execute("DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname='shipping_app') THEN GRANT INSERT ON shipping.shipment_requests TO shipping_app; END IF; END $$");
                connection.commit();
                System.out.println("Shipping schema ready; deployed location seed verified.");
            } catch (Exception e) { connection.rollback(); throw e; }
        }
    }
}
