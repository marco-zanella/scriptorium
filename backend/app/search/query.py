DEFAULT_WEIGHTS = {"text": 0.1, "shingle": 0.1, "trigram": 0.1, "language": 0.0, "semantic": 0.0}
DEFAULT_VARIANT_WEIGHTS = {
    "text": 0.25,
    "shingle": 0.25,
    "trigram": 0.25,
    "language": 0.0,
    "semantic": 0.0,
}
DEFAULT_BUCKET_WEIGHTS = {"lexical": 0.5, "semantic": 0.5}
DEFAULT_COMBINER = {"technique": "z_score", "combination": "arithmetic_mean"}
DEFAULT_KNN_K = 25

# text/shingle/trigram/language are all multi_match sub-fields of `content`; semantic
# is handled separately by build_semantic_query (a knn query against the top-level
# `embedding` field, not a content sub-field at all).
LEXICAL_FIELDS = ("text", "shingle", "trigram", "language")


def _filters(books: list[str] | None, sources: list[str] | None) -> list[dict]:
    filters = []
    if books:
        filters.append({"terms": {"book": books}})
    if sources:
        filters.append({"terms": {"source": sources}})
    return filters


def build_lexical_query(
    query: str,
    weights: dict[str, float],
    variant_weights: dict[str, float],
    books: list[str] | None = None,
    sources: list[str] | None = None,
) -> dict | None:
    """Bucket 1 of the hybrid query: multi_match over content's text/shingle/trigram/
    language sub-fields, plus the same over nested variant.content.

    `type: most_fields`, not the multi_match default `best_fields` — text/shingle/
    trigram/language are now genuinely complementary analyses of the same content
    (orthographic vs. linguistic), so a document matching on more of them should
    score higher, not just take the single best-matching field's score.

    A field with no real analyzer in the mapping (e.g. `language` for grc/lat, which
    has no Lucene analyzer to base it on) is referenced the same as any other —
    OpenSearch silently ignores a multi_match field that doesn't exist in the index.

    book/source filters are embedded here (not applied as a `post_filter`) so the
    hybrid combiner normalizes/combines scores over the exact same candidate
    population that gets returned — confirmed empirically that a `post_filter`
    approach can reorder results relative to this (the combiner's z-score/rank
    statistics depend on the retrieved population, so filtering via a different
    mechanism than the query itself is not guaranteed to preserve ranking). See
    build_facets_body for how facet aggregations get accurate multi-select counts
    without touching this query's filtering.

    Returns None when no field has a positive weight (nothing to search)."""
    should = []

    fields = [
        f"content.{field}^{weights[field]}" for field in LEXICAL_FIELDS if weights.get(field, 0) > 0
    ]
    if fields:
        should.append({"multi_match": {"query": query, "fields": fields, "type": "most_fields"}})

    variant_fields = [
        f"variant.content.{field}^{variant_weights[field]}"
        for field in LEXICAL_FIELDS
        if variant_weights.get(field, 0) > 0
    ]
    if variant_fields:
        should.append(
            {
                "nested": {
                    "path": "variant",
                    "score_mode": "max",
                    "query": {
                        "multi_match": {
                            "query": query,
                            "fields": variant_fields,
                            "type": "most_fields",
                        }
                    },
                }
            }
        )

    if not should:
        return None

    return {
        "bool": {"should": should, "filter": _filters(books, sources), "minimum_should_match": 1}
    }


