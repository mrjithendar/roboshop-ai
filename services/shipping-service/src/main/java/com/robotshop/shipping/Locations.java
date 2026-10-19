package com.robotshop.shipping;

import tools.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.HttpStatus;
import java.util.*;
import java.math.BigDecimal;
import java.text.Normalizer;
import java.time.Instant;

@Service
public class Locations {
    private final JdbcTemplate jdbc;
    private final String seedHash;
    private final LocationCache cache;
    public Locations(JdbcTemplate jdbc, ObjectMapper mapper, LocationCache cache) throws Exception {
        this.jdbc = jdbc;
        this.cache = cache;
        try (var in = getClass().getResourceAsStream("/data/manifest.json")) { seedHash = mapper.readTree(in).get("sha256").asText(); }
    }
    public void ready() {
        if (jdbc.queryForObject("SELECT to_regclass('shipping.shipment_requests') IS NOT NULL", Boolean.class) != Boolean.TRUE) throw new IllegalStateException("Shipping database needs migration");
        if (!seedHash.equals(jdbc.queryForObject("SELECT value FROM shipping.metadata WHERE key='seed'", String.class)))
            throw new IllegalStateException("Shipping database needs migration");
    }
    public List<Map<String,Object>> countries() {
        return cache.read(seedHash+":countries", java.time.Duration.ofHours(6), () -> jdbc.queryForList("SELECT code,name,(SELECT count(*)::integer FROM shipping.cities WHERE country_code=code) AS \"cityCount\" FROM shipping.countries ORDER BY name"));
    }
    public List<Map<String,Object>> search(String country, String query) {
        if (country == null || !country.matches("[A-Z]{2}") || jdbc.queryForObject("SELECT count(*) FROM shipping.countries WHERE code=?", Integer.class, country) == 0)
            throw bad("Select a valid country.");
        query = Normalizer.normalize(text(query,"City search",80), Normalizer.Form.NFD).replaceAll("\\p{M}", "").toLowerCase(Locale.ROOT);
        if (query.length() < 2) throw bad("Enter at least two characters.");
        final String prefix = query;
        return cache.read(seedHash+":cities:"+country+":"+query, java.time.Duration.ofMinutes(10), () -> jdbc.queryForList("SELECT id,country_code AS \"countryCode\",name,region FROM shipping.cities WHERE country_code=? AND search_name>=? AND search_name<? ORDER BY search_name,id LIMIT 30",country,prefix,prefix+'\uffff'));
    }
    public Map<String,Object> quote(Map<String,Object> input) {
        Object currencyValue = input.getOrDefault("currency", "EUR");
        if (!(currencyValue instanceof String currency) || !java.util.Set.of("EUR", "USD").contains(currency)) throw bad("Unsupported shipping currency.");
        Object id = input.get("cityId");
        if (!(id instanceof Number n) || n.doubleValue() != n.intValue() || n.intValue() < 1) throw bad("Select a city from the search results.");
        var rows = jdbc.queryForList("SELECT cities.id,cities.name,region,latitude,longitude,country_code AS \"countryCode\",countries.name AS country FROM shipping.cities JOIN shipping.countries ON countries.code=cities.country_code WHERE cities.id=?", ((Number)id).intValue());
        if (rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"City not found.");
        var city = rows.getFirst();
        String recipient = text(input.get("recipient"),"Recipient",100), line = text(input.get("line1"),"Street address",200);
        String postal = input.get("postalCode") instanceof String s ? s.trim() : "";
        if (postal.length()>20 || (recipient+line+postal).matches("(?s).*[\\x00-\\x1f\\x7f].*")) throw bad("Invalid delivery address.");
        long distance = distanceKm(((Number)city.get("latitude")).doubleValue(), ((Number)city.get("longitude")).doubleValue(),51.164896,7.068792);
        return Map.of("city",city,"address",Map.of("recipient",recipient,"line1",line,"postalCode",postal),"distanceKm",distance,"cost",BigDecimal.valueOf(distance*5,2),"currency",currency,"method","Distance-based standard shipping","quotedAt",Instant.now().toString());
    }
    static String text(Object value, String field, int max) {
        if (!(value instanceof String s) || s.isBlank() || s.length()>max) throw bad(field+" must contain 1–"+max+" characters.");
        return ((String)value).trim();
    }
    static ResponseStatusException bad(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST,message); }
    static long distanceKm(double lat,double lon,double originLat,double originLon) {
        double a = Math.pow(Math.sin(Math.toRadians(lat-originLat)/2),2)+Math.cos(Math.toRadians(originLat))*Math.cos(Math.toRadians(lat))*Math.pow(Math.sin(Math.toRadians(lon-originLon)/2),2);
        return Math.round(6371*2*Math.asin(Math.sqrt(Math.min(1,Math.max(0,a)))));
    }
}
