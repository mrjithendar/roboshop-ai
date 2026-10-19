# Build context: this service directory. Provider configuration is injected at runtime, never baked in.
FROM python:3.14-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HOST=0.0.0.0
WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 1000 --create-home app
COPY --chown=app:app . ./services/shopping-agent/
USER app
EXPOSE 4103
CMD ["python", "services/shopping-agent/server.py"]