def build_semantic_query(
    query_vector: list[float],
    weights: dict[str, float],
    variant_weights: dict[str, float],
    books: list[str] | None = None,
    sources: list[str] | None = None,
    k: int = DEFAULT_KNN_K,
) -> dict | None:
    """Bucket 2 of the hybrid query: knn on `embedding`, plus a nested knn on
    `variant.embedding`. book/source filters embedded here too — see
    build_lexical_query's docstring; same reasoning applies.

    Returns None when neither weight is positive (nothing to search)."""
    should = []

    if weights.get("semantic", 0) > 0:
        should.append(
            {"knn": {"embedding": {"vector": query_vector, "k": k, "boost": weights["semantic"]}}}
        )

    if variant_weights.get("semantic", 0) > 0:
        should.append(
            {
                "nested": {
                    "path": "variant",
                    "score_mode": "max",
                    "query": {
                        "knn": {
                            "variant.embedding": {
                                "vector": query_vector,
                                "k": k,
                                "boost": variant_weights["semantic"],
                            }
                        }
                    },
                }
            }
        )

    if not should:
        return None

    return {
        "bool": {"should": should, "filter": _filters(books, sources), "minimum_should_match": 1}
    }


def build_combiner_pipeline(combiner: dict, bucket_weights: dict[str, float]) -> dict:
    """search_pipeline body for the phase_results_processor that combines the
    lexical and semantic buckets' scores. `combiner["technique"]` selects:
    - "min_max" / "l2" / "z_score" (default: "z_score"): normalization-processor,
      score-based, crossed with combiner["combination"] (arithmetic_mean/
      geometric_mean/harmonic_mean — z_score only works with arithmetic_mean,
      since the other two can't combine z-score's negative values).
    - "rrf": score-ranker-processor, rank-based — sidesteps needing per-language
      score-scale tuning (grc/lat's ICU-only lexical scores and eng/ita/arb's
      now-stemmed ones live on very different scales), at the cost of losing
      "how much stronger" one bucket's top hit is.

    bucket_weights (lexical/semantic overall balance) feeds the combiner's own
    `weights` param — this is the only lever that survives score normalization;
    the per-field weights/variant_weights only affect ranking *within* a bucket."""
    weights = [bucket_weights.get("lexical", 0.5), bucket_weights.get("semantic", 0.5)]
    technique = combiner.get("technique", "z_score")

    if technique == "rrf":
        return {
            "phase_results_processors": [
                {
                    "score-ranker-processor": {
                        "combination": {
                            "technique": "rrf",
                            "rank_constant": combiner.get("rank_constant", 60),
                            "parameters": {"weights": weights},
                        }
                    }
                }
            ]
        }

    return {
        "phase_results_processors": [
            {
                "normalization-processor": {
                    "normalization": {"technique": technique},
                    "combination": {
                        "technique": combiner.get("combination", "arithmetic_mean"),
                        "parameters": {"weights": weights},
                    },
                }
            }
        ]
    }


def build_hybrid_body(
    query: str,
    query_vector: list[float] | None,
    weights: dict[str, float] | None = None,
    variant_weights: dict[str, float] | None = None,
    bucket_weights: dict[str, float] | None = None,
    combiner: dict | None = None,
    books: list[str] | None = None,
    sources: list[str] | None = None,
    k: int = DEFAULT_KNN_K,
) -> dict:
    """Assembles the full search request body's query (+ search_pipeline, when
    needed). Picks single-bucket vs. two-bucket hybrid based on which weights are
    actually active — a lexical-only or semantic-only preset (e.g. the "text reuse"/
    "semantic" presets) never pays for, or risks a degenerate min-max normalization
    over, a bucket that has nothing in it.

    query_vector is the caller-computed query embedding (None for a language with no
    embedding_spec, in which case the semantic bucket is always skipped)."""
    weights = weights if weights is not None else DEFAULT_WEIGHTS
    variant_weights = variant_weights if variant_weights is not None else DEFAULT_VARIANT_WEIGHTS
    bucket_weights = bucket_weights if bucket_weights is not None else DEFAULT_BUCKET_WEIGHTS
    combiner = combiner if combiner is not None else DEFAULT_COMBINER

    lexical = build_lexical_query(query, weights, variant_weights, books, sources)
    semantic = (
        build_semantic_query(query_vector, weights, variant_weights, books, sources, k)
        if query_vector is not None
        else None
    )

    if lexical is None and semantic is None:
        return {"query": {"match_none": {}}}
    if semantic is None:
        return {"query": lexical}
    if lexical is None:
        return {"query": semantic}

    return {
        "query": {"hybrid": {"queries": [lexical, semantic]}},
        "search_pipeline": build_combiner_pipeline(combiner, bucket_weights),
    }


