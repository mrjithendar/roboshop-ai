# Build from the repository root. Provider configuration is injected at runtime, never baked in.
FROM python:3.14-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HOST=0.0.0.0
WORKDIR /app
COPY services/ai-gateway/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 1000 --create-home app
COPY --chown=app:app services/python-common/ ./services/python-common/
COPY --chown=app:app services/ai-gateway/*.py ./services/ai-gateway/
COPY --chown=app:app scripts/seed-demo.py ./scripts/seed-demo.py
COPY --chown=app:app services/product-ingestion/products.json ./services/product-ingestion/products.json
RUN mkdir -p /app/.data && chown app:app /app/.data
USER app
EXPOSE 3000
CMD ["python", "services/ai-gateway/server.py"]
