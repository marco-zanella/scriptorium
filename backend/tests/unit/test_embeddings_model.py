from app.embeddings.model import encode_documents, encode_query
from app.registry.language_pack import EmbeddingSpec


class _StubEncoder:
    """Records exactly what text it was asked to encode, one fixed-length vector each."""

    def __init__(self) -> None:
        self.seen: list[str] = []

    def encode(self, texts: list[str]) -> list[list[float]]:
        self.seen.extend(texts)
        return [[float(len(text))] for text in texts]


def test_encode_documents_applies_document_prefix() -> None:
    spec = EmbeddingSpec(model_id="x", revision="main", dimension=1, document_prefix="passage: ")
    encoder = _StubEncoder()
    encode_documents(encoder, spec, ["hello", "world"])
    assert encoder.seen == ["passage: hello", "passage: world"]


def test_encode_documents_no_prefix_when_symmetric() -> None:
    spec = EmbeddingSpec(model_id="x", revision="main", dimension=1)
    encoder = _StubEncoder()
    encode_documents(encoder, spec, ["hello"])
    assert encoder.seen == ["hello"]


def test_encode_query_applies_query_prefix() -> None:
    spec = EmbeddingSpec(model_id="x", revision="main", dimension=1, query_prefix="query: ")
    encoder = _StubEncoder()
    result = encode_query(encoder, spec, "hello")
    assert encoder.seen == ["query: hello"]
    assert result == [float(len("query: hello"))]


def test_encode_query_no_prefix_when_symmetric() -> None:
    spec = EmbeddingSpec(model_id="x", revision="main", dimension=1)
    encoder = _StubEncoder()
    encode_query(encoder, spec, "hello")
    assert encoder.seen == ["hello"]
