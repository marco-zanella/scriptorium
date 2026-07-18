import pytest

from app.registry.language_pack import EmbeddingSpec, LanguagePack
from app.search.ingest import DimensionMismatchError, DuplicateIdError, _validate_dimensions

SPEC = EmbeddingSpec(model_id="x", revision="main", dimension=3)
PACK = LanguagePack(
    iso_code="xx",
    display_name="Test",
    script="Latin",
    directionality="ltr",
    analyzer_settings={},
    embedding_spec=SPEC,
)


def test_valid_dimensions_pass() -> None:
    documents = [
        {"id": "a", "content": "a", "embedding": [0.1, 0.2, 0.3]},
        {
            "id": "b",
            "content": "b",
            "embedding": [0.1, 0.2, 0.3],
            "variant": [{"content": "v", "embedding": [0.4, 0.5, 0.6]}],
        },
    ]
    _validate_dimensions(documents, SPEC.dimension)  # doesn't raise


def test_document_embedding_dimension_mismatch_raises() -> None:
    documents = [{"id": "a", "content": "a", "embedding": [0.1, 0.2]}]
    with pytest.raises(DimensionMismatchError) as exc_info:
        _validate_dimensions(documents, SPEC.dimension)
    assert exc_info.value.path == "documents[0].embedding"
    assert exc_info.value.expected == 3
    assert exc_info.value.actual == 2


def test_variant_embedding_dimension_mismatch_raises() -> None:
    documents = [
        {
            "id": "a",
            "content": "a",
            "embedding": [0.1, 0.2, 0.3],
            "variant": [{"content": "v", "embedding": [0.1]}],
        }
    ]
    with pytest.raises(DimensionMismatchError) as exc_info:
        _validate_dimensions(documents, SPEC.dimension)
    assert exc_info.value.path == "documents[0].variant[0].embedding"


def test_one_bad_document_fails_before_any_indexing_happens(monkeypatch) -> None:
    """The whole batch must be rejected on any mismatch — no partial writes,
    since OpenSearch locks a knn_vector field's dimension after the first document."""
    import app.search.ingest as ingest_module

    def _bulk_should_not_be_called(*args, **kwargs):
        raise AssertionError("bulk indexing must not run when validation fails")

    monkeypatch.setattr(ingest_module.helpers, "bulk", _bulk_should_not_be_called)

    documents = [
        {"id": "good", "content": "good", "embedding": [0.1, 0.2, 0.3]},
        {"id": "bad", "content": "bad", "embedding": [0.1]},
    ]
    with pytest.raises(DimensionMismatchError):
        ingest_module.bulk_index_documents(client=object(), language_pack=PACK, documents=documents)


def test_duplicate_id_within_batch_raises() -> None:
    from app.search.ingest import _validate_unique_ids

    documents = [{"id": "dup"}, {"id": "dup"}]
    with pytest.raises(DuplicateIdError) as exc_info:
        _validate_unique_ids(documents)
    assert exc_info.value.duplicate_ids == ["dup"]


def test_duplicate_id_fails_before_any_indexing_happens(monkeypatch) -> None:
    """Same whole-batch-rejection guarantee as dimension mismatches — a
    same-batch id collision must never partially write either."""
    import app.search.ingest as ingest_module

    def _bulk_should_not_be_called(*args, **kwargs):
        raise AssertionError("bulk indexing must not run when validation fails")

    monkeypatch.setattr(ingest_module.helpers, "bulk", _bulk_should_not_be_called)

    documents = [
        {"id": "same", "content": "a", "embedding": [0.1, 0.2, 0.3]},
        {"id": "same", "content": "b", "embedding": [0.1, 0.2, 0.3]},
    ]
    with pytest.raises(DuplicateIdError):
        ingest_module.bulk_index_documents(client=object(), language_pack=PACK, documents=documents)


def test_bulk_index_uses_provided_id_as_opensearch_id(monkeypatch) -> None:
    import app.search.ingest as ingest_module

    captured_actions = []

    def _capture_bulk(client, actions):
        captured_actions.extend(actions)
        return len(captured_actions), []

    monkeypatch.setattr(ingest_module.helpers, "bulk", _capture_bulk)

    documents = [{"id": "genesis-1-1", "content": "a", "embedding": [0.1, 0.2, 0.3]}]
    ingest_module.bulk_index_documents(client=object(), language_pack=PACK, documents=documents)

    assert captured_actions[0]["_id"] == "genesis-1-1"


def test_missing_embedding_spec_raises_value_error() -> None:
    pack_without_spec = LanguagePack(
        iso_code="yy",
        display_name="Test2",
        script="Latin",
        directionality="ltr",
        analyzer_settings={},
    )
    with pytest.raises(ValueError, match="no embedding_spec configured"):
        from app.search.ingest import bulk_index_documents

        bulk_index_documents(client=object(), language_pack=pack_without_spec, documents=[])
