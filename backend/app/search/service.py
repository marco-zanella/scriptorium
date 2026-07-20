import statistics
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
)

SCORE_PERCENTILES = [1, 5, 25, 50, 75, 95, 99]

# Score-distribution stats describe a fixed top-K window, independent of
# whatever page_size the caller happens to be displaying — matching how
# post-retrieval query-performance-prediction methods (NQC, WIG) are defined
# in the IR literature: over a moderate, fixed top-of-ranking window, not the
# full match population (which for a lenient hybrid query can be nearly the
# whole corpus) and not whatever a UI happens to paginate by.
STATS_TOP_K = 100


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
    # rank-1 minus rank-2 score — the plainest "how far ahead is the leader" signal.
    gap: float
    # Query-performance-prediction-style "is the system committing to a winner or
    # lost" signal, adapted from NQC (Shtok, Kurland, Shtok, Bendersky, Raiber 2012)
    # — see _confidence for why it's computed on normalized rather than raw scores.
    confidence: float


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


def _percentile(sorted_values: list[float], p: float) -> float:
    """Linear interpolation between closest ranks — the conventional definition
    (matches numpy's default method), reimplemented directly since a single
    percentile-over-a-small-list computation doesn't justify a numpy dependency."""
    if len(sorted_values) == 1:
        return sorted_values[0]
    rank = (p / 100) * (len(sorted_values) - 1)
    lower = int(rank)
    upper = min(lower + 1, len(sorted_values) - 1)
    return sorted_values[lower] + (sorted_values[upper] - sorted_values[lower]) * (rank - lower)


def _confidence(sorted_scores: list[float]) -> float:
    """Adapted from NQC (Shtok et al., 2012): the dispersion of the top-k scores
    relative to their central tendency, as a proxy for whether the ranking is
    'committing' to a clear winner (spread out, one or few ahead of the pack) or
    looks flat/undecided (scores clustered together). The textbook formula is
    std/mean of the raw scores — not usable as-is here, since this app's
    z_score combiner can produce negative or near-zero-mean scores, which would
    make a raw ratio meaningless (or even flip sign). Computed on min-max
    normalized scores instead, which are always non-negative by construction."""
    score_range = sorted_scores[-1] - sorted_scores[0]
    if score_range == 0:
        return 0.0
    normalized = [(s - sorted_scores[0]) / score_range for s in sorted_scores]
    mean_norm = statistics.fmean(normalized)
    if mean_norm == 0:
        return 0.0
    return statistics.pstdev(normalized) / mean_norm


def _score_stats(results: list[dict]) -> ScoreStats | None:
    """Computed from a fixed top-STATS_TOP_K window of the returned hits' own
    (already-normalized) scores, not an OpenSearch aggregation over the full
    matching population — a hybrid query's normalization-processor only
    rewrites the returned hits' `_score`, it never touches aggregations, so a
    script aggregation on `_score` silently described the raw, pre-normalization
    combined score instead: a different, much wider scale than anything a hit
    ever actually shows (confirmed empirically — the aggregation's min/max came
    back identical whether or not the normalization pipeline was even attached
    to the request)."""
    if not results:
        return None
    # `results` is already rank-ordered (descending) by OpenSearch — gap reads
    # straight off that order before it gets discarded by sorting for the rest.
    gap = results[0]["score"] - results[1]["score"] if len(results) > 1 else 0.0
    scores = sorted(hit["score"] for hit in results)
    return ScoreStats(
        count=len(scores),
        min=scores[0],
        max=scores[-1],
        avg=statistics.fmean(scores),
        std_deviation=statistics.pstdev(scores),
        percentiles={str(p): _percentile(scores, p) for p in SCORE_PERCENTILES},
        gap=gap,
        confidence=_confidence(scores),
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
    # Otherwise hits.total silently caps at 10000 past that many matches.
    body["track_total_hits"] = True

    offset = (page - 1) * page_size
    if include_score_stats:
        # A single contiguous block starting at rank 1, covering both the
        # displayed page and the top-STATS_TOP_K stats window, so both are read
        # from the exact same normalization pass — two independent requests with
        # different `size` values could in principle normalize slightly
        # differently and disagree with each other (e.g. the displayed top hit's
        # score no longer exactly matching the stats' reported max).
        fetch_from, fetch_size = 0, max(STATS_TOP_K, offset + page_size)
    else:
        fetch_from, fetch_size = offset, page_size

    response = client.search(
        index=index_name(language_pack),
        body=body,
        size=fetch_size,
        from_=fetch_from,
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

    all_hits = [_hit_to_dict(hit) for hit in response["hits"]["hits"]]
    if include_score_stats:
        results = all_hits[offset : offset + page_size]
        score_stats = _score_stats(all_hits[:STATS_TOP_K])
    else:
        results = all_hits
        score_stats = None

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
        score_stats=score_stats,
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
