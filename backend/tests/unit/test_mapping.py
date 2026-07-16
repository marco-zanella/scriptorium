from app.search.mapping import build_mapping


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


def test_no_embedding_fields_yet() -> None:
    mapping = build_mapping()
    assert "embedding" not in mapping["properties"]
    assert "embedding" not in mapping["properties"]["variant"]["properties"]
