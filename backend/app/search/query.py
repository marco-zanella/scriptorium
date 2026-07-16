DEFAULT_WEIGHTS = {"text": 0.1, "shingle": 0.1, "trigram": 0.1, "language": 0.0, "semantic": 0.0}
DEFAULT_VARIANT_WEIGHTS = {
    "text": 0.25,
    "shingle": 0.25,
    "trigram": 0.25,
    "language": 0.0,
    "semantic": 0.0,
}


def build_query(
    query: str,
    weights: dict[str, float] | None = None,
    variant_weights: dict[str, float] | None = None,
    books: list[str] | None = None,
    sources: list[str] | None = None,
) -> dict:
    """Lexical-only query: multi_match over content's sub-fields, plus the same
    over nested variant.content. No knn/hybrid combination here — that's Phase 4c,
    and how it combines with this query is not decided (see plan).

    weights/variant_weights may include "language"/"semantic" keys (sent by the
    frontend's "Language Aware"/"Semantics" configuration categories) — these
    reference content.language/content.semantic fields that don't exist in the
    mapping yet, which OpenSearch silently ignores (no match, no error), so
    they're inert until Phase 4c/4d adds the real fields, with no code change
    needed here when that happens."""
    weights = weights if weights is not None else DEFAULT_WEIGHTS
    variant_weights = variant_weights if variant_weights is not None else DEFAULT_VARIANT_WEIGHTS

    should = []

    fields = [f"content.{field}^{weight}" for field, weight in weights.items() if weight > 0]
    if fields:
        should.append({"multi_match": {"query": query, "fields": fields}})

    variant_fields = [
        f"variant.content.{field}^{weight}"
        for field, weight in variant_weights.items()
        if weight > 0
    ]
    if variant_fields:
        should.append(
            {
                "nested": {
                    "path": "variant",
                    "score_mode": "max",
                    "query": {"multi_match": {"query": query, "fields": variant_fields}},
                }
            }
        )

    if not should:
        return {"query": {"match_none": {}}}

    filters = []
    if books:
        filters.append({"terms": {"book": books}})
    if sources:
        filters.append({"terms": {"source": sources}})

    return {"query": {"bool": {"should": should, "filter": filters, "minimum_should_match": 1}}}


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
