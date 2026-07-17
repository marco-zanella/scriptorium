from app.search.query import (
    build_aggregations,
    build_combiner_pipeline,
    build_hybrid_body,
    build_lexical_query,
    build_semantic_query,
)

VECTOR = [0.1, 0.2, 0.3]


def test_default_weights_produce_lexical_and_variant_clauses() -> None:
    lexical = build_lexical_query(
        "agape",
        weights={"text": 0.1, "shingle": 0.1, "trigram": 0.1},
        variant_weights={"text": 0.25, "shingle": 0.25, "trigram": 0.25},
    )
    should = lexical["bool"]["should"]
    assert len(should) == 2
    multi_match = should[0]["multi_match"]
    assert multi_match["query"] == "agape"
    assert multi_match["type"] == "most_fields"
    assert multi_match["fields"] == [
        "content.text^0.1",
        "content.shingle^0.1",
        "content.trigram^0.1",
    ]
    nested = should[1]["nested"]
    assert nested["path"] == "variant"
    assert nested["query"]["multi_match"]["fields"] == [
        "variant.content.text^0.25",
        "variant.content.shingle^0.25",
        "variant.content.trigram^0.25",
    ]


def test_zero_weight_fields_are_omitted() -> None:
    lexical = build_lexical_query(
        "agape", weights={"text": 0.1, "shingle": 0, "trigram": 0}, variant_weights={}
    )
    fields = lexical["bool"]["should"][0]["multi_match"]["fields"]
    assert fields == ["content.text^0.1"]


def test_lexical_query_is_none_when_all_weights_zero() -> None:
    assert build_lexical_query("agape", weights={"text": 0}, variant_weights={"text": 0}) is None


def test_lexical_book_and_source_filters() -> None:
    lexical = build_lexical_query(
        "agape", weights={"text": 0.1}, variant_weights={}, books=["genesis"], sources=["rahlfs"]
    )
    filters = lexical["bool"]["filter"]
    assert {"terms": {"book": ["genesis"]}} in filters
    assert {"terms": {"source": ["rahlfs"]}} in filters


def test_lexical_query_ignores_semantic_weight() -> None:
    """semantic isn't a content sub-field — it must never leak into the multi_match
    fields list, unlike language/text/shingle/trigram which are real (or silently
    absent) content sub-fields."""
    lexical = build_lexical_query(
        "agape", weights={"text": 0, "language": 0.7, "semantic": 0.3}, variant_weights={}
    )
    fields = lexical["bool"]["should"][0]["multi_match"]["fields"]
    assert fields == ["content.language^0.7"]


def test_language_field_is_referenced_generically() -> None:
    """No allowlist of "real" sub-fields — content.language may not exist in a given
    language's mapping (grc/lat), but build_lexical_query doesn't need to know that;
    OpenSearch itself ignores an unknown field (verified against a live instance)."""
    lexical = build_lexical_query("agape", weights={"text": 0, "language": 0.7}, variant_weights={})
    assert "content.language^0.7" in lexical["bool"]["should"][0]["multi_match"]["fields"]


def test_semantic_query_knn_and_nested_knn_clauses() -> None:
    semantic = build_semantic_query(
        VECTOR, weights={"semantic": 0.6}, variant_weights={"semantic": 0.4}, k=10
    )
    should = semantic["bool"]["should"]
    assert should[0]["knn"]["embedding"] == {"vector": VECTOR, "k": 10, "boost": 0.6}
    nested = should[1]["nested"]
    assert nested["path"] == "variant"
    assert nested["query"]["knn"]["variant.embedding"] == {"vector": VECTOR, "k": 10, "boost": 0.4}


def test_semantic_query_is_none_when_both_weights_zero() -> None:
    assert (
        build_semantic_query(VECTOR, weights={"semantic": 0}, variant_weights={"semantic": 0})
        is None
    )


def test_semantic_query_book_and_source_filters_on_outer_bool() -> None:
    """Filters go on the outer bool, not each knn clause's own `filter` param —
    the nested variant.embedding knn can't filter on parent-level fields like
    book/source (they don't exist inside the nested `variant` object)."""
    semantic = build_semantic_query(
        VECTOR, weights={"semantic": 0.5}, variant_weights={}, books=["genesis"]
    )
    assert {"terms": {"book": ["genesis"]}} in semantic["bool"]["filter"]
    assert "filter" not in semantic["bool"]["should"][0]["knn"]["embedding"]


