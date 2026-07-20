from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy.orm import Session

from app.api.search import SearchHit
from app.auth.dependencies import Principal, require_role
from app.db.session import get_db
from app.eval.models import TestCase, TestCaseTarget
from app.registry import UnknownLanguageError, get_language_pack
from app.search.client import get_client
from app.search.service import assisted_content_search, get_document

router = APIRouter(prefix="/api/eval/test-cases", tags=["eval-test-cases"])


class TestCaseTargetOut(BaseModel):
    id: int
    target: str
    relevance: int

    @classmethod
    def from_model(cls, target: TestCaseTarget) -> "TestCaseTargetOut":
        return cls(id=target.id, target=target.target, relevance=target.relevance)


class TestCaseTargetIn(BaseModel):
    target: str
    relevance: int = Field(ge=0, le=3)


class TestCaseOut(BaseModel):
    id: int
    content: str
    language: str
    source: str | None
    context: str | None
    tags: list[str]
    targets: list[TestCaseTargetOut]

    @classmethod
    def from_model(cls, case: TestCase) -> "TestCaseOut":
        return cls(
            id=case.id,
            content=case.content,
            language=case.language,
            source=case.source,
            context=case.context,
            tags=case.tags,
            targets=[TestCaseTargetOut.from_model(t) for t in case.targets],
        )


class TestCaseCreate(BaseModel):
    content: str
    language: str
    source: str | None = None
    context: str | None = None
    tags: list[str] = []


class TestCaseImportTarget(BaseModel):
    target: str
    relevance: int = Field(ge=0, le=3)


class TestCaseImportItem(BaseModel):
    content: str
    language: str
    source: str | None = None
    context: str | None = None
    tags: list[str] = []
    targets: list[TestCaseImportTarget] = []


class TestCaseImportRowError(BaseModel):
    index: int
    error: str


class TestCaseImportResult(BaseModel):
    created: list[TestCaseOut]
    errors: list[TestCaseImportRowError]


def _visible_query(db: Session, principal: Principal):
    query = db.query(TestCase)
    if not principal.is_superuser:
        query = query.filter(TestCase.owner_id == principal.user_id)
    return query


def _get_visible_case(db: Session, case_id: int, principal: Principal) -> TestCase:
    case = _visible_query(db, principal).filter(TestCase.id == case_id).one_or_none()
    if case is None:
        raise HTTPException(status_code=404, detail="Test case not found")
    return case


def _validate_language(language: str) -> None:
    try:
        get_language_pack(language)
    except UnknownLanguageError:
        raise HTTPException(status_code=422, detail=f"Unknown language: {language}") from None


