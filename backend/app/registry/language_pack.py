from dataclasses import dataclass
from typing import Literal


@dataclass(frozen=True)
class EmbeddingSpec:
    """Embedding model binding for a language — filled in once a model is chosen (Phase 4c/4d).

    query_prefix/document_prefix support asymmetric embedding models (e.g. E5, BGE)
    that require different prompts for queries vs. indexed passages — left unset
    for symmetric models.
    """

    model_id: str
    revision: str
    dimension: int
    query_prefix: str | None = None
    document_prefix: str | None = None


@dataclass(frozen=True)
class LanguagePack:
    iso_code: str
    display_name: str
    script: str
    directionality: Literal["ltr", "rtl"]
    analyzer_settings: dict
    embedding_spec: EmbeddingSpec | None = None
