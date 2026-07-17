DEFAULT_WEIGHTS = {"text": 0.1, "shingle": 0.1, "trigram": 0.1, "language": 0.0, "semantic": 0.0}
DEFAULT_VARIANT_WEIGHTS = {
    "text": 0.25,
    "shingle": 0.25,
    "trigram": 0.25,
    "language": 0.0,
    "semantic": 0.0,
}
DEFAULT_BUCKET_WEIGHTS = {"lexical": 0.5, "semantic": 0.5}
DEFAULT_COMBINER = {"technique": "rrf", "rank_constant": 60}
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
    `variant.embedding`. book/source filters go on the outer bool (like
    build_lexical_query), not each knn clause's own `filter` param — the nested
    variant knn can't use that param for parent-level fields like `book`/`source`
    (they don't exist inside the nested `variant` object), so a single consistent
    mechanism is used for both.

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
    - "rrf" (default): score-ranker-processor, rank-based — sidesteps needing
      per-language score-scale tuning (grc/lat's ICU-only lexical scores and
      eng/ita/arb's now-stemmed ones live on very different scales).
    - "min_max" / "l2" / "z_score": normalization-processor, score-based, crossed
      with combiner["combination"] (arithmetic_mean/geometric_mean/harmonic_mean —
      z_score only works with arithmetic_mean, since the other two can't combine
      z-score's negative values).

    bucket_weights (lexical/semantic overall balance) feeds the combiner's own
    `weights` param — this is the only lever that survives score normalization;
    the per-field weights/variant_weights only affect ranking *within* a bucket."""
    weights = [bucket_weights.get("lexical", 0.5), bucket_weights.get("semantic", 0.5)]
    technique = combiner.get("technique", "rrf")

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


def build_aggregations(include_score_stats: bool = False) -> dict:
    """Facet buckets for the results sidebar — book/source counts across all
    matches, not just the returned page. Score distribution stats are opt-in:
    they run a Painless script per matching document (real cost), so only
    computed when the frontend's score-distribution panel is actually open."""
    aggs = {
        "by_book": {"terms": {"field": "book", "size": 1000}},
        "by_source": {"terms": {"field": "source", "size": 1000}},
    }
    if include_score_stats:
        aggs["score_stats"] = {"extended_stats": {"script": {"source": "_score"}}}
        aggs["score_percentiles"] = {
            "percentiles": {"script": {"source": "_score"}, "percents": SCORE_PERCENTILES}
        }
    return aggs
