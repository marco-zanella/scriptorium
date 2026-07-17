from app.registry.analyzers import icu_analysis_settings
from app.registry.language_pack import EmbeddingSpec, LanguagePack

LANGUAGE_PACK = LanguagePack(
    iso_code="lat",
    display_name="Latin",
    script="Latin",
    directionality="ltr",
    analyzer_settings=icu_analysis_settings(),
    embedding_spec=EmbeddingSpec(
        model_id="itserr/LaBERTa-W_VULG-S_VL-Synt",
        revision="main",
        dimension=768,
        pooling="mean_skip_first",
        # This fine-tune's own repo ships only weights/config wrapped in the old repo's
        # custom RetrieverModel container (config.json's model_type: "retriever", weight
        # keys prefixed "embedding_model."); its embedding_config._name_or_path names the
        # base model both the tokenizer and the underlying architecture come from.
        base_model_id="bowphs/LaBerta",
    ),
)
