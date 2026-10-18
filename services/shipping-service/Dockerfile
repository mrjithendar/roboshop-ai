FROM eclipse-temurin:21-jdk AS build
WORKDIR /workspace
COPY services/shipping-service/ ./
RUN chmod +x gradlew && ./gradlew --no-daemon bootJar

FROM eclipse-temurin:21-jre-alpine
RUN addgroup -g 1000 shipping && adduser -D -u 1000 -G shipping shipping
WORKDIR /app
COPY --from=build --chown=shipping:shipping /workspace/build/libs/shipping-service.jar /app/shipping-service.jar
ENV HOST=0.0.0.0 PORT=4106 JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=70"
USER shipping
EXPOSE 4106
ENTRYPOINT ["java", "-jar", "/app/shipping-service.jar"]
