from opensearchpy import OpenSearch

from app.core.config import settings
from app.registry import LanguagePack
from app.search.mapping import build_mapping


def index_name(language_pack: LanguagePack) -> str:
    return f"{settings.opensearch_index_prefix}{language_pack.iso_code}"


def ensure_index(client: OpenSearch, language_pack: LanguagePack) -> str:
    """Idempotent create-if-not-exists for a language's index."""
    name = index_name(language_pack)
    if not client.indices.exists(index=name):
        client.indices.create(
            index=name,
            body={"settings": language_pack.analyzer_settings, "mappings": build_mapping()},
        )
    return name
