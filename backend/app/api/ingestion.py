from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.api_keys import ApiKeyPrincipal, require_scope
from app.registry import UnknownLanguageError, get_language_pack
from app.search.client import get_client
from app.search.index_manager import ensure_index
from app.search.ingest import DimensionMismatchError, DuplicateIdError, bulk_index_documents

router = APIRouter(prefix="/api/ingestion", tags=["ingestion"])


class IngestVariant(BaseModel):
    source: str | None = None
    content: str
    embedding: list[float]


class IngestDocument(BaseModel):
    id: str
    type: str
    book: str | None = None
    chapter: str | None = None
    verse: str | None = None
    source: str | None = None
    content: str
    embedding: list[float]
    variant: list[IngestVariant] = []


class IngestRequest(BaseModel):
    model_id: str
    model_revision: str
    dimension: int
    documents: list[IngestDocument]


class IngestResponse(BaseModel):
    indexed_count: int


@router.post("/{language}", response_model=IngestResponse)
def ingest(
    language: str,
    body: IngestRequest,
    principal: ApiKeyPrincipal = Depends(require_scope("index_content")),
) -> IngestResponse:
    try:
        language_pack = get_language_pack(language)
    except UnknownLanguageError:
        raise HTTPException(status_code=404, detail=f"Unknown language: {language}") from None

    spec = language_pack.embedding_spec
    if spec is None:
        raise HTTPException(status_code=422, detail=f"{language} has no embedding model configured")
    if (body.model_id, body.model_revision, body.dimension) != (
        spec.model_id,
        spec.revision,
        spec.dimension,
    ):
        raise HTTPException(
            status_code=422,
            detail=(
                f"model_id/model_revision/dimension don't match {language}'s configured "
                f"embedding model ({spec.model_id}@{spec.revision}, dim={spec.dimension})"
            ),
        )

    client = get_client()
    ensure_index(client, language_pack)
    try:
        indexed_count = bulk_index_documents(
            client, language_pack, [doc.model_dump() for doc in body.documents]
        )
    except DimensionMismatchError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None
    except DuplicateIdError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from None

    return IngestResponse(indexed_count=indexed_count)
