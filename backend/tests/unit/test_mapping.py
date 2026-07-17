from app.registry.language_pack import EmbeddingSpec
from app.search.mapping import build_mapping

SPEC = EmbeddingSpec(model_id="some/model", revision="main", dimension=768)


def test_content_has_text_shingle_trigram_subfields() -> None:
    mapping = build_mapping()
    content = mapping["properties"]["content"]
    assert content["type"] == "keyword"
    assert set(content["fields"]) == {"text", "shingle", "trigram"}


def test_variant_is_nested_with_same_content_shape() -> None:
    mapping = build_mapping()
    variant = mapping["properties"]["variant"]
    assert variant["type"] == "nested"
    variant_content = variant["properties"]["content"]
    assert variant_content["type"] == "keyword"
    assert set(variant_content["fields"]) == {"text", "shingle", "trigram"}


def test_no_embedding_fields_without_embedding_spec() -> None:
    mapping = build_mapping()
    assert "embedding" not in mapping["properties"]
    assert "embedding" not in mapping["properties"]["variant"]["properties"]


def test_embedding_fields_added_when_embedding_spec_given() -> None:
    mapping = build_mapping(SPEC)
    embedding = mapping["properties"]["embedding"]
    variant_embedding = mapping["properties"]["variant"]["properties"]["embedding"]
    for field in (embedding, variant_embedding):
        assert field["type"] == "knn_vector"
        assert field["dimension"] == 768
        assert field["method"] == {
            "name": "hnsw",
            "engine": "lucene",
            "space_type": "cosinesimil",
        }