def test_hybrid_body_single_bucket_when_only_lexical_active() -> None:
    body = build_hybrid_body(
        "agape", query_vector=None, weights={"text": 0.5}, variant_weights={"text": 0.5}
    )
    assert "hybrid" not in body["query"]
    assert "search_pipeline" not in body
    assert body["query"]["bool"]["should"][0]["multi_match"]["query"] == "agape"


def test_hybrid_body_single_bucket_when_only_semantic_active() -> None:
    body = build_hybrid_body(
        "agape", query_vector=VECTOR, weights={"text": 0, "semantic": 1.0}, variant_weights={}
    )
    assert "hybrid" not in body["query"]
    assert "search_pipeline" not in body
    assert body["query"]["bool"]["should"][0]["knn"]["embedding"]["vector"] == VECTOR


def test_hybrid_body_skips_semantic_without_query_vector() -> None:
    """A language with no embedding_spec passes query_vector=None — the semantic
    bucket must never be attempted even if weights ask for it."""
    body = build_hybrid_body(
        "agape", query_vector=None, weights={"text": 0.5, "semantic": 1.0}, variant_weights={}
    )
    assert "hybrid" not in body["query"]
    assert "knn" not in str(body)


def test_hybrid_body_match_none_when_nothing_active() -> None:
    body = build_hybrid_body(
        "agape", query_vector=None, weights={"text": 0}, variant_weights={"text": 0}
    )
    assert body == {"query": {"match_none": {}}}


def test_hybrid_body_two_buckets_wraps_in_hybrid_query_with_pipeline() -> None:
    body = build_hybrid_body(
        "agape",
        query_vector=VECTOR,
        weights={"text": 0.5, "semantic": 0.5},
        variant_weights={},
        bucket_weights={"lexical": 0.3, "semantic": 0.7},
    )
    queries = body["query"]["hybrid"]["queries"]
    assert len(queries) == 2
    assert "multi_match" in queries[0]["bool"]["should"][0]
    assert "knn" in queries[1]["bool"]["should"][0]
    processor = body["search_pipeline"]["phase_results_processors"][0]
    assert processor["score-ranker-processor"]["combination"]["technique"] == "rrf"
    assert processor["score-ranker-processor"]["combination"]["parameters"]["weights"] == [0.3, 0.7]


def test_combiner_pipeline_rrf_default() -> None:
    pipeline = build_combiner_pipeline({"technique": "rrf"}, {"lexical": 0.5, "semantic": 0.5})
    combination = pipeline["phase_results_processors"][0]["score-ranker-processor"]["combination"]
    assert combination["rank_constant"] == 60
    assert combination["parameters"]["weights"] == [0.5, 0.5]


def test_combiner_pipeline_rrf_custom_rank_constant() -> None:
    pipeline = build_combiner_pipeline(
        {"technique": "rrf", "rank_constant": 40}, {"lexical": 0.5, "semantic": 0.5}
    )
    combination = pipeline["phase_results_processors"][0]["score-ranker-processor"]["combination"]
    assert combination["rank_constant"] == 40


def test_combiner_pipeline_normalization_technique() -> None:
    pipeline = build_combiner_pipeline(
        {"technique": "min_max", "combination": "geometric_mean"}, {"lexical": 0.3, "semantic": 0.7}
    )
    processor = pipeline["phase_results_processors"][0]["normalization-processor"]
    assert processor["normalization"]["technique"] == "min_max"
    assert processor["combination"]["technique"] == "geometric_mean"
    assert processor["combination"]["parameters"]["weights"] == [0.3, 0.7]


def test_aggregations_request_book_and_source_buckets() -> None:
    aggs = build_aggregations()
    assert aggs["by_book"]["terms"]["field"] == "book"
    assert aggs["by_source"]["terms"]["field"] == "source"
    assert "score_stats" not in aggs
    assert "score_percentiles" not in aggs


def test_aggregations_include_score_stats_when_requested() -> None:
    aggs = build_aggregations(include_score_stats=True)
    assert aggs["score_stats"]["extended_stats"]["script"] == {"source": "_score"}
    assert aggs["score_percentiles"]["percentiles"]["script"] == {"source": "_score"}
    assert aggs["score_percentiles"]["percentiles"]["percents"]
