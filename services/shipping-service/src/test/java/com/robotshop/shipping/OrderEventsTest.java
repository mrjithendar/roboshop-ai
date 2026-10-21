package com.robotshop.shipping;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.ObjectMapper;
import io.micrometer.core.instrument.simple.SimpleMeterRegistry;
import org.springframework.amqp.core.*;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
class OrderEventsTest {
    @Test void invalidMessagesNeverReachDatabase() {
        var jdbc=mock(JdbcTemplate.class);
        var events=new OrderEvents(jdbc,new ObjectMapper(),new SimpleMeterRegistry());
        assertThrows(AmqpRejectAndDontRequeueException.class,()->events.receive(new Message("{}".getBytes(),new MessageProperties())));
        verifyNoInteractions(jdbc);
    }
    @Test void sandboxAndUnclassifiedEventsNeverCreateDelivery() {
        var jdbc=mock(JdbcTemplate.class);
        var events=new OrderEvents(jdbc,new ObjectMapper(),new SimpleMeterRegistry());
        String base="{\"type\":\"order.paid\",\"version\":1,\"orderId\":\"11111111-1111-1111-1111-111111111111\",\"eventId\":\"22222222-2222-2222-2222-222222222222\",\"shipping\":{},\"items\":[]";
        for (String provenance : new String[]{"", ",\"paymentMode\":\"test\",\"demo\":true,\"inventoryProvenance\":\"merchant\"", ",\"paymentMode\":\"live\",\"demo\":true,\"inventoryProvenance\":\"merchant\"", ",\"paymentMode\":\"live\",\"demo\":false,\"synthetic\":true,\"inventoryProvenance\":\"merchant\""}) {
            var message=new Message((base+provenance+"}").getBytes(),new MessageProperties());
            assertThrows(AmqpRejectAndDontRequeueException.class,()->events.receive(message));
        }
        verifyNoInteractions(jdbc);
    }
    @Test void explicitLiveMerchantEventMayRequestDelivery() {
        var jdbc=mock(JdbcTemplate.class);
        var events=new OrderEvents(jdbc,new ObjectMapper(),new SimpleMeterRegistry());
        var payload="{\"type\":\"order.paid\",\"version\":1,\"orderId\":\"11111111-1111-1111-1111-111111111111\",\"eventId\":\"22222222-2222-2222-2222-222222222222\",\"shipping\":{},\"items\":[],\"paymentMode\":\"live\",\"demo\":false,\"synthetic\":false,\"inventoryProvenance\":\"merchant\"}";
        events.receive(new Message(payload.getBytes(),new MessageProperties()));
        verify(jdbc).update(anyString(),any(Object[].class));
    }
}
