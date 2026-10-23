# Disposable test image only: never use this entry point for production services.
FROM node:26-bookworm-slim AS node
FROM python:3.14-slim
COPY --from=node /usr/local/bin/node /usr/local/bin/node
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /workspace
COPY services/ai-gateway/requirements.txt services/ai-gateway/requirements.txt
COPY services/moks/requirements.txt services/moks/requirements.txt
COPY services/user-service/requirements.txt services/user-service/requirements.txt
COPY services/cart-service/requirements.txt services/cart-service/requirements.txt
COPY tests/load/requirements.txt tests/load/requirements.txt
RUN pip install --no-cache-dir -r tests/load/requirements.txt
COPY services/ services/
COPY tests/load/*.py tests/load/*.js tests/load/*.mjs tests/load/
RUN python tests/load/install-k6.py && useradd -m load && chown -R load:load tests/load
USER load
ENV LOAD_EDGE_PORT=18080 LOAD_EDGE_BIND=0.0.0.0
EXPOSE 18080
ENTRYPOINT ["python", "tests/load/lab.py"]
CMD ["serve", "--run-id", "load-container"]
