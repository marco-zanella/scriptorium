from dataclasses import dataclass, field
from functools import lru_cache

from opensearchpy import NotFoundError, OpenSearch

from app.embeddings.model import Encoder, encode_query, load_model
from app.registry import LanguagePack
from app.registry.language_pack import EmbeddingSpec
from app.search.index_manager import index_name
from app.search.query import (
    DEFAULT_BUCKET_WEIGHTS,
    DEFAULT_COMBINER,
    DEFAULT_VARIANT_WEIGHTS,
    DEFAULT_WEIGHTS,
    build_facets_body,
    build_hybrid_body,
    build_score_stats_aggregations,
)


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
        for bucket in aggregations.get(name, {}).get("values", {}).get("buckets", [])
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


@lru_cache
def _get_encoder(embedding_spec: EmbeddingSpec) -> Encoder:
    return load_model(embedding_spec)


def _query_vector(
    language_pack: LanguagePack, query: str, weights: dict, variant_weights: dict
) -> list[float] | None:
    """Computes the query embedding only when the semantic bucket is actually
    requested and the language has a model — encoding is a real CPU cost, not
    something to pay for a lexical-only search."""
    wants_semantic = weights.get("semantic", 0) > 0 or variant_weights.get("semantic", 0) > 0
    if not wants_semantic or language_pack.embedding_spec is None:
        return None
    encoder = _get_encoder(language_pack.embedding_spec)
    return encode_query(encoder, language_pack.embedding_spec, query)


def _hit_to_dict(hit: dict) -> dict:
    return {
        "id": hit["_id"],
        "type": hit["_source"].get("type"),
        "book": hit["_source"].get("book"),
        "chapter": hit["_source"].get("chapter"),
        "verse": hit["_source"].get("verse"),
        "source": hit["_source"].get("source"),
        "content": hit["_source"].get("content"),
        "variant": hit["_source"].get("variant", []),
        "score": hit["_score"],
    }


def browse_facets(
    client: OpenSearch,
    language_pack: LanguagePack,
    *,
    books: list[str] | None = None,
    sources: list[str] | None = None,
) -> dict[str, list[FacetBucket]]:
    """Book/source facet options independent of any query — lets the frontend
    populate the filter sidebar (and let a user pre-select a scope like "Rahlfs
    Genesis") before a search has ever run, not just as a search response
    byproduct. Matches every document (`query=None` in build_facets_body), same
    multi-select cross-filtering as a real search's facets.

    A language with no ingested content yet (no index created) has no facets
    to offer — not an error, just nothing indexed yet."""
    if not client.indices.exists(index=index_name(language_pack)):
        return {"book": [], "source": []}

    response = client.search(
        index=index_name(language_pack),
        body=build_facets_body(None, books=books, sources=sources),
        size=0,
    )
    aggregations = response.get("aggregations", {})
    return {
        "book": _buckets(aggregations, "by_book"),
        "source": _buckets(aggregations, "by_source"),
    }


def get_document(client: OpenSearch, language_pack: LanguagePack, doc_id: str) -> dict | None:
    """Single-document lookup by exact id — used to resolve a test-case target's
    content when it wasn't among a search's returned hits, where there's no
    scored hit to read `content` off of. Not an error when the id doesn't
    exist: the index may have changed since the target was recorded."""
    if not client.indices.exists(index=index_name(language_pack)):
        return None
    try:
        response = client.get(index=index_name(language_pack), id=doc_id)
    except NotFoundError:
        return None
    # No relevance score to report for a direct id lookup (not a ranked query hit).
    return _hit_to_dict({"_id": response["_id"], "_source": response["_source"], "_score": 0.0})


