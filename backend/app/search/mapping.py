CONTENT_MULTI_FIELDS = {
    "text": {"type": "text", "analyzer": "text", "search_analyzer": "text"},
    "shingle": {"type": "text", "analyzer": "shingle", "search_analyzer": "shingle"},
    "trigram": {"type": "text", "analyzer": "trigram", "search_analyzer": "trigram"},
}


def build_mapping() -> dict:
    """Shared document mapping for all language indices.

    No embedding/dense_vector fields yet — deferred to Phase 4c, once an
    embedding model (and its dimension) has actually been chosen.
    """
    return {
        "properties": {
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
    }
