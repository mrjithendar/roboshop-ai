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
}
