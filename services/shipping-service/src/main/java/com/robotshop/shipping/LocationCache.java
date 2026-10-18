package com.robotshop.shipping;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import java.util.*;
import java.time.Duration;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.function.Supplier;

@Component
public class LocationCache {
    private final StringRedisTemplate redis;
    private final ObjectMapper mapper;
    private final MeterRegistry meters;
    private final boolean enabled;
    public LocationCache(StringRedisTemplate redis, ObjectMapper mapper, MeterRegistry meters, @Value("${robotshop.cache-enabled}") boolean enabled) {
        this.redis=redis; this.mapper=mapper; this.meters=meters; this.enabled=enabled;
    }
    List<Map<String,Object>> read(String key, Duration ttl, Supplier<List<Map<String,Object>>> loader) {
        if (!enabled) return loader.get();
        // Never use raw search strings in cache keys or metric labels.
        String cacheKey;
        try { cacheKey="robotshop:locations:"+HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(key.getBytes(StandardCharsets.UTF_8))); }
        catch (Exception e) { throw new IllegalStateException(e); }
        try {
            String cached=redis.opsForValue().get(cacheKey);
            if (cached!=null) {
                var result=mapper.readValue(cached,new TypeReference<List<Map<String,Object>>>() {});
                meters.counter("robotshop.location.cache","result","hit").increment(); return result;
            }
        } catch (Exception e) { meters.counter("robotshop.location.cache","result","error").increment(); }
        meters.counter("robotshop.location.cache","result","miss").increment();
        var result=loader.get();
        try { redis.opsForValue().set(cacheKey,mapper.writeValueAsString(result),ttl); }
        catch (Exception e) { meters.counter("robotshop.location.cache","result","error").increment(); }
        return result;
    }
}
