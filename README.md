# Scriptorium

## Local development

Prereqs: Python 3.12+, Docker + Docker Compose.

The app runs in a local venv (fast iteration, native debugging). Docker is only
used for infra services (Postgres, OpenSearch). The `api` service in
`docker-compose.yml` is not used locally — it's the artifact built and
deployed by CI/CD (see `docs/roadmap.md` at the parent directory).

```bash
cp .env.example .env          # adjust if needed

python3 -m venv .venv
source .venv/bin/activate
pip install -e "./backend[dev]"

docker compose up -d postgres opensearch

# run everything below from the repo root — .env and pytest config both
# resolve relative to it
alembic -c backend/alembic.ini upgrade head
uvicorn app.main:app --reload
ruff check backend/      # lint
ruff format backend/     # format

# tests run against a SEPARATE database (scriptorium_test) and SEPARATE
# OpenSearch indices (prefixed scriptorium_test_), never the dev ones — the
# test suite deletes rows/indices as part of cleanup, so sharing state with
# your interactive session means tests can wipe your real accounts/data.
# scriptorium_test is created automatically by postgres-init-test-db.sql on a
# fresh `docker compose up`; if you already had a postgres_data volume before
# this existed, create it once yourself:
#   docker compose exec postgres psql -U scriptorium -d postgres -c "CREATE DATABASE scriptorium_test;"
POSTGRES_DB=scriptorium_test alembic -c backend/alembic.ini upgrade head
POSTGRES_DB=scriptorium_test OPENSEARCH_INDEX_PREFIX=scriptorium_test_ pytest backend/tests
```

`GET /health` should return `{"status": "ok"}` once the app is running.

## Creating/resetting the superuser

There is only ever one superuser account. Running this again resets its
credentials rather than creating a second one:

```bash
python backend/cli/create_admin.py --username admin --email admin@example.com --password <password>
```

## Frontend

React + TypeScript + Vite + Tailwind CSS, in `frontend/`.

```bash
cd frontend
npm install
npm run dev      # dev server on :5173, proxies /api to the backend on :8000
npm run test     # vitest
npm run lint     # oxlint
npm run build    # type-check + production build
```

Run the backend alongside this for `/api` calls to work in dev.
