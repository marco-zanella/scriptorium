from functools import lru_cache

from opensearchpy import OpenSearch

from app.core.config import settings


@lru_cache
def get_client() -> OpenSearch:
    return OpenSearch(
        hosts=[{"host": settings.opensearch_host, "port": settings.opensearch_port}],
        use_ssl=False,
    )
