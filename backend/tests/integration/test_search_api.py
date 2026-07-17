import pytest
from fastapi.testclient import TestClient

from app.auth.tokens import create_access_token
from app.embeddings.model import encode_documents, load_model
from app.main import app
from app.registry import get_language_pack, list_language_packs
from app.search.client import get_client
from app.search.index_manager import ensure_index, index_name


@pytest.fixture
def client() -> TestClient:
    return TestClient(app, base_url="https://testserver")


@pytest.fixture(scope="module", autouse=True)
def opensearch_test_indices():
    os_client = get_client()
    names = [ensure_index(os_client, pack) for pack in list_language_packs()]
    yield
    for name in names:
        os_client.indices.delete(index=name, ignore_unavailable=True)


def _bearer(user_id: int, roles: list[str], is_superuser: bool = False) -> dict:
    token = create_access_token(user_id, roles, is_superuser)
    return {"Authorization": f"Bearer {token}"}


def test_languages_endpoint_lists_five(client: TestClient) -> None:
    response = client.get("/api/search/languages")
    assert response.status_code == 200
    assert len(response.json()) == 5


def test_search_requires_authentication(client: TestClient) -> None:
    response = client.post("/api/search/grc", json={"query": "test"})
    assert response.status_code == 401


def test_search_requires_use_search_engine_role(client: TestClient) -> None:
    response = client.post(
        "/api/search/grc", json={"query": "test"}, headers=_bearer(1, ["use_rag"])
    )
    assert response.status_code == 403


def test_search_unknown_language_is_not_found(client: TestClient) -> None:
    response = client.post(
        "/api/search/xxx", json={"query": "test"}, headers=_bearer(1, ["use_search_engine"])
    )
    assert response.status_code == 404


def test_search_returns_indexed_document_with_variant(client: TestClient) -> None:
    os_client = get_client()
    grc = next(pack for pack in list_language_packs() if pack.iso_code == "grc")
    os_client.index(
        index=index_name(grc),
        body={
            "book": "genesis",
            "chapter": "1",
            "verse": "1",
            "source": "gottingen",
            "content": "Εν αρχη εποιησεν ο θεος",
            "variant": [{"source": "witness-1", "content": "εν αρχη επλασεν ο θεος"}],
        },
        refresh=True,
    )

    response = client.post(
        "/api/search/grc", json={"query": "θεος"}, headers=_bearer(1, ["use_search_engine"])
    )

    assert response.status_code == 200
    body = response.json()
    assert body["count"] >= 1
    assert any(r["book"] == "genesis" and r["variant"] for r in body["results"])
    assert {"key": "genesis", "count": body["count"]} in body["facets"]["book"]
    assert {"key": "gottingen", "count": body["count"]} in body["facets"]["source"]


def test_score_stats_omitted_unless_requested(client: TestClient) -> None:
    response = client.post(
        "/api/search/grc", json={"query": "θεος"}, headers=_bearer(1, ["use_search_engine"])
    )
    assert response.json()["score_stats"] is None


def test_score_stats_included_when_requested(client: TestClient) -> None:
    response = client.post(
        "/api/search/grc",
        json={"query": "θεος", "include_score_stats": True},
        headers=_bearer(1, ["use_search_engine"]),
    )
    stats = response.json()["score_stats"]
    assert stats is not None
    assert stats["count"] >= 1
    assert any(key.startswith("50") for key in stats["percentiles"])


def test_pagination(client: TestClient) -> None:
    os_client = get_client()
    grc = next(pack for pack in list_language_packs() if pack.iso_code == "grc")
    for i in range(3):
        os_client.index(
            index=index_name(grc),
            body={
                "book": "genesis",
                "chapter": "2",
                "verse": str(i),
                "source": "gottingen",
                "content": f"pagination-marker-{i}",
                "variant": [],
            },
            refresh=True,
        )

    def _search(page: int) -> dict:
        return client.post(
            "/api/search/grc",
            json={
                "query": "pagination-marker",
                "weights": {"text": 1},
                "page": page,
                "page_size": 1,
            },
            headers=_bearer(1, ["use_search_engine"]),
        ).json()

    page1, page2 = _search(1), _search(2)
    assert page1["page"] == 1
    assert page2["page"] == 2
    assert len(page1["results"]) == 1
    assert len(page2["results"]) == 1
    assert page1["results"][0]["verse"] != page2["results"][0]["verse"]


