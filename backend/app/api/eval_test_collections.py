from datetime import datetime

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session, selectinload

from app.api.eval_test_cases import TestCaseOut
from app.auth.dependencies import Principal, require_role
from app.db.session import get_db
from app.eval.models import ResultCollection, TestCase, TestCollection
from app.eval.runner import run_test_collection
from app.registry import list_language_packs
from app.search.client import get_client
from app.search.models import SearchConfiguration
from app.search.service import browse_facets

router = APIRouter(prefix="/api/eval/test-collections", tags=["eval-test-collections"])


class TestCollectionOut(BaseModel):
    id: int
    name: str
    description: str | None
    search_configuration_id: int
    books: list[str]
    sources: list[str]
    test_case_count: int

    @classmethod
    def from_model(cls, collection: TestCollection) -> "TestCollectionOut":
        return cls(
            id=collection.id,
            name=collection.name,
            description=collection.description,
            search_configuration_id=collection.search_configuration_id,
            books=collection.books,
            sources=collection.sources,
            test_case_count=len(collection.test_cases),
        )


class TestCollectionCreate(BaseModel):
    name: str
    description: str | None = None
    search_configuration_id: int
    books: list[str] = []
    sources: list[str] = []


class ResultCollectionOut(BaseModel):
    id: int
    status: str
    configuration_snapshot: dict
    books_snapshot: list[str]
    sources_snapshot: list[str]
    started_at: datetime | None
    completed_at: datetime | None
    error: str | None

    @classmethod
    def from_model(cls, result_collection: ResultCollection) -> "ResultCollectionOut":
        return cls(
            id=result_collection.id,
            status=result_collection.status,
            configuration_snapshot=result_collection.configuration_snapshot,
            books_snapshot=result_collection.books_snapshot,
            sources_snapshot=result_collection.sources_snapshot,
            started_at=result_collection.started_at,
            completed_at=result_collection.completed_at,
            error=result_collection.error,
        )


def _visible_query(db: Session, principal: Principal):
    query = db.query(TestCollection)
    if not principal.is_superuser:
        query = query.filter(TestCollection.owner_id == principal.user_id)
    return query


def _get_visible_collection(
    db: Session, collection_id: int, principal: Principal
) -> TestCollection:
    collection = (
        _visible_query(db, principal).filter(TestCollection.id == collection_id).one_or_none()
    )
    if collection is None:
        raise HTTPException(status_code=404, detail="Test collection not found")
    return collection


def _configuration_visible_to(db: Session, configuration_id: int, principal: Principal) -> bool:
    return (
        db.query(SearchConfiguration)
        .filter(
            SearchConfiguration.id == configuration_id,
            (SearchConfiguration.owner_id == principal.user_id)
            | (SearchConfiguration.owner_id.is_(None)),
        )
        .first()
        is not None
    )


