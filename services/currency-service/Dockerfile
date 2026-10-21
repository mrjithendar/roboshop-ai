FROM golang:1.27-alpine AS build
WORKDIR /src
COPY go.mod ./
COPY *.go ./
RUN go test ./... && CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /currency-service .

FROM alpine:3.23
RUN apk add --no-cache ca-certificates
COPY --from=build /currency-service /usr/local/bin/currency-service
USER 65532:65532
EXPOSE 4111
ENTRYPOINT ["/usr/local/bin/currency-service"]
