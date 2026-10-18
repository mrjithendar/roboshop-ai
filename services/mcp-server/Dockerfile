# Build from the repository root.
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HOST=0.0.0.0
WORKDIR /app
COPY services/mcp-server/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 1000 --create-home app
COPY --chown=app:app services/python-common/ ./services/python-common/
COPY --chown=app:app services/mcp-server/*.py ./services/mcp-server/
USER app
CMD ["python", "services/mcp-server/server.py"]