def search(
    client: OpenSearch,
    language_pack: LanguagePack,
    query: str,
    *,
    weights: dict[str, float] | None = None,
    variant_weights: dict[str, float] | None = None,
    bucket_weights: dict[str, float] | None = None,
    combiner: dict | None = None,
    books: list[str] | None = None,
    sources: list[str] | None = None,
    page: int = 1,
    page_size: int = 50,
    include_score_stats: bool = False,
) -> SearchResult:
    weights = weights if weights is not None else DEFAULT_WEIGHTS
    variant_weights = variant_weights if variant_weights is not None else DEFAULT_VARIANT_WEIGHTS
    bucket_weights = bucket_weights if bucket_weights is not None else DEFAULT_BUCKET_WEIGHTS
    combiner = combiner if combiner is not None else DEFAULT_COMBINER

    # A language with no ingested content yet (no index created) has nothing to
    # search — not an error, just no results.
    if not client.indices.exists(index=index_name(language_pack)):
        return SearchResult(took_ms=0, count=0, page=page, page_size=page_size)

    query_vector = _query_vector(language_pack, query, weights, variant_weights)
    body = build_hybrid_body(
        query,
        query_vector,
        weights,
        variant_weights,
        bucket_weights,
        combiner,
        books,
        sources,
    )
    if include_score_stats:
        body["aggs"] = build_score_stats_aggregations()
    # Otherwise hits.total silently caps at 10000 past that many matches.
    body["track_total_hits"] = True
    response = client.search(
        index=index_name(language_pack),
        body=body,
        size=page_size,
        from_=(page - 1) * page_size,
    )

    # A separate, size-0 request for facet counts — deliberately not aggregations
    # on the response above, since that would need book/source folded into the
    # main query, which the hybrid combiner can't guarantee still ranks hits
    # identically to a search without facets (see build_facets_body).
    facets_response = client.search(
        index=index_name(language_pack),
        body=build_facets_body(query, query_vector, weights, variant_weights, books, sources),
        size=0,
    )

    results = [_hit_to_dict(hit) for hit in response["hits"]["hits"]]

    facet_aggregations = facets_response.get("aggregations", {})
    facets = {
        "book": _buckets(facet_aggregations, "by_book"),
        "source": _buckets(facet_aggregations, "by_source"),
    }

    return SearchResult(
        took_ms=response["took"],
        count=response["hits"]["total"]["value"],
        page=page,
        page_size=page_size,
        results=results,
        facets=facets,
        score_stats=_score_stats(response.get("aggregations", {})),
    )


def assisted_content_search(
    client: OpenSearch,
    language_pack: LanguagePack,
    query: str,
    *,
    size: int = 8,
) -> list[dict]:
    """Content picker for referencing a specific passage/work by id (e.g. when
    building an eval test case target). A query that simply appears anywhere
    inside the id (e.g. "genesis:1:1" inside "kjv:genesis:1:1", "protrepticus:1"
    inside "clemens:protrepticus:1") is a strong signal regardless of source —
    checked ahead of a plain book/id prefix match and ordinary relevance
    search, which only catch matches anchored at the very start."""
    if not client.indices.exists(index=index_name(language_pack)):
        return []

    normalized = query.strip().lower()

    contains_hits: list[dict] = []
    if normalized:
        contains_response = client.search(
            index=index_name(language_pack),
            body={"query": {"wildcard": {"id": {"value": f"*{normalized}*"}}}},
            size=size,
        )
        contains_hits = [_hit_to_dict(hit) for hit in contains_response["hits"]["hits"]]

    prefix_response = client.search(
        index=index_name(language_pack),
        body={
            "query": {
                "bool": {
                    "should": [
                        {"prefix": {"book": normalized}},
                        {"prefix": {"id": normalized}},
                    ],
                    "minimum_should_match": 1,
                }
            }
        },
        size=size,
    )
    prefix_hits = [_hit_to_dict(hit) for hit in prefix_response["hits"]["hits"]]

    relevance = search(client, language_pack, query, page_size=size)

    seen_ids: set[str] = set()
    merged: list[dict] = []
    for hit in [*contains_hits, *prefix_hits, *relevance.results]:
        if hit["id"] not in seen_ids:
            seen_ids.add(hit["id"])
            merged.append(hit)
    return merged[:size]
