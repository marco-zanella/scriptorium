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

    The checkpoint's own config.json declares "model_type": "retriever" — the old repo's
    custom PreTrainedModel subclass, unrecognized by transformers' AutoModel — wrapping a
    standard base-architecture model under a "embedding_model." key prefix plus one unrelated
    "logit_scale" scalar (a contrastive-training artifact, irrelevant to inference). Loading
    it here means building the plain base architecture from base_model_id and loading only
    the "embedding_model."-prefixed weights into it, rather than replicating that wrapper class.
    """

    _WEIGHT_PREFIX = "embedding_model."

    def __init__(self, spec: EmbeddingSpec) -> None:
        import torch
        from huggingface_hub import hf_hub_download
        from safetensors.torch import load_file
        from transformers import AutoConfig, AutoModel, AutoTokenizer

        base_model_id = spec.base_model_id or spec.model_id
        self._device = "cuda" if torch.cuda.is_available() else "cpu"
        self._tokenizer = AutoTokenizer.from_pretrained(base_model_id)

        config = AutoConfig.from_pretrained(base_model_id)
        self._model = AutoModel.from_config(config)

        weights_path = hf_hub_download(spec.model_id, "model.safetensors", revision=spec.revision)
        state_dict = load_file(weights_path)
        base_state_dict = {
            key[len(self._WEIGHT_PREFIX) :]: value
            for key, value in state_dict.items()
            if key.startswith(self._WEIGHT_PREFIX)
        }
        self._model.load_state_dict(base_state_dict, strict=True)
        self._model.to(self._device)
        self._model.eval()

    _BATCH_SIZE = 32

    def encode(self, texts: list[str]) -> list[list[float]]:
        import torch
        import torch.nn.functional as F

        vectors: list[list[float]] = []
        for start in range(0, len(texts), self._BATCH_SIZE):
            batch = texts[start : start + self._BATCH_SIZE]
            inputs = self._tokenizer(
                batch, padding=True, truncation=True, return_tensors="pt", max_length=512
            )
            inputs = {k: v.to(self._device) for k, v in inputs.items()}
            with torch.inference_mode():
                hidden_states = self._model(**inputs).last_hidden_state

            attention_mask = inputs["attention_mask"][:, 1:, None]
            summed = (hidden_states[:, 1:] * attention_mask).sum(dim=1)
            counts = attention_mask.sum(dim=1)
            pooled = summed / counts
            normalized = F.normalize(pooled, p=2, dim=-1)
            vectors.extend(list(vector) for vector in normalized.tolist())
        return vectors


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
