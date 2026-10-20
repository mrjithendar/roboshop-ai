package com.robotshop.shipping;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
class LocationsTest {
    @Test void knownDistances() {
        assertEquals(0,Locations.distanceKm(51.164896,7.068792,51.164896,7.068792));
        assertEquals(20015,Locations.distanceKm(0,180,0,0));
        assertEquals(5570,Locations.distanceKm(40.7128,-74.006,51.5074,-0.1278),5);
    }
    @Test void rejectsInvalidText() {
        assertThrows(Exception.class,()->Locations.text("", "Recipient",100));
        assertThrows(Exception.class,()->Locations.text(42,"Recipient",100));
        assertEquals("Alice",Locations.text(" Alice ","Recipient",100));
    }

    @Test void quoteCurrencyIsExplicitAndValidated() throws Exception {
        var jdbc=org.mockito.Mockito.mock(org.springframework.jdbc.core.JdbcTemplate.class);
        org.mockito.Mockito.when(jdbc.queryForList(org.mockito.ArgumentMatchers.anyString(),org.mockito.ArgumentMatchers.eq(1)))
          .thenReturn(java.util.List.of(java.util.Map.<String,Object>of("id",1,"name","Test city","latitude",51.0,"longitude",7.0,"country","Test country")));
        var locations=new Locations(jdbc,new tools.jackson.databind.ObjectMapper(),org.mockito.Mockito.mock(LocationCache.class));
        var input=new java.util.HashMap<String,Object>(java.util.Map.of("cityId",1,"recipient","Customer","line1","1 Test Street","currency","USD"));
        assertEquals("USD",locations.quote(input).get("currency"));
        input.put("currency","INR"); assertEquals("INR",locations.quote(input).get("currency"));
        input.remove("currency"); assertEquals("INR",locations.quote(input).get("currency"));
        input.put("currency","XYZ"); assertThrows(org.springframework.web.server.ResponseStatusException.class,()->locations.quote(input));
        input.put("currency",null); assertThrows(org.springframework.web.server.ResponseStatusException.class,()->locations.quote(input));
    }
}
