package com.robotshop.shipping;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.amqp.core.*;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.jdbc.core.JdbcTemplate;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.amqp.AmqpRejectAndDontRequeueException;
import java.util.UUID;

@Configuration
@ConditionalOnProperty(name="robotshop.messaging-enabled",havingValue="true")
public class OrderEvents {
    static final String QUEUE="robotshop.shipping.orders";
    @Bean org.springframework.amqp.rabbit.retry.MessageRecoverer failedDelivery() {
        return (message, cause) -> {
            meters.counter("robotshop.shipping.events","result","failed").increment();
            // Avoid the default recoverer's logging of message bodies containing addresses.
            throw new AmqpRejectAndDontRequeueException("Order event processing failed after retries");
        };
    }
    @Bean Declarables topology() {
        var exchange=new DirectExchange("robotshop.orders",true,false);
        var dead=new DirectExchange("robotshop.orders.dlx",true,false);
        var queue=QueueBuilder.durable(QUEUE).quorum().deadLetterExchange("robotshop.orders.dlx").deadLetterRoutingKey("shipping.failed").build();
        var dlq=QueueBuilder.durable("robotshop.shipping.failed").quorum().build();
        return new Declarables(exchange,dead,queue,dlq,BindingBuilder.bind(queue).to(exchange).with("order.paid"),BindingBuilder.bind(dlq).to(dead).with("shipping.failed"));
    }
    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;
    private final MeterRegistry meters;
    public OrderEvents(JdbcTemplate jdbc,ObjectMapper mapper,MeterRegistry meters) { this.jdbc=jdbc;this.mapper=mapper;this.meters=meters; }
    @RabbitListener(queues=QUEUE)
    public void receive(Message message) {
        UUID order,event;
        String payload;
        try {
            if(message.getBody().length>65536) throw new IllegalArgumentException();
            var data=mapper.readTree(message.getBody());
            if(!"order.paid".equals(data.path("type").asText()) || data.path("version").asInt()!=1 || !data.path("shipping").isObject() || !data.path("items").isArray()) throw new IllegalArgumentException();
            order=UUID.fromString(data.path("orderId").asText()); event=UUID.fromString(data.path("eventId").asText()); payload=mapper.writeValueAsString(data);
        } catch(Exception e) { meters.counter("robotshop.shipping.events","result","invalid").increment(); throw new AmqpRejectAndDontRequeueException("Invalid order event"); }
        // Commit succeeds before the listener returns and RabbitMQ acknowledges.
        int inserted=jdbc.update("INSERT INTO shipping.shipment_requests(order_id,event_id,payload) VALUES (?,?,?::jsonb) ON CONFLICT DO NOTHING",order,event,payload);
        meters.counter("robotshop.shipping.events","result",inserted==0?"duplicate":"accepted").increment();
    }
}
