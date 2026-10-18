package com.robotshop.shipping;

import javax.sql.DataSource;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.Locale;
import java.util.zip.GZIPInputStream;

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
                    byte[] raw;
                    try (var gzip = new GZIPInputStream(Migrator.class.getResourceAsStream("/data/locations.json.gz"))) { raw = gzip.readAllBytes(); }
                    if (!seedHash.equals(hash(raw))) throw new IllegalStateException("Location seed checksum mismatch");
                    var seed = mapper.readTree(raw);
                    statement.execute("DELETE FROM shipping.cities; DELETE FROM shipping.countries");
                    try (var insert = connection.prepareStatement("INSERT INTO shipping.countries VALUES (?,?)")) {
                        for (var row : seed.get("countries")) { insert.setString(1,row.get(0).asText()); insert.setString(2,row.get(1).asText()); insert.addBatch(); }
                        insert.executeBatch();
                    }
                    try (var insert = connection.prepareStatement("INSERT INTO shipping.cities VALUES (?,?,?,?,?,?,?)")) {
                        int count=0;
                        for (var row : seed.get("cities")) {
                            insert.setInt(1,row.get(0).asInt()); insert.setString(2,row.get(1).asText()); insert.setString(3,row.get(2).asText());
                            insert.setString(4,row.get(3).asText().toLowerCase(Locale.ROOT)); insert.setString(5,row.get(4).asText());
                            insert.setDouble(6,row.get(5).asDouble()); insert.setDouble(7,row.get(6).asDouble()); insert.addBatch();
                            if (++count % 1000 == 0) insert.executeBatch();
                        }
                        insert.executeBatch();
                    }
                    try (var insert = connection.prepareStatement("INSERT INTO shipping.metadata VALUES ('seed',?) ON CONFLICT (key) DO UPDATE SET value=excluded.value")) { insert.setString(1,seedHash); insert.executeUpdate(); }
                }
                // Local Compose role; externally provisioned roles receive grants from the DBA.
                statement.execute("DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname='shipping_app') THEN GRANT INSERT ON shipping.shipment_requests TO shipping_app; END IF; END $$");
                connection.commit();
                System.out.println("Shipping migrations and GeoNames seed applied.");
            } catch (Exception e) { connection.rollback(); throw e; }
        }
    }
}
