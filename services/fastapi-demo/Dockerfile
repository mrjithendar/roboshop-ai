FROM python:3.14-slim AS base
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY app.py ./
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
# Tests run in the same Python/Linux environment on CentOS and other runners.
FROM base AS test
COPY requirements-test.txt test_app.py ./
RUN pip install --no-cache-dir -r requirements-test.txt && python -m unittest -v

# The final published image excludes test dependencies and fixtures.
FROM base AS runtime
USER 65532:65532
EXPOSE 4112
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "4112", "--no-proxy-headers"]