def test_book_facet_stays_multi_selectable_after_filtering(client: TestClient) -> None:
    """Regression test: selecting one book must not collapse the book facet down
    to only that book — otherwise there's no way to also select a second book
    (see build_facets_body's docstring for why this needs its own request)."""
    os_client = get_client()
    grc = next(pack for pack in list_language_packs() if pack.iso_code == "grc")
    for book in ("multiselect-genesis", "multiselect-exodus"):
        os_client.index(
            index=index_name(grc),
            body={
                "book": book,
                "chapter": "1",
                "verse": "1",
                "source": "gottingen",
                "content": "multiselect-marker",
                "variant": [],
            },
            refresh=True,
        )

    response = client.post(
        "/api/search/grc",
        json={
            "query": "multiselect-marker",
            "weights": {"text": 1},
            "books": ["multiselect-genesis"],
        },
        headers=_bearer(1, ["use_search_engine"]),
    )

    body = response.json()
    assert body["results"] and all(r["book"] == "multiselect-genesis" for r in body["results"])
    book_facet_keys = {b["key"] for b in body["facets"]["book"]}
    assert {"multiselect-genesis", "multiselect-exodus"} <= book_facet_keys


def test_language_field_stems_english_but_agnostic_text_field_does_not(client: TestClient) -> None:
    os_client = get_client()
    eng = get_language_pack("eng")
    os_client.index(
        index=index_name(eng),
        body={
            "book": "test-language-field",
            "chapter": "1",
            "verse": "1",
            "source": "smoke",
            "content": "The children are running through the fields",
            "variant": [],
        },
        refresh=True,
    )

    stemmed = client.post(
        "/api/search/eng",
        json={"query": "run", "weights": {"text": 0, "language": 1.0}},
        headers=_bearer(1, ["use_search_engine"]),
    )
    assert stemmed.json()["count"] >= 1

    agnostic = client.post(
        "/api/search/eng",
        json={"query": "run", "weights": {"text": 1.0, "language": 0}},
        headers=_bearer(1, ["use_search_engine"]),
    )
    assert agnostic.json()["count"] == 0


def test_language_field_silently_absent_for_ancient_greek(client: TestClient) -> None:
    """grc has no Lucene analyzer to base a `language` field on — requesting it
    must not error, just match nothing via that (non-existent) field."""
    response = client.post(
        "/api/search/grc",
        # variant_weights explicitly zeroed — the default variant_weights would
        # otherwise match this module's other tests' leftover grc variant docs
        # via the real text/shingle/trigram fields, unrelated to this assertion.
        json={"query": "θεος", "weights": {"text": 0, "language": 1.0}, "variant_weights": {}},
        headers=_bearer(1, ["use_search_engine"]),
    )
    assert response.status_code == 200
    assert response.json()["count"] == 0


@pytest.fixture(scope="module")
def eng_embedded_doc() -> str:
    """Indexes one eng document with a real embedding (computed via the actual
    model, not a stub), so query-time encode_query similarity to it is meaningful."""
    os_client = get_client()
    eng = get_language_pack("eng")
    encoder = load_model(eng.embedding_spec)
    text = "In the beginning God created the heavens and the earth"
    [vector] = encode_documents(encoder, eng.embedding_spec, [text])
    os_client.index(
        index=index_name(eng),
        body={
            "book": "test-semantic",
            "chapter": "1",
            "verse": "1",
            "source": "smoke",
            "content": text,
            "variant": [],
            "embedding": vector,
        },
        refresh=True,
    )
    return text


