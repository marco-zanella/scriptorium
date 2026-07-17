from app.registry.language_pack import LanguagePack


def _knn_field(dimension: int) -> dict:
    # engine "lucene" specifically because variant.embedding is nested — nmslib/faiss
    # engines don't support k-NN fields inside nested documents.
    return {
        "type": "knn_vector",
        "dimension": dimension,
        "method": {"name": "hnsw", "engine": "lucene", "space_type": "cosinesimil"},
    }


def _content_multi_fields(language_pack: LanguagePack) -> dict:
    fields = {
        "text": {"type": "text", "analyzer": "text", "search_analyzer": "text"},
        "shingle": {"type": "text", "analyzer": "shingle", "search_analyzer": "shingle"},
        "trigram": {"type": "text", "analyzer": "trigram", "search_analyzer": "trigram"},
    }
    # "language" (real stemming/stopwords/synonyms) only exists for languages whose
    # analyzer_settings define it — absent for grc/lat, which have no Lucene analyzer
    # to base it on. Query builders reference content.language unconditionally;
    # OpenSearch silently no-ops on a field missing from the mapping.
    analyzers = language_pack.analyzer_settings.get("analysis", {}).get("analyzer", {})
    if "language_index" in analyzers:
        fields["language"] = {
            "type": "text",
            "analyzer": "language_index",
            "search_analyzer": "language_search",
        }
    return fields


def build_mapping(language_pack: LanguagePack) -> dict:
    """Shared document mapping for all language indices.

    embedding/variant.embedding knn_vector fields are only added when the language
    pack has an embedding_spec (i.e. a chosen model) — a language with no model yet
    gets the same mapping minus those two fields.
    """
    content_fields = _content_multi_fields(language_pack)
    properties = {
        "book": {"type": "keyword"},
        "chapter": {"type": "keyword"},
        "verse": {"type": "keyword"},
        "source": {"type": "keyword"},
        "content": {"type": "keyword", "fields": content_fields},
        "variant": {
            "type": "nested",
            "properties": {
                "source": {"type": "keyword"},
                "content": {"type": "keyword", "fields": content_fields},
            },
        },
    }
    if language_pack.embedding_spec is not None:
        properties["embedding"] = _knn_field(language_pack.embedding_spec.dimension)
        properties["variant"]["properties"]["embedding"] = _knn_field(
            language_pack.embedding_spec.dimension
        )
    return {"properties": properties}
