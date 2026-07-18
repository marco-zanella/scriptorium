from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.auth.dependencies import Principal, require_role
from app.db.session import get_db
from app.eval.metrics import aggregate, evaluate_case
from app.eval.models import ResultCase, ResultCollection, TestCollection

router = APIRouter(prefix="/api/eval/result-collections", tags=["eval-results"])


class CaseMetricsOut(BaseModel):
    result_case_id: int
    test_case_id: int
    recall_at_k: float
    precision_at_k: float
    reciprocal_rank: float
    ndcg_at_k: float


class ResultCollectionReportOut(BaseModel):
    id: int
    status: str
    configuration_snapshot: dict
    books_snapshot: list[str]
    sources_snapshot: list[str]
    k: int
    tau: int
    recall_at_k: float
    precision_at_k: float
    mrr: float
    ndcg_at_k: float
    cases: list[CaseMetricsOut]


class ResultCaseDetailOut(BaseModel):
    id: int
    test_case_id: int
    results: list[dict]
    snapshot: dict
    recall_at_k: float
    precision_at_k: float
    reciprocal_rank: float
    ndcg_at_k: float


def _get_visible_result_collection(
    db: Session, result_collection_id: int, principal: Principal
) -> ResultCollection:
    result_collection = db.get(ResultCollection, result_collection_id)
    if result_collection is None:
        raise HTTPException(status_code=404, detail="Result collection not found")
    if not principal.is_superuser:
        owner_id = (
            db.query(TestCollection.owner_id)
            .filter(TestCollection.id == result_collection.test_collection_id)
            .scalar()
        )
        if owner_id != principal.user_id:
            raise HTTPException(status_code=404, detail="Result collection not found")
    return result_collection


def _ranked_ids(result_case: ResultCase) -> list[str]:
    return [hit["id"] for hit in result_case.results]


def _target_relevance(result_case: ResultCase) -> dict[str, int]:
    return {t["target"]: t["relevance"] for t in result_case.snapshot["targets"]}


@router.get("/{result_collection_id}", response_model=ResultCollectionReportOut)
def get_result_collection_report(
    result_collection_id: int,
    k: int = Query(10, ge=1, le=50),
    tau: int = Query(1, ge=0, le=3),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> ResultCollectionReportOut:
    result_collection = _get_visible_result_collection(db, result_collection_id, principal)
    result_cases = (
        db.query(ResultCase).filter(ResultCase.result_collection_id == result_collection.id).all()
    )

    cases_for_metrics = [(_ranked_ids(rc), _target_relevance(rc)) for rc in result_cases]
    report = aggregate(cases_for_metrics, k, tau)

    return ResultCollectionReportOut(
        id=result_collection.id,
        status=result_collection.status,
        configuration_snapshot=result_collection.configuration_snapshot,
        books_snapshot=result_collection.books_snapshot,
        sources_snapshot=result_collection.sources_snapshot,
        k=k,
        tau=tau,
        recall_at_k=report["recall_at_k"],
        precision_at_k=report["precision_at_k"],
        mrr=report["mrr"],
        ndcg_at_k=report["ndcg_at_k"],
        cases=[
            CaseMetricsOut(
                result_case_id=rc.id,
                test_case_id=rc.test_case_id,
                recall_at_k=per_case["recall_at_k"],
                precision_at_k=per_case["precision_at_k"],
                reciprocal_rank=per_case["reciprocal_rank"],
                ndcg_at_k=per_case["ndcg_at_k"],
            )
            for rc, per_case in zip(result_cases, report["per_case"], strict=True)
        ],
    )


@router.get("/{result_collection_id}/cases/{case_id}", response_model=ResultCaseDetailOut)
def get_result_case_detail(
    result_collection_id: int,
    case_id: int,
    k: int = Query(10, ge=1, le=50),
    tau: int = Query(1, ge=0, le=3),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> ResultCaseDetailOut:
    result_collection = _get_visible_result_collection(db, result_collection_id, principal)
    result_case = (
        db.query(ResultCase)
        .filter(ResultCase.id == case_id, ResultCase.result_collection_id == result_collection.id)
        .one_or_none()
    )
    if result_case is None:
        raise HTTPException(status_code=404, detail="Result case not found")

    metrics = evaluate_case(_ranked_ids(result_case), _target_relevance(result_case), k, tau)
    return ResultCaseDetailOut(
        id=result_case.id,
        test_case_id=result_case.test_case_id,
        results=result_case.results,
        snapshot=result_case.snapshot,
        recall_at_k=metrics["recall_at_k"],
        precision_at_k=metrics["precision_at_k"],
        reciprocal_rank=metrics["reciprocal_rank"],
        ndcg_at_k=metrics["ndcg_at_k"],
    )
