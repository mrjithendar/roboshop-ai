# Build from the repository root. Provider configuration is injected at runtime, never baked in.
FROM python:3.14-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HOST=0.0.0.0
WORKDIR /app
COPY services/cart-service/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 1000 --create-home app
COPY --chown=app:app services/python-common/ ./services/python-common/
COPY --chown=app:app services/cart-service/*.py ./services/cart-service/
USER app
EXPOSE 4107
CMD ["python", "services/cart-service/server.py"]
