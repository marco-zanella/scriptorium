from app.search.query import build_aggregations, build_query


def test_default_weights_produce_lexical_and_variant_clauses() -> None:
    query = build_query("agape")
    should = query["query"]["bool"]["should"]
    assert len(should) == 2
    multi_match = should[0]["multi_match"]
    assert multi_match["query"] == "agape"
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
    query = build_query("agape", weights={"text": 0.1, "shingle": 0, "trigram": 0})
    fields = query["query"]["bool"]["should"][0]["multi_match"]["fields"]
    assert fields == ["content.text^0.1"]


def test_all_zero_weights_and_no_variant_weights_is_match_none() -> None:
    query = build_query("agape", weights={"text": 0}, variant_weights={"text": 0})
    assert query == {"query": {"match_none": {}}}


def test_book_and_source_filters() -> None:
    query = build_query("agape", books=["genesis"], sources=["rahlfs"])
    filters = query["query"]["bool"]["filter"]
    assert {"terms": {"book": ["genesis"]}} in filters
    assert {"terms": {"source": ["rahlfs"]}} in filters


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


def test_language_and_semantic_weights_produce_field_references_generically() -> None:
    """No allowlist of "real" sub-fields — content.language/content.semantic don't
    exist in the mapping yet, but build_query doesn't need to know that; OpenSearch
    itself ignores unknown fields (verified against a live instance)."""
    query = build_query(
        "agape", weights={"text": 0, "shingle": 0, "trigram": 0, "language": 0.7, "semantic": 0.3}
    )
    fields = query["query"]["bool"]["should"][0]["multi_match"]["fields"]
    assert "content.language^0.7" in fields
    assert "content.semantic^0.3" in fields
