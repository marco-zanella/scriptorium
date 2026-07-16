import pytest
from fastapi.testclient import TestClient

from app.auth.tokens import create_access_token
from app.main import app
from app.registry import list_language_packs
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
