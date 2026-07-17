FROM python:3.12-slim

WORKDIR /app

COPY . .
# CPU-only torch build first — the production server has no GPU and a small root
# filesystem; the default PyPI wheel pulls the full CUDA stack (~2GB of nvidia-*
# packages) that's never used here. Installed before the rest so the later
# `pip install -e ".[dev]"` finds "torch>=2.0" already satisfied and doesn't
# pull the default (CUDA) wheel instead.
RUN pip install --no-cache-dir torch --extra-index-url https://download.pytorch.org/whl/cpu
RUN pip install --no-cache-dir -e ".[dev]"

CMD sh -c 'uvicorn app.main:app --host 0.0.0.0 --port 8000 --proxy-headers --forwarded-allow-ips="*" ${ROOT_PATH:+--root-path "$ROOT_PATH"}'
