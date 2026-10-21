package com.roboshop.shipping;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.ResponseEntity;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.dao.DataAccessException;
import java.util.Map;

@RestController
public class ShippingController {
    private final Locations locations;
    public ShippingController(Locations locations) { this.locations = locations; }
    @GetMapping("/health") Map<String,Object> health() { return Map.of("status","ok","service","shipping-service"); }
    @GetMapping("/api/shipping/ready") ResponseEntity<?> ready() {
        try { locations.ready(); return ResponseEntity.ok(Map.of("status","ok")); }
        catch (Exception e) { return ResponseEntity.status(503).body(Map.of("error","Shipping database unavailable or migration required.")); }
    }
    @GetMapping("/api/shipping/countries") Map<String,Object> countries() { return Map.of("countries",locations.countries(),"source","GeoNames","license","CC BY 4.0"); }
    @GetMapping("/api/shipping/cities") Map<String,Object> cities(@RequestParam(required=false) String country,@RequestParam(required=false) String q) { return Map.of("cities",locations.search(country,q)); }
    @PostMapping("/api/shipping/quote") Map<String,Object> quote(@RequestBody Map<String,Object> input) { return locations.quote(input); }
    @ExceptionHandler(ResponseStatusException.class) ResponseEntity<?> invalid(ResponseStatusException e) { return ResponseEntity.status(e.getStatusCode()).body(Map.of("error",e.getReason())); }
    @ExceptionHandler(HttpMessageNotReadableException.class) ResponseEntity<?> malformed() { return ResponseEntity.badRequest().body(Map.of("error","Expected a JSON object.")); }
    @ExceptionHandler(DataAccessException.class) ResponseEntity<?> databaseError() { return ResponseEntity.status(503).body(Map.of("error","Shipping database unavailable.")); }
}
