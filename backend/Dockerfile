FROM python:3.12-slim

WORKDIR /app

COPY . .
RUN pip install --no-cache-dir -e ".[dev]"

CMD sh -c 'uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips="*" ${ROOT_PATH:+--root-path "$ROOT_PATH"}'
