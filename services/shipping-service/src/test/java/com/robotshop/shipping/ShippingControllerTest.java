package com.robotshop.shipping;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class ShippingControllerTest {
    @Test void rejectsMalformedAndOversizedBodies() throws Exception {
        var locations = mock(Locations.class);
        var mvc = MockMvcBuilders.standaloneSetup(new ShippingController(locations)).addFilters(new RequestLimits()).build();
        mvc.perform(post("/api/shipping/quote").contentType("application/json").content("{")).andExpect(status().isBadRequest()).andExpect(jsonPath("$.error").value("Expected a JSON object."));
        mvc.perform(post("/api/shipping/quote").contentType("application/json").content("x".repeat(16385))).andExpect(status().isPayloadTooLarge());
        verifyNoInteractions(locations);
    }
    @Test void readinessReflectsDatabaseFailureWithoutLeakingDetails() throws Exception {
        var locations = mock(Locations.class);
        doThrow(new IllegalStateException("private database details")).when(locations).ready();
        var mvc = MockMvcBuilders.standaloneSetup(new ShippingController(locations)).build();
        mvc.perform(get("/api/shipping/ready")).andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.error").value("Shipping database unavailable or migration required."));
        mvc.perform(get("/health")).andExpect(status().isOk());
    }
}
