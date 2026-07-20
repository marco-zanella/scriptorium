from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy import text

from app.api.api_tokens import router as api_tokens_router
from app.api.auth import router as auth_router
from app.api.eval_results import router as eval_results_router
from app.api.eval_test_cases import router as eval_test_cases_router
from app.api.eval_test_collections import router as eval_test_collections_router
from app.api.ingestion import router as ingestion_router
from app.api.search import router as search_router
from app.api.search_configurations import router as search_configurations_router
from app.api.users import router as users_router
from app.core.db import engine
from app.eval.runner import sweep_interrupted_runs


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    sweep_interrupted_runs()
    yield


app = FastAPI(title="Scriptorium API", lifespan=lifespan)
app.include_router(auth_router)
app.include_router(users_router)
app.include_router(api_tokens_router)
app.include_router(ingestion_router)
# search_configurations_router must be registered before search_router:
# POST /api/search/{language} is a generic single-segment path and would
# otherwise swallow POST /api/search/configurations (routes match in
# registration order).
app.include_router(search_configurations_router)
app.include_router(search_router)
app.include_router(eval_test_cases_router)
app.include_router(eval_test_collections_router)
app.include_router(eval_results_router)


@app.get("/health")
def health() -> dict:
    with engine.connect() as conn:
        conn.execute(text("SELECT 1"))
    return {"status": "ok"}
