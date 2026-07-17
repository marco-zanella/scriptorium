from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth.dependencies import Principal, require_role
from app.registry import UnknownLanguageError, get_language_pack, list_language_packs
from app.search.client import get_client
from app.search.query import (
    DEFAULT_BUCKET_WEIGHTS,
    DEFAULT_COMBINER,
    DEFAULT_VARIANT_WEIGHTS,
    DEFAULT_WEIGHTS,
)
from app.search.service import search as run_search

router = APIRouter(prefix="/api/search", tags=["search"])


class LanguageOut(BaseModel):
    iso_code: str
    display_name: str
    directionality: str


class SearchRequest(BaseModel):
    query: str
    weights: dict[str, float] = DEFAULT_WEIGHTS
    variant_weights: dict[str, float] = DEFAULT_VARIANT_WEIGHTS
    # bucket_weights balances the lexical vs. semantic bucket overall — distinct from
    # weights/variant_weights, which only affect ranking *within* a bucket (a uniform
    # per-bucket score scale gets cancelled out by the combiner's score normalization).
    bucket_weights: dict[str, float] = DEFAULT_BUCKET_WEIGHTS
    # combiner selects how the two buckets combine: {"technique": "rrf", "rank_constant": 60}
    # or {"technique": "min_max" | "l2" | "z_score", "combination": "arithmetic_mean" | ...}.
    combiner: dict = DEFAULT_COMBINER
    books: list[str] | None = None
    sources: list[str] | None = None
    page: int = 1
    page_size: int = 50
    include_score_stats: bool = False


class SearchHit(BaseModel):
    book: str | None
    chapter: str | None
    verse: str | None
    source: str | None
    content: str | None
    variant: list[dict]
    score: float


class FacetBucket(BaseModel):
    key: str
    count: int


class ScoreStats(BaseModel):
    count: int
    min: float
    max: float
    avg: float
    std_deviation: float
    percentiles: dict[str, float]


class SearchResponse(BaseModel):
    took_ms: int
    count: int
    page: int
    page_size: int
    results: list[SearchHit]
    facets: dict[str, list[FacetBucket]]
    score_stats: ScoreStats | None = None


@router.get("/languages", response_model=list[LanguageOut])
def languages() -> list[LanguageOut]:
    return [
        LanguageOut(
            iso_code=pack.iso_code,
            display_name=pack.display_name,
            directionality=pack.directionality,
        )
        for pack in list_language_packs()
    ]


@router.post("/{language}", response_model=SearchResponse)
def search_language(
    language: str,
    body: SearchRequest,
    principal: Principal = Depends(require_role("use_search_engine")),
) -> SearchResponse:
    try:
        language_pack = get_language_pack(language)
    except UnknownLanguageError:
        raise HTTPException(status_code=404, detail=f"Unknown language: {language}") from None

    result = run_search(
        get_client(),
        language_pack,
        body.query,
        weights=body.weights,
        variant_weights=body.variant_weights,
        bucket_weights=body.bucket_weights,
        combiner=body.combiner,
        books=body.books,
        sources=body.sources,
        page=body.page,
        page_size=body.page_size,
        include_score_stats=body.include_score_stats,
    )
    return SearchResponse(
        took_ms=result.took_ms,
        count=result.count,
        page=result.page,
        page_size=result.page_size,
        results=result.results,
        facets={
            name: [FacetBucket(key=b.key, count=b.count) for b in buckets]
            for name, buckets in result.facets.items()
        },
        score_stats=ScoreStats(
            count=result.score_stats.count,
            min=result.score_stats.min,
            max=result.score_stats.max,
            avg=result.score_stats.avg,
            std_deviation=result.score_stats.std_deviation,
            percentiles=result.score_stats.percentiles,
        )
        if result.score_stats
        else None,
    )
