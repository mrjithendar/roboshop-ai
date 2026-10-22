FROM python:3.13-slim AS base
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt && useradd --uid 1000 --create-home app
COPY . ./
USER app
FROM base AS test
RUN python -m unittest discover -s tests -v
FROM base AS runtime
EXPOSE 4113
CMD ["python", "bridge.py"]