def test_semantic_search_finds_real_knn_match(client: TestClient, eng_embedded_doc: str) -> None:
    response = client.post(
        "/api/search/eng",
        json={"query": eng_embedded_doc, "weights": {"text": 0, "semantic": 1.0}},
        headers=_bearer(1, ["use_search_engine"]),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["count"] >= 1
    assert any("beginning" in (r["content"] or "") for r in body["results"])


def test_hybrid_query_combines_lexical_and_semantic_buckets(
    client: TestClient, eng_embedded_doc: str
) -> None:
    response = client.post(
        "/api/search/eng",
        json={"query": "beginning heavens earth", "weights": {"text": 0.1, "semantic": 1.0}},
        headers=_bearer(1, ["use_search_engine"]),
    )
    assert response.status_code == 200
    assert response.json()["count"] >= 1


def test_hybrid_query_with_normalization_combiner_technique(
    client: TestClient, eng_embedded_doc: str
) -> None:
    response = client.post(
        "/api/search/eng",
        json={
            "query": "beginning heavens earth",
            "weights": {"text": 0.1, "semantic": 1.0},
            "combiner": {"technique": "min_max", "combination": "geometric_mean"},
        },
        headers=_bearer(1, ["use_search_engine"]),
    )
    assert response.status_code == 200
    assert response.json()["count"] >= 1


@pytest.fixture(scope="module")
def lexical_vs_semantic_docs(eng_embedded_doc: str) -> tuple[str, str]:
    """Two docs deliberately favoring opposite buckets for the same query text
    (`eng_embedded_doc`): `lexical-match` shares no real embedding similarity with
    it but shares every word; `semantic-match` shares the real embedding but no
    words at all. Lets bucket_weights' effect on final ranking be asserted
    deterministically."""
    os_client = get_client()
    eng = get_language_pack("eng")
    encoder = load_model(eng.embedding_spec)
    unrelated_text = "Purple bicycles orbit distant lighthouses quietly"
    [lexical_doc_vector, semantic_doc_vector] = encode_documents(
        encoder, eng.embedding_spec, [unrelated_text, eng_embedded_doc]
    )
    os_client.index(
        index=index_name(eng),
        body={
            "book": "test-bucket-weights",
            "chapter": "1",
            "verse": "1",
            "source": "smoke",
            "content": eng_embedded_doc,  # exact lexical match to the query text below
            "variant": [],
            "embedding": lexical_doc_vector,  # but an unrelated embedding
        },
        refresh=True,
    )
    os_client.index(
        index=index_name(eng),
        body={
            "book": "test-bucket-weights",
            "chapter": "1",
            "verse": "2",
            "source": "smoke",
            "content": unrelated_text,  # no lexical overlap with the query text below
            "variant": [],
            "embedding": semantic_doc_vector,  # but the query text's own real embedding
        },
        refresh=True,
    )
    return "lexical-match", "semantic-match"


def _top_result_kind(body: dict) -> str:
    return "lexical-match" if body["results"][0]["verse"] == "1" else "semantic-match"


def test_bucket_weights_shift_which_bucket_dominates_ranking(
    client: TestClient, lexical_vs_semantic_docs: tuple[str, str]
) -> None:
    # Explicitly uses the normalization-processor combiner (min_max/arithmetic_mean),
    # not rrf: with only 2 candidate docs, RRF's rank-based scoring barely
    # differentiates rank 1 vs. rank 2 within a bucket (1/61 vs. 1/62), so a doc
    # that merely *appears* in both buckets' results can out-rank one that
    # dominates a single bucket — confirmed empirically. Score-based normalization
    # is the combiner where bucket_weights' effect is actually guaranteed to show,
    # which is exactly the point being tested here.
    query = {
        "query": "In the beginning God created the heavens and the earth",
        "weights": {"text": 0.1, "semantic": 1.0},
        "books": ["test-bucket-weights"],
        "combiner": {"technique": "min_max", "combination": "arithmetic_mean"},
    }

    lexical_leaning = client.post(
        "/api/search/eng",
        json={**query, "bucket_weights": {"lexical": 0.95, "semantic": 0.05}},
        headers=_bearer(1, ["use_search_engine"]),
    ).json()
    assert _top_result_kind(lexical_leaning) == "lexical-match"

    semantic_leaning = client.post(
        "/api/search/eng",
        json={**query, "bucket_weights": {"lexical": 0.05, "semantic": 0.95}},
        headers=_bearer(1, ["use_search_engine"]),
    ).json()
    assert _top_result_kind(semantic_leaning) == "semantic-match"
