from app.registry.analyzers import (
    icu_analysis_settings,
    language_aware_analysis_settings,
    merge_analysis_settings,
)
from app.registry.language_pack import EmbeddingSpec, LanguagePack
from app.search.mapping import build_mapping

SPEC = EmbeddingSpec(model_id="some/model", revision="main", dimension=768)


def _pack(analyzer_settings: dict, embedding_spec: EmbeddingSpec | None = None) -> LanguagePack:
    return LanguagePack(
        iso_code="xx",
        display_name="Test",
        script="Latin",
        directionality="ltr",
        analyzer_settings=analyzer_settings,
        embedding_spec=embedding_spec,
    )


NO_LANGUAGE_FIELD = _pack(icu_analysis_settings())
WITH_LANGUAGE_FIELD = _pack(
    merge_analysis_settings(icu_analysis_settings(), language_aware_analysis_settings("english"))
)
WITH_EMBEDDING = _pack(icu_analysis_settings(), embedding_spec=SPEC)


def test_content_has_text_shingle_trigram_subfields() -> None:
    mapping = build_mapping(NO_LANGUAGE_FIELD)
    content = mapping["properties"]["content"]
    assert content["type"] == "keyword"
    assert set(content["fields"]) == {"text", "shingle", "trigram"}


def test_variant_is_nested_with_same_content_shape() -> None:
    mapping = build_mapping(NO_LANGUAGE_FIELD)
    variant = mapping["properties"]["variant"]
    assert variant["type"] == "nested"
    variant_content = variant["properties"]["content"]
    assert variant_content["type"] == "keyword"
    assert set(variant_content["fields"]) == {"text", "shingle", "trigram"}


def test_language_field_absent_without_language_analyzer() -> None:
    mapping = build_mapping(NO_LANGUAGE_FIELD)
    assert "language" not in mapping["properties"]["content"]["fields"]


def test_language_field_present_when_analyzer_settings_define_it() -> None:
    mapping = build_mapping(WITH_LANGUAGE_FIELD)
    content = mapping["properties"]["content"]
    assert set(content["fields"]) == {"text", "shingle", "trigram", "language"}
    assert content["fields"]["language"] == {
        "type": "text",
        "analyzer": "language_index",
        "search_analyzer": "language_search",
    }
    assert (
        mapping["properties"]["variant"]["properties"]["content"]["fields"]["language"]
        == (content["fields"]["language"])
    )


def test_no_embedding_fields_without_embedding_spec() -> None:
    mapping = build_mapping(NO_LANGUAGE_FIELD)
    assert "embedding" not in mapping["properties"]
    assert "embedding" not in mapping["properties"]["variant"]["properties"]


def test_embedding_fields_added_when_embedding_spec_given() -> None:
    mapping = build_mapping(WITH_EMBEDDING)
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
