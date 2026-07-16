# 0001: OpenSearch infra + language registry, built for 5 languages from day one

## Status

Accepted (2026-07-16)

## Context

The original plan split Phase 4 into 4a (OpenSearch infra, one hardcoded language: Greek) and a
later 4b (a generalized `LanguagePack`/`BibleEdition`/`VersificationScheme` registry, validated
with a throwaway third language). When Phase 4 actually started, the user expanded this to cover
5 real languages immediately: Ancient Greek, Latin, English, Italian (new to the project), and
Arabic (previously a documented "stub, not actively built" — that decision is superseded).

## Decisions

**Registry built now, for 5 languages, not deferred to a later sub-phase.** Building the
auto-discovery mechanism against 5 real languages up front is a better test of "add a language
with zero code changes outside its own directory" than a throwaway third test language would
have been.

**OpenSearch security plugin disabled.** OpenSearch is reachable only from the `api` container
over the internal Docker Compose network — never exposed on 80/443 or directly to the internet,
the same trust boundary already relied on for the api port since Phase 2. An additional auth
layer between two containers on a network nothing else can reach is not a real reduction in risk.

**`analysis-icu` installed via a custom Dockerfile (`opensearch/Dockerfile`), not at
container startup.** OpenSearch's own documentation states plugins can only be installed by
extending the base image — there is no supported entrypoint/startup-time alternative. This is
also exactly how `resilient-search-engine/elasticsearch/Dockerfile` solved the equivalent problem
for Elasticsearch. Maintenance burden is the same shape as the existing `backend/Dockerfile`: one
line to bump on a version upgrade, built automatically by `docker compose up --build`.

**OpenSearch pinned to 3.7.0.** Checked as the current stable release at implementation time,
confirmed via OpenSearch's own release notes that nested k-NN/hybrid search (needed in Phase 4c)
works at least as well on 3.x as on the 2.19+ this doc previously speculated about.

**`VersificationScheme` and `BibleEdition` dropped from the registry for now.** Both were part of
the original registry design but have no real consumer anywhere in this phase — the search
endpoint returns individually-ranked verse hits; nothing chunks, orders by canonical sequence, or
looks up edition metadata. The one plausible future use for canonical ordering (RAG context-window
expansion, Phase 6) turns out not to need it either: naive "next verse" ordering is actually wrong
there (a chapter boundary is a topic break, not a continuation — gluing text across it would
mislead the LLM), and the actual fix is a retrieval-time choice (always present retrieved verses
as separately-labeled snippets, never concatenate across a boundary) plus a small scoped lookup
if/when "same-chapter neighbors" is ever needed — not a general cross-task chunking abstraction.
Separately, hardcoding a `BibleEdition` for the Göttingen Genesis apparatus now would assert an
edition into the system that doesn't exist yet (the source files haven't been supplied). Both
get introduced later, once real data and a real caller exist.

**No committed sample-data loader script.** Same reasoning as above: a script that can't run
until the Göttingen Genesis files exist, and becomes dead code the moment Phase 4d's real
ingestion API exists, isn't worth committing speculatively. Written (and only kept) when there's
real data behind it.

**`/api/search`, no `/v1` segment.** Matches the already-implemented `/api/auth`/`/api/users`
convention — this repo's structure sketch mentioning `/api/v1/...` was aspirational and had
already gone stale relative to the real code.

## Consequences

Adding a 6th language (e.g. Hebrew, or a second Arabic-script tradition) means adding one file
under `backend/app/registry/languages/`, nothing else. `VersificationScheme`/`BibleEdition` will
need to be designed for real once Phase 6 (RAG context) or a real second Greek/Latin/etc. edition
requires them — that design work is not done yet and shouldn't be assumed from this ADR.
