import pytest

from app.registry.language_pack import EmbeddingSpec, LanguagePack
from app.search.ingest import DimensionMismatchError, _validate_dimensions

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
        {"content": "a", "embedding": [0.1, 0.2, 0.3]},
        {
            "content": "b",
            "embedding": [0.1, 0.2, 0.3],
            "variant": [{"content": "v", "embedding": [0.4, 0.5, 0.6]}],
        },
    ]
    _validate_dimensions(documents, SPEC.dimension)  # doesn't raise


def test_document_embedding_dimension_mismatch_raises() -> None:
    documents = [{"content": "a", "embedding": [0.1, 0.2]}]
    with pytest.raises(DimensionMismatchError) as exc_info:
        _validate_dimensions(documents, SPEC.dimension)
    assert exc_info.value.path == "documents[0].embedding"
    assert exc_info.value.expected == 3
    assert exc_info.value.actual == 2


def test_variant_embedding_dimension_mismatch_raises() -> None:
    documents = [
        {
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
        {"content": "good", "embedding": [0.1, 0.2, 0.3]},
        {"content": "bad", "embedding": [0.1]},
    ]
    with pytest.raises(DimensionMismatchError):
        ingest_module.bulk_index_documents(client=object(), language_pack=PACK, documents=documents)


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