@router.get("", response_model=list[TestCollectionOut])
def list_test_collections(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> list[TestCollectionOut]:
    collections = (
        _visible_query(db, principal)
        .options(selectinload(TestCollection.test_cases))
        .order_by(TestCollection.id.desc())
        .all()
    )
    return [TestCollectionOut.from_model(c) for c in collections]


@router.post("", response_model=TestCollectionOut, status_code=201)
def create_test_collection(
    body: TestCollectionCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> TestCollectionOut:
    if not _configuration_visible_to(db, body.search_configuration_id, principal):
        raise HTTPException(status_code=404, detail="Search configuration not found")
    collection = TestCollection(
        owner_id=principal.user_id,
        name=body.name,
        description=body.description,
        search_configuration_id=body.search_configuration_id,
        books=body.books,
        sources=body.sources,
    )
    db.add(collection)
    db.commit()
    return TestCollectionOut.from_model(collection)


# Registered ahead of GET /{collection_id} — a static path below it would be
# shadowed, since Starlette matches "content-facets" against {collection_id}
# before type coercion.
@router.get("/content-facets", response_model=dict[str, list[str]])
def content_facets(
    principal: Principal = Depends(require_role("run_experiments")),
) -> dict[str, list[str]]:
    """Book/source vocabulary for the collection form's assisted chip pickers.
    A TestCollection's books/sources aren't scoped to one language the way a
    search request is, so this merges browse_facets across every registered
    language pack rather than reusing /api/search/{language}/facets (which
    also requires use_search_engine, a role eval users may not hold)."""
    client = get_client()
    books: set[str] = set()
    sources: set[str] = set()
    for pack in list_language_packs():
        facets = browse_facets(client, pack)
        books.update(bucket.key for bucket in facets["book"])
        sources.update(bucket.key for bucket in facets["source"])
    return {"book": sorted(books), "source": sorted(sources)}


@router.get("/{collection_id}", response_model=TestCollectionOut)
def get_test_collection(
    collection_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> TestCollectionOut:
    return TestCollectionOut.from_model(_get_visible_collection(db, collection_id, principal))


@router.patch("/{collection_id}", response_model=TestCollectionOut)
def update_test_collection(
    collection_id: int,
    body: TestCollectionCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> TestCollectionOut:
    collection = _get_visible_collection(db, collection_id, principal)
    if not _configuration_visible_to(db, body.search_configuration_id, principal):
        raise HTTPException(status_code=404, detail="Search configuration not found")
    collection.name = body.name
    collection.description = body.description
    collection.search_configuration_id = body.search_configuration_id
    collection.books = body.books
    collection.sources = body.sources
    db.commit()
    return TestCollectionOut.from_model(collection)


@router.delete("/{collection_id}", status_code=204)
def delete_test_collection(
    collection_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> None:
    collection = _get_visible_collection(db, collection_id, principal)
    db.delete(collection)
    db.commit()


@router.get("/{collection_id}/test-cases", response_model=list[TestCaseOut])
def list_member_test_cases(
    collection_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> list[TestCaseOut]:
    collection = _get_visible_collection(db, collection_id, principal)
    return [TestCaseOut.from_model(c) for c in collection.test_cases]


@router.post("/{collection_id}/test-cases/{case_id}", response_model=list[TestCaseOut])
def add_member_test_case(
    collection_id: int,
    case_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> list[TestCaseOut]:
    collection = _get_visible_collection(db, collection_id, principal)
    test_case = db.query(TestCase).filter(TestCase.id == case_id).one_or_none()
    if test_case is None or test_case.owner_id != collection.owner_id:
        raise HTTPException(status_code=404, detail="Test case not found")
    if test_case not in collection.test_cases:
        collection.test_cases.append(test_case)
        db.commit()
    return [TestCaseOut.from_model(c) for c in collection.test_cases]


@router.delete("/{collection_id}/test-cases/{case_id}", response_model=list[TestCaseOut])
def remove_member_test_case(
    collection_id: int,
    case_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> list[TestCaseOut]:
    collection = _get_visible_collection(db, collection_id, principal)
    test_case = next((c for c in collection.test_cases if c.id == case_id), None)
    if test_case is not None:
        collection.test_cases.remove(test_case)
        db.commit()
    return [TestCaseOut.from_model(c) for c in collection.test_cases]


@router.post("/{collection_id}/run", response_model=ResultCollectionOut, status_code=201)
def run_collection(
    collection_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> ResultCollectionOut:
    collection = _get_visible_collection(db, collection_id, principal)
    config = (
        db.query(SearchConfiguration)
        .filter(SearchConfiguration.id == collection.search_configuration_id)
        .one()
    )
    result_collection = ResultCollection(
        test_collection_id=collection.id,
        configuration_snapshot={"name": config.name, "weights": config.weights},
        books_snapshot=collection.books,
        sources_snapshot=collection.sources,
        status="pending",
    )
    db.add(result_collection)
    db.commit()
    background_tasks.add_task(run_test_collection, result_collection.id)
    return ResultCollectionOut.from_model(result_collection)


@router.get("/{collection_id}/result-collections", response_model=list[ResultCollectionOut])
def list_result_collections(
    collection_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> list[ResultCollectionOut]:
    collection = _get_visible_collection(db, collection_id, principal)
    runs = (
        db.query(ResultCollection)
        .filter(ResultCollection.test_collection_id == collection.id)
        .order_by(ResultCollection.id.desc())
        .all()
    )
    return [ResultCollectionOut.from_model(r) for r in runs]