@router.get("", response_model=list[TestCaseOut])
def list_test_cases(
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> list[TestCaseOut]:
    cases = _visible_query(db, principal).order_by(TestCase.id.desc()).all()
    return [TestCaseOut.from_model(c) for c in cases]


@router.post("", response_model=TestCaseOut, status_code=201)
def create_test_case(
    body: TestCaseCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> TestCaseOut:
    _validate_language(body.language)
    case = TestCase(
        owner_id=principal.user_id,
        content=body.content,
        language=body.language,
        source=body.source,
        context=body.context,
        tags=body.tags,
    )
    db.add(case)
    db.commit()
    return TestCaseOut.from_model(case)


@router.post("/import", response_model=TestCaseImportResult)
def import_test_cases(
    body: list[dict],
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> TestCaseImportResult:
    """Bulk-creates test cases from a JSON array. Always inserts new rows (no
    upsert/dedup, no external key). `body` is intentionally untyped (`list[dict]`,
    not `list[TestCaseImportItem]`) so one malformed row is caught and reported
    per-row below, rather than failing FastAPI's whole-request validation and
    rejecting every row in the batch over a single bad one."""
    created: list[TestCaseOut] = []
    errors: list[TestCaseImportRowError] = []

    for index, raw in enumerate(body):
        try:
            item = TestCaseImportItem.model_validate(raw)
            get_language_pack(item.language)
            target_names = [t.target for t in item.targets]
            if len(target_names) != len(set(target_names)):
                raise ValueError("Duplicate target within test case")
        except ValidationError as exc:
            errors.append(TestCaseImportRowError(index=index, error=str(exc)))
            continue
        except UnknownLanguageError:
            error = f"Unknown language: {raw.get('language')}"
            errors.append(TestCaseImportRowError(index=index, error=error))
            continue
        except ValueError as exc:
            errors.append(TestCaseImportRowError(index=index, error=str(exc)))
            continue

        case = TestCase(
            owner_id=principal.user_id,
            content=item.content,
            language=item.language,
            source=item.source,
            context=item.context,
            tags=item.tags,
        )
        case.targets = [
            TestCaseTarget(target=t.target, relevance=t.relevance) for t in item.targets
        ]
        db.add(case)
        db.flush()
        created.append(TestCaseOut.from_model(case))

    db.commit()
    return TestCaseImportResult(created=created, errors=errors)


# Registered ahead of GET /{case_id} — a static path below it would be shadowed,
# since Starlette matches "content-search" against {case_id} before type coercion.
@router.get("/content-search", response_model=list[SearchHit])
def content_search(
    language: str,
    query: str,
    principal: Principal = Depends(require_role("run_experiments")),
) -> list[SearchHit]:
    try:
        language_pack = get_language_pack(language)
    except UnknownLanguageError:
        raise HTTPException(status_code=422, detail=f"Unknown language: {language}") from None

    query = query.strip()
    if not query:
        return []
    hits = assisted_content_search(get_client(), language_pack, query)
    return [SearchHit(**hit) for hit in hits]


# Registered ahead of GET /{case_id} for the same reason as content-search above.
@router.get("/document/{language}/{doc_id}", response_model=SearchHit)
def get_test_case_target_document(
    language: str,
    doc_id: str,
    principal: Principal = Depends(require_role("run_experiments")),
) -> SearchHit:
    """Resolves a target id to its document content — needed for a "missed
    target" (relevant but never retrieved), where there's no ranked hit to
    read content off of."""
    try:
        language_pack = get_language_pack(language)
    except UnknownLanguageError:
        raise HTTPException(status_code=422, detail=f"Unknown language: {language}") from None

    hit = get_document(get_client(), language_pack, doc_id)
    if hit is None:
        raise HTTPException(status_code=404, detail="Document not found")
    return SearchHit(**hit)


@router.get("/{case_id}", response_model=TestCaseOut)
def get_test_case(
    case_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> TestCaseOut:
    return TestCaseOut.from_model(_get_visible_case(db, case_id, principal))


@router.patch("/{case_id}", response_model=TestCaseOut)
def update_test_case(
    case_id: int,
    body: TestCaseCreate,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> TestCaseOut:
    _validate_language(body.language)
    case = _get_visible_case(db, case_id, principal)
    case.content = body.content
    case.language = body.language
    case.source = body.source
    case.context = body.context
    case.tags = body.tags
    db.commit()
    return TestCaseOut.from_model(case)


@router.delete("/{case_id}", status_code=204)
def delete_test_case(
    case_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> None:
    case = _get_visible_case(db, case_id, principal)
    db.delete(case)
    db.commit()


@router.get("/{case_id}/targets", response_model=list[TestCaseTargetOut])
def list_targets(
    case_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> list[TestCaseTargetOut]:
    case = _get_visible_case(db, case_id, principal)
    return [TestCaseTargetOut.from_model(t) for t in case.targets]


def _get_target_or_404(db: Session, case: TestCase, target_id: int) -> TestCaseTarget:
    target = (
        db.query(TestCaseTarget)
        .filter(TestCaseTarget.id == target_id, TestCaseTarget.test_case_id == case.id)
        .one_or_none()
    )
    if target is None:
        raise HTTPException(status_code=404, detail="Target not found")
    return target


def _reject_duplicate_target(
    db: Session, case: TestCase, target: str, exclude_id: int | None = None
) -> None:
    query = db.query(TestCaseTarget).filter(
        TestCaseTarget.test_case_id == case.id, TestCaseTarget.target == target
    )
    if exclude_id is not None:
        query = query.filter(TestCaseTarget.id != exclude_id)
    if query.one_or_none() is not None:
        raise HTTPException(status_code=409, detail="Target already exists for this test case")


@router.post("/{case_id}/targets", response_model=TestCaseTargetOut, status_code=201)
def add_target(
    case_id: int,
    body: TestCaseTargetIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> TestCaseTargetOut:
    case = _get_visible_case(db, case_id, principal)
    _reject_duplicate_target(db, case, body.target)
    target = TestCaseTarget(test_case_id=case.id, target=body.target, relevance=body.relevance)
    db.add(target)
    db.commit()
    return TestCaseTargetOut.from_model(target)


@router.patch("/{case_id}/targets/{target_id}", response_model=TestCaseTargetOut)
def update_target(
    case_id: int,
    target_id: int,
    body: TestCaseTargetIn,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> TestCaseTargetOut:
    case = _get_visible_case(db, case_id, principal)
    target = _get_target_or_404(db, case, target_id)
    _reject_duplicate_target(db, case, body.target, exclude_id=target_id)
    target.target = body.target
    target.relevance = body.relevance
    db.commit()
    return TestCaseTargetOut.from_model(target)


@router.delete("/{case_id}/targets/{target_id}", status_code=204)
def delete_target(
    case_id: int,
    target_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> None:
    case = _get_visible_case(db, case_id, principal)
    target = _get_target_or_404(db, case, target_id)
    db.delete(target)
    db.commit()
