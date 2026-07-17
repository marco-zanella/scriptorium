from opensearchpy import OpenSearch, helpers

from app.registry import LanguagePack
from app.search.index_manager import index_name


class DimensionMismatchError(Exception):
    def __init__(self, path: str, expected: int, actual: int) -> None:
        self.path = path
        self.expected = expected
        self.actual = actual
        super().__init__(f"{path}: expected dimension {expected}, got {actual}")


def _validate_dimensions(documents: list[dict], dimension: int) -> None:
    for i, document in enumerate(documents):
        embedding = document.get("embedding") or []
        if len(embedding) != dimension:
            raise DimensionMismatchError(f"documents[{i}].embedding", dimension, len(embedding))
        for j, variant in enumerate(document.get("variant", [])):
            variant_embedding = variant.get("embedding") or []
            if len(variant_embedding) != dimension:
                raise DimensionMismatchError(
                    f"documents[{i}].variant[{j}].embedding", dimension, len(variant_embedding)
                )


def bulk_index_documents(
    client: OpenSearch, language_pack: LanguagePack, documents: list[dict]
) -> int:
    """Indexes documents that already carry embeddings.

    Every vector's dimension is validated against language_pack.embedding_spec
    before anything is sent to OpenSearch — the whole batch is rejected on any
    mismatch, never partially written, since OpenSearch hard-locks a knn_vector
    field's dimension after the first document is indexed.
    """
    if language_pack.embedding_spec is None:
        raise ValueError(f"{language_pack.iso_code} has no embedding_spec configured")

    _validate_dimensions(documents, language_pack.embedding_spec.dimension)

    name = index_name(language_pack)
    actions = ({"_index": name, "_source": document} for document in documents)
    success_count, _ = helpers.bulk(client, actions)
    return success_count
