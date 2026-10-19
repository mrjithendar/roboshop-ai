package com.robotshop.shipping;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.*;
import tools.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import java.util.*;
import java.time.Duration;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class LocationCacheTest {
    @Test void returnsCachedDataWithoutDatabaseAndFallsBackOnOutage() throws Exception {
        var redis=mock(StringRedisTemplate.class);
        ValueOperations<String,String> ops=mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(ops);
        when(ops.get(anyString())).thenReturn("[{\"name\":\"India\"}]");
        var cache=new LocationCache(redis,new ObjectMapper(),new SimpleMeterRegistry(),true);
        assertEquals("India",cache.read("seed:countries",Duration.ofHours(1),()->{throw new AssertionError("cache hit must skip database");}).getFirst().get("name"));
        when(ops.get(anyString())).thenThrow(new RuntimeException("redis unavailable"));
        doThrow(new RuntimeException("redis unavailable")).when(ops).set(anyString(),anyString(),any(Duration.class));
        assertEquals("India",cache.read("seed:countries",Duration.ofHours(1),()->List.of(Map.of("name","India"))).getFirst().get("name"));
    }
}
