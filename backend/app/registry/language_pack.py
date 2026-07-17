from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class EmbeddingSpec:
    """Embedding model binding for a language — filled in once a model is chosen (Phase 4c/4d).

    query_prefix/document_prefix support asymmetric embedding models (e.g. E5, BGE)
    that require different prompts for queries vs. indexed passages — left unset
    for symmetric models.

    pooling selects how token-level output becomes a single vector: "sentence_transformers"
    for models packaged with their own pooling config (most models); "mean_skip_first"
    for bare transformers checkpoints whose intended pooling is a mask-weighted mean over
    all tokens except the first (e.g. a CLS/BOS token not meant to be part of the average),
    followed by L2 normalization — the scheme some contrastively-trained retrieval models use.

    base_model_id defaults to model_id (the common case: tokenizer, architecture, and
    weights all live in the same repo). Set it separately when model_id's repo ships only
    fine-tuned weights/config wrapped in a non-standard container (mean_skip_first's case:
    the checkpoint's own config.json declares a model_type transformers' AutoModel doesn't
    recognize) — the tokenizer and base architecture then come from the model it was
    fine-tuned from instead.
    """

    model_id: str
    revision: str
    dimension: int
    query_prefix: str | None = None
    document_prefix: str | None = None
    pooling: Literal["sentence_transformers", "mean_skip_first"] = "sentence_transformers"
    base_model_id: str | None = None


@dataclass(frozen=True)
class LanguagePack:
    iso_code: str
    display_name: str
    script: str
    directionality: Literal["ltr", "rtl"]
    analyzer_settings: dict
    embedding_spec: EmbeddingSpec | None = None
