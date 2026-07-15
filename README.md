# Scriptorium

## Local development

Prereqs: Python 3.12+, Docker + Docker Compose.

The app runs in a local venv (fast iteration, native debugging). Docker is only
used for infra services (Postgres for now, OpenSearch later). The `api`
service in `docker-compose.yml` is not used locally — it's the artifact built
and deployed by CI/CD (see `docs/roadmap.md` at the parent directory).

```bash
cp .env.example .env          # adjust if needed

python3 -m venv .venv
source .venv/bin/activate
pip install -e "./backend[dev]"

docker compose up -d postgres

# run everything below from the repo root — .env and pytest config both
# resolve relative to it
alembic -c backend/alembic.ini upgrade head
uvicorn app.main:app --reload
pytest backend/tests
ruff check backend/      # lint
ruff format backend/     # format
```

`GET /health` should return `{"status": "ok"}` once the app is running.
