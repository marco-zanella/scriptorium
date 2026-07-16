from typing import Protocol

from app.registry.language_pack import EmbeddingSpec


class Encoder(Protocol):
    def encode(self, texts: list[str]) -> list[list[float]]: ...


class _SentenceTransformersEncoder:
    def __init__(self, spec: EmbeddingSpec) -> None:
        from sentence_transformers import SentenceTransformer

        self._model = SentenceTransformer(spec.model_id, revision=spec.revision)

    def encode(self, texts: list[str]) -> list[list[float]]:
        return [[float(x) for x in vector] for vector in self._model.encode(texts)]


class _MeanSkipFirstEncoder:
    """Mask-weighted mean over all tokens but the first, then L2-normalized.

    Reimplements the pooling this specific checkpoint was contrastively trained with
    (config.json's own "pooling_strategy": "mean", as used by resilient-search-engine's
    RetrieverModel) — a bare transformers checkpoint has no packaged pooling config of
    its own, so sentence-transformers' default pooling would not match.
    """

    def __init__(self, spec: EmbeddingSpec) -> None:
        from transformers import AutoModel, AutoTokenizer

        self._tokenizer = AutoTokenizer.from_pretrained(spec.model_id, revision=spec.revision)
        self._model = AutoModel.from_pretrained(spec.model_id, revision=spec.revision)
        self._model.eval()

    def encode(self, texts: list[str]) -> list[list[float]]:
        import torch
        import torch.nn.functional as F

        inputs = self._tokenizer(
            texts, padding=True, truncation=True, return_tensors="pt", max_length=512
        )
        with torch.inference_mode():
            hidden_states = self._model(**inputs).last_hidden_state

        attention_mask = inputs["attention_mask"][:, 1:, None]
        summed = (hidden_states[:, 1:] * attention_mask).sum(dim=1)
        counts = attention_mask.sum(dim=1)
        pooled = summed / counts
        normalized = F.normalize(pooled, p=2, dim=-1)
        return [list(vector) for vector in normalized.tolist()]


def load_model(spec: EmbeddingSpec) -> Encoder:
    if spec.pooling == "mean_skip_first":
        return _MeanSkipFirstEncoder(spec)
    return _SentenceTransformersEncoder(spec)


def encode_documents(model: Encoder, spec: EmbeddingSpec, texts: list[str]) -> list[list[float]]:
    prefix = spec.document_prefix or ""
    return model.encode([prefix + text for text in texts])


def encode_query(model: Encoder, spec: EmbeddingSpec, text: str) -> list[float]:
    prefix = spec.query_prefix or ""
    return model.encode([prefix + text])[0]
