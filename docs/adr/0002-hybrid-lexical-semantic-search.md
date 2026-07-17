# 0002: Hybrid lexical + semantic search — two-bucket design, real Language-Aware tier

## Status

Accepted (2026-07-17)

## Context

Phase 4a shipped a lexical-only query builder with a `weights`/`variant_weights` schema already
exposing five UI categories — `text`, `shingle`, `trigram` (grouped as "Language Agnostic"),
`language` ("Language Aware"), and `semantic` ("Semantics") — but `language` and `semantic` were
placeholders: `content.language`/`content.semantic` didn't exist in the mapping, and OpenSearch
silently no-ops on a referenced field that isn't there. Phase 4d added real per-language embedding
models and a client-side ingestion pipeline. Phase 4c makes both placeholders real and combines
them into a single tunable hybrid query.

While designing this, a real bug surfaced: `eng`/`ita`/`arb`'s `text` field used OpenSearch's
built-in language analyzer (stemming + stopwords), while `grc`/`lat`'s used ICU-only normalization.
This contradicted the UI's own "Language Agnostic" vs. "Language Aware" framing — `text` should be
purely orthographic for every language, with real linguistic processing living only in the new
`language` field.

## Decisions

**Language-Agnostic tier (`text`/`shingle`/`trigram`) is now uniformly ICU-only for all 5
languages** — normalize/tokenize/fold/lowercase, no stemming, no stopword removal anywhere. This
required reingesting the already-loaded `grc` and `eng` corpora (their existing `eng` index had
stemming baked into `text`).

**`language` (real for `eng`/`ita`/`arb`, absent for `grc`/`lat`).** Each of `eng`/`ita`/`arb` gets
a custom analyzer chain replicating that language's Lucene built-in analyzer (verified against
Elastic's language-analyzer reference and OpenSearch's stemmer token-filter docs — English:
possessive stemmer → stop → Porter stemmer; Italian: elision → stop → light stemmer; Arabic:
lowercase → decimal-digit → normalization → stop → stemmer), plus a `synonym_graph` filter with an
empty synonym list (mechanism ready, no data yet). `grc`/`lat` have no field at all — no Lucene
analyzer exists for either, and the query builder already treats an absent field as a silent
no-op, the same trick relied on for `semantic` pre-4c.

**Synonyms are query-time-only, never index-time.** `synonym_graph` only appears in the
`language_search` analyzer, never `language_index`. Index-time synonym expansion permanently
distorts the whole index's term-frequency statistics (every occurrence of a term also indexes its
synonyms, inflating their document frequency corpus-wide) and requires reindexing on every list
change; query-time expansion's own scoring quirk (a rarer synonym term outweighing a common one
via BM25 IDF) is scoped to a single query, and the list can change with no reindex — relevant since
the list starts empty and will grow. This also means `flatten_graph` is never needed (there's no
graph in the index-time chain to flatten).

**Synonyms run before stopword removal** (Elasticsearch actively rejects the reverse order when
there's term overlap) — a stopword filter running first would strip words like "of" out of a
multi-word synonym rule before it ever matches. **Arabic's chain deliberately reorders
`arabic_normalization` before both `synonym_graph` and `stop`**, unlike Lucene's own built-in
(stop-before-normalization) — both stopword comparison and synonym matching need to operate on
already-normalized tokens; applied consistently in the index chain too, not just where synonyms
need it.

**Semantic tier wires 4d's embedding models into query time.** `app/embeddings/model.py`'s
`encode_query` (previously used only by the ingestion CLI) is now called from
`app/search/service.py`, cached per `EmbeddingSpec` via `lru_cache`, and only invoked when the
semantic bucket is actually requested (encoding is a real CPU cost).

**Two-bucket hybrid, not per-field.** Bucket 1 (lexical) is the existing `bool`/`multi_match`
query, now including `language` and switched from the multi_match default `best_fields` to
`most_fields` — `text`/`shingle`/`trigram`/`language` are genuinely complementary analyses of the
same content now, so matching on more of them should score higher, not just take the single best
field's score. Bucket 2 (semantic) is a new `bool` of `knn`/nested `knn` clauses. Combined only
when both are active — a lexical-only or semantic-only preset (e.g. "text reuse"/"semantic")
returns that bucket's query directly, skipping the hybrid wrapper and a degenerate normalization
pass over an empty/constant bucket entirely.

**Combiner is user-selectable, not hardcoded**, via OpenSearch's `hybrid` query + an inline ad hoc
`search_pipeline` (confirmed this doesn't require a pre-registered named pipeline): `rrf`
(`score-ranker-processor`, rank-based, default) or `min_max`/`l2`/`z_score` normalization
(`normalization-processor`) crossed with `arithmetic_mean`/`geometric_mean`/`harmonic_mean`
combination (`z_score` only valid with `arithmetic_mean` — the other two can't combine its
negative values). Default is `rrf`: the 5 languages' lexical score scales vary a lot (ICU-only
`grc`/`lat` vs. now-stemmed `eng`/`ita`/`arb`), and RRF sidesteps needing per-language score-scale
tuning that normalization-based combining would otherwise require.

**`bucket_weights` is a new, separate request field** (`{"lexical": float, "semantic": float}`),
feeding the combiner's own `weights` parameter. This is necessary, not cosmetic: normalization
rescales each bucket's score range independently, so a uniform per-bucket score multiplier gets
cancelled out by min-max/l2/z-score (shifting a bucket's min and max together leaves
`(s-min)/(max-min)` unchanged) — confirmed empirically that RRF, with only a couple of candidate
documents, barely differentiates rank 1 vs. rank 2 within a bucket, so `bucket_weights`' effect is
most reliably observed under the normalization combiners, not the RRF default. The existing
`weights`/`variant_weights` keep their current meaning (intra-bucket ranking only).

**`torch`/`transformers`/`sentence-transformers`/`sentencepiece` moved from the `cli` extras group
to the base `dependencies`.** The server now computes single-query embeddings itself (the
locked-in design: no bulk/corpus embedding server-side, no GPU needed) — these are no longer
CLI-only. To avoid pulling the default PyPI wheel's full CUDA stack (~2GB of `nvidia-*` packages,
never used on the GPU-less production server with its small root filesystem), `backend/Dockerfile`
installs the CPU-only `torch` build first (`--extra-index-url
https://download.pytorch.org/whl/cpu`), before the general `pip install -e ".[dev]"` — verified
the resulting image has no `nvidia-*` packages and `torch.cuda.is_available()` reports `False`.

## Consequences

Reingesting `grc`/`eng` was required (analyzer change) and treated as a one-time cost, not a
blocker. Adding synonym data later is a config-only change (fill in the `synonyms` list) for
`eng`/`ita`/`arb`; a real `language` field for `grc`/`lat` needs a genuine lemmatizer choice first
(none exists in stock Lucene/OpenSearch for either) — deferred, not stubbed. The combiner and
`bucket_weights` choices are exposed all the way to the UI (technique/combination picker, bucket
balance inputs) and persist through `SearchConfiguration`'s existing schemaless JSONB `weights`
column — no migration was needed; older saved configurations without these keys fall back to
defaults (`rrf`, 50/50) client-side.
