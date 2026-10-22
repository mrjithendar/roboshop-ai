package com.roboshop.shipping;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.server.observation.DefaultServerRequestObservationConvention;
import org.springframework.http.server.observation.ServerRequestObservationContext;

/** Keep the automatic Spring HTTP observation, changing only its contextual name. */
@Configuration
class TracingConfiguration {
    @Bean DefaultServerRequestObservationConvention routeNames() {
        return new DefaultServerRequestObservationConvention() {
            @Override public String getContextualName(ServerRequestObservationContext context) {
                String method = context.getCarrier().getMethod();
                if (!java.util.Set.of("GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS").contains(method)) method="HTTP";
                String route = context.getPathPattern();
                return route == null ? method : method + " " + route;
            }
        };
    }
}
