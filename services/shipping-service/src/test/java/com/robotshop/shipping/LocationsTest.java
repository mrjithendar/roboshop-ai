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
}
