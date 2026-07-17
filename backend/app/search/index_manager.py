from opensearchpy import OpenSearch

from app.core.config import settings
from app.registry import LanguagePack
from app.search.mapping import build_mapping


def index_name(language_pack: LanguagePack) -> str:
    return f"{settings.opensearch_index_prefix}{language_pack.iso_code}"


def ensure_index(client: OpenSearch, language_pack: LanguagePack) -> str:
    """Idempotent create-if-not-exists for a language's index.

    "index.knn" can only be set at index-creation time, not added to an existing
    index later — an index created before its language had an embedding_spec must
    be dropped and recreated to gain k-NN fields.
    """
    name = index_name(language_pack)
    if not client.indices.exists(index=name):
        settings_body = dict(language_pack.analyzer_settings)
        if language_pack.embedding_spec is not None:
            settings_body["index"] = {**settings_body.get("index", {}), "knn": True}
        client.indices.create(
            index=name,
            body={
                "settings": settings_body,
                "mappings": build_mapping(language_pack.embedding_spec),
            },
        )
    return name
