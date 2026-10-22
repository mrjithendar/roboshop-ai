# Build context: this service directory. Provider configuration is injected at runtime, never baked in.
FROM python:3.14-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HOST=0.0.0.0 DATA_DIR=/app/.data
WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 1000 --create-home app
COPY --chown=app:app . ./services/ai-gateway/
RUN mkdir -p /app/.data && chown app:app /app/.data
USER app
EXPOSE 3000
# FastAPI/Uvicorn entrypoint preserves HOST/PORT and enforces one process for JSON storage.
CMD ["python", "services/ai-gateway/server.py"]
