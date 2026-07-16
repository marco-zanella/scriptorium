from dataclasses import dataclass, field

from opensearchpy import OpenSearch

from app.registry import LanguagePack
from app.search.index_manager import index_name
from app.search.query import build_aggregations, build_query


@dataclass
class FacetBucket:
    key: str
    count: int


@dataclass
class ScoreStats:
    count: int
    min: float
    max: float
    avg: float
    std_deviation: float
    percentiles: dict[str, float]


@dataclass
class SearchResult:
    took_ms: int
    count: int
    page: int
    page_size: int
    results: list[dict] = field(default_factory=list)
    facets: dict[str, list[FacetBucket]] = field(default_factory=dict)
    score_stats: ScoreStats | None = None


def _buckets(aggregations: dict, name: str) -> list[FacetBucket]:
    return [
        FacetBucket(key=bucket["key"], count=bucket["doc_count"])
        for bucket in aggregations.get(name, {}).get("buckets", [])
    ]


def _score_stats(aggregations: dict) -> ScoreStats | None:
    stats = aggregations.get("score_stats")
    percentiles = aggregations.get("score_percentiles")
    if stats is None or percentiles is None:
        return None
    return ScoreStats(
        count=stats["count"],
        min=stats["min"],
        max=stats["max"],
        avg=stats["avg"],
        std_deviation=stats["std_deviation"],
        percentiles=percentiles["values"],
    )


def search(
    client: OpenSearch,
    language_pack: LanguagePack,
    query: str,
    *,
    weights: dict[str, float] | None = None,
    variant_weights: dict[str, float] | None = None,
    books: list[str] | None = None,
    sources: list[str] | None = None,
    page: int = 1,
    page_size: int = 50,
    include_score_stats: bool = False,
) -> SearchResult:
    body = build_query(query, weights, variant_weights, books, sources)
    body["aggs"] = build_aggregations(include_score_stats)
    response = client.search(
        index=index_name(language_pack),
        body=body,
        size=page_size,
        from_=(page - 1) * page_size,
    )

    results = [
        {
            "book": hit["_source"].get("book"),
            "chapter": hit["_source"].get("chapter"),
            "verse": hit["_source"].get("verse"),
            "source": hit["_source"].get("source"),
            "content": hit["_source"].get("content"),
            "variant": hit["_source"].get("variant", []),
            "score": hit["_score"],
        }
        for hit in response["hits"]["hits"]
    ]

    aggregations = response.get("aggregations", {})
    facets = {
        "book": _buckets(aggregations, "by_book"),
        "source": _buckets(aggregations, "by_source"),
    }

    return SearchResult(
        took_ms=response["took"],
        count=response["hits"]["total"]["value"],
        page=page,
        page_size=page_size,
        results=results,
        facets=facets,
        score_stats=_score_stats(aggregations),
    )