SCORE_PERCENTILES = [1, 5, 25, 50, 75, 95, 99]


def build_score_stats_aggregations() -> dict:
    """Opt-in score-distribution aggregations, attached to the *same* request as
    the actual hits (not the separate facets request below) — this describes the
    exact result set being returned, so there's no risk of it describing a
    different candidate population. Real cost (a Painless script per matching
    document), so only requested when the frontend's score-distribution panel is
    open."""
    return {
        "score_stats": {"extended_stats": {"script": {"source": "_score"}}},
        "score_percentiles": {
            "percentiles": {"script": {"source": "_score"}, "percents": SCORE_PERCENTILES}
        },
    }


def _facet_aggregation(field: str, books: list[str] | None, sources: list[str] | None) -> dict:
    """Wraps a terms aggregation in a filter aggregation reapplying every OTHER
    active book/source filter except this facet's own field — lets users
    multi-select within a facet (e.g. genesis AND exodus) instead of each
    selection collapsing that facet down to only the already-selected value."""
    other_filters = []
    if books and field != "book":
        other_filters.append({"terms": {"book": books}})
    if sources and field != "source":
        other_filters.append({"terms": {"source": sources}})
    return {
        "filter": {"bool": {"filter": other_filters}},
        "aggs": {"values": {"terms": {"field": field, "size": 1000}}},
    }


def build_facets_body(
    query: str | None,
    query_vector: list[float] | None = None,
    weights: dict[str, float] | None = None,
    variant_weights: dict[str, float] | None = None,
    books: list[str] | None = None,
    sources: list[str] | None = None,
    k: int = DEFAULT_KNN_K,
) -> dict:
    """A separate, size-0 request body for book/source facet counts — deliberately
    decoupled from build_hybrid_body's combiner.

    Facets only need document *membership* (does this doc match at all), not a
    combined relevance score, so this reproduces the same two sub-queries as a
    plain `bool`/`should` — no `hybrid` query type, no search_pipeline. This
    sidesteps a real correctness risk rather than accepting it: the hybrid
    combiner (z-score by default) normalizes scores relative to whatever
    candidate population a query retrieves, so filtering the *same* request a
    second way (e.g. `post_filter`) is not guaranteed to preserve the ranking
    build_hybrid_body produces — confirmed empirically (2 of 360 Genesis
    documents swapped relative rank between an embedded-filter and a post_filter
    version of an otherwise identical query). Keeping build_hybrid_body's
    filtering untouched and giving facets their own unscored request removes
    that risk entirely, rather than trading it for cheaper compute.

    `query=None` is "browse" mode (no search text yet, e.g. the filter sidebar
    populating before the user has typed anything) — matches every document,
    same as an unfiltered `match_all`, so facets reflect the whole language
    (crossed with whatever books/sources are already pre-selected)."""
    weights = weights if weights is not None else DEFAULT_WEIGHTS
    variant_weights = variant_weights if variant_weights is not None else DEFAULT_VARIANT_WEIGHTS

    if query is None:
        return {
            "query": {"match_all": {}},
            "aggs": {
                "by_book": _facet_aggregation("book", books, sources),
                "by_source": _facet_aggregation("source", books, sources),
            },
        }

    lexical = build_lexical_query(query, weights, variant_weights)
    semantic = (
        build_semantic_query(query_vector, weights, variant_weights, k=k)
        if query_vector is not None
        else None
    )
    should = [clause for clause in (lexical, semantic) if clause is not None]
    match_query = (
        {"bool": {"should": should, "minimum_should_match": 1}} if should else {"match_none": {}}
    )

    return {
        "query": match_query,
        "aggs": {
            "by_book": _facet_aggregation("book", books, sources),
            "by_source": _facet_aggregation("source", books, sources),
        },
    }
