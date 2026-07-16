from app.registry.language_pack import EmbeddingSpec

CONTENT_MULTI_FIELDS = {
    "text": {"type": "text", "analyzer": "text", "search_analyzer": "text"},
    "shingle": {"type": "text", "analyzer": "shingle", "search_analyzer": "shingle"},
    "trigram": {"type": "text", "analyzer": "trigram", "search_analyzer": "trigram"},
}


def _knn_field(dimension: int) -> dict:
    # engine "lucene" specifically because variant.embedding is nested — nmslib/faiss
    # engines don't support k-NN fields inside nested documents.
    return {
        "type": "knn_vector",
        "dimension": dimension,
        "method": {"name": "hnsw", "engine": "lucene", "space_type": "cosinesimil"},
    }


def build_mapping(embedding_spec: EmbeddingSpec | None = None) -> dict:
    """Shared document mapping for all language indices.

    embedding/variant.embedding knn_vector fields are only added when embedding_spec
    is given (i.e. the language has a chosen model) — a language with no model yet
    gets the same text-only mapping as before.
    """
    properties = {
        "book": {"type": "keyword"},
        "chapter": {"type": "keyword"},
        "verse": {"type": "keyword"},
        "source": {"type": "keyword"},
        "content": {"type": "keyword", "fields": CONTENT_MULTI_FIELDS},
        "variant": {
            "type": "nested",
            "properties": {
                "source": {"type": "keyword"},
                "content": {"type": "keyword", "fields": CONTENT_MULTI_FIELDS},
            },
        },
    }
    if embedding_spec is not None:
        properties["embedding"] = _knn_field(embedding_spec.dimension)
        properties["variant"]["properties"]["embedding"] = _knn_field(embedding_spec.dimension)
    return {"properties": properties}
