from opensearchpy import OpenSearch, helpers

from app.registry import LanguagePack
from app.search.index_manager import index_name


class DimensionMismatchError(Exception):
    def __init__(self, path: str, expected: int, actual: int) -> None:
        self.path = path
        self.expected = expected
        self.actual = actual
        super().__init__(f"{path}: expected dimension {expected}, got {actual}")


class DuplicateIdError(Exception):
    def __init__(self, duplicate_ids: list[str]) -> None:
        self.duplicate_ids = duplicate_ids
        super().__init__(f"duplicate ids within batch: {', '.join(duplicate_ids)}")


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


def _validate_unique_ids(documents: list[dict]) -> None:
    """Two documents sharing an `id` within the same batch means something
    upstream generated a bad id, not a legitimate reingestion — a document's
    `id` doubling as the OpenSearch `_id` makes a same-batch collision silently
    overwrite one of the two, so this is caught and rejected up front instead.
    Re-pushing the same `id` in a *separate*, later call is the intended
    upsert path and is unaffected by this check."""
    seen: set[str] = set()
    duplicates: list[str] = []
    for document in documents:
        doc_id = document["id"]
        if doc_id in seen and doc_id not in duplicates:
            duplicates.append(doc_id)
        seen.add(doc_id)
    if duplicates:
        raise DuplicateIdError(duplicates)


def bulk_index_documents(
    client: OpenSearch, language_pack: LanguagePack, documents: list[dict]
) -> int:
    """Indexes documents that already carry embeddings.

    Every vector's dimension is validated against language_pack.embedding_spec,
    and every document's `id` is validated unique within the batch, before
    anything is sent to OpenSearch — the whole batch is rejected on any
    violation, never partially written, since OpenSearch hard-locks a
    knn_vector field's dimension after the first document is indexed.
    """
    if language_pack.embedding_spec is None:
        raise ValueError(f"{language_pack.iso_code} has no embedding_spec configured")

    _validate_unique_ids(documents)
    _validate_dimensions(documents, language_pack.embedding_spec.dimension)

    name = index_name(language_pack)
    actions = (
        {"_index": name, "_id": document["id"], "_source": document} for document in documents
    )
    success_count, _ = helpers.bulk(client, actions)
    return success_count
