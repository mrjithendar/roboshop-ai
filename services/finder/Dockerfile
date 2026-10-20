FROM python:3.14-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 1000 --create-home app
COPY --chown=app:app server.py widget.js ./
USER app
EXPOSE 4110
CMD ["python", "server.py"]
