package com.roboshop.shipping;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.http.server.observation.ServerRequestObservationContext;
import static org.junit.jupiter.api.Assertions.*;
class TracingConfigurationTest {
 @Test void normalizesRouteAndNeverUsesRawUnknownPath() {
  var request=new MockHttpServletRequest("GET","/private-id");
  var context=new ServerRequestObservationContext(request,new MockHttpServletResponse());
  var convention=new TracingConfiguration().routeNames();
  assertEquals("GET",convention.getContextualName(context));
  context.setPathPattern("/api/shipping/countries");
  assertEquals("GET /api/shipping/countries",convention.getContextualName(context));
 }
}
