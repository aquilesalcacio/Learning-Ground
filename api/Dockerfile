# The API on our VPS (deploy/compose.yaml), or any Docker host: FastAPI on port 8000.
# Keys come from the service's environment, never from a baked-in .env.
# Mount a volume at /app/data: Canvas LMS connections are kept there in SQLite.

FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /uvx /bin/
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PYTHONUNBUFFERED=1
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY . .
RUN mkdir -p /app/data
EXPOSE 8000
# Behind nginx, which ends HTTPS and forwards the real scheme and client address.
CMD ["uv", "run", "--no-sync", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
