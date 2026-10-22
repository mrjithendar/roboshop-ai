# Build context: this service directory.
FROM python:3.14-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1 HOST=0.0.0.0
WORKDIR /app
COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 1000 --create-home app
COPY --chown=app:app . ./services/mcp-server/
USER app
RUN python -m unittest discover -s services/mcp-server/tests
ENV MCP_TRANSPORT=http
EXPOSE 4107
CMD ["python", "services/mcp-server/server.py"]
