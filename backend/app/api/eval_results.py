from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.search import ScoreStats
from app.auth.dependencies import Principal, require_role
from app.db.session import get_db
from app.eval.export import build_export_zip
from app.eval.metrics import aggregate, evaluate_case, mcnemar_exact, wilcoxon_signed_rank
from app.eval.models import ResultCase, ResultCollection, TestCollection
from app.eval.reporting import (
    aggregate_result_cases,
    paired_case_metrics,
    ranked_ids,
    target_relevance,
)

router = APIRouter(prefix="/api/eval/result-collections", tags=["eval-results"])

# Matches the k bounds already enforced on the single-k report endpoint below.
_SWEEP_K_MIN = 1
_SWEEP_K_MAX = 50


class CaseMetricsOut(BaseModel):
    result_case_id: int
    test_case_id: int
    recall_at_k: float
    precision_at_k: float
    reciprocal_rank: float
    ndcg_at_k: float


class ResultCollectionReportOut(BaseModel):
    id: int
    test_collection_id: int
    test_collection_name: str
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
    test_collection_id: int
    test_collection_name: str
    results: list[dict]
    snapshot: dict
    score_stats: ScoreStats | None
    recall_at_k: float
    precision_at_k: float
    reciprocal_rank: float
    ndcg_at_k: float


class MetricSweepPointOut(BaseModel):
    k: int
    recall_at_k: float
    precision_at_k: float
    ndcg_at_k: float


class MetricSweepOut(BaseModel):
    tau: int
    mrr: float
    points: list[MetricSweepPointOut]


class MetricComparisonOut(BaseModel):
    baseline: float
    candidate: float
    delta: float
    wilcoxon_statistic: float | None
    wilcoxon_p_value: float | None
    n: int


class McNemarOut(BaseModel):
    n_baseline_only: int
    n_candidate_only: int
    statistic: int
    p_value: float


class CaseMetricValuesOut(BaseModel):
    recall_at_k: float
    precision_at_k: float
    reciprocal_rank: float
    ndcg_at_k: float


class CaseComparisonOut(BaseModel):
    test_case_id: int
    content: str
    baseline: CaseMetricValuesOut
    candidate: CaseMetricValuesOut


class RunComparisonOut(BaseModel):
    candidate_id: int
    candidate_configuration_name: str
    overlap_case_count: int
    recall_at_k: MetricComparisonOut
    precision_at_k: MetricComparisonOut
    reciprocal_rank: MetricComparisonOut
    ndcg_at_k: MetricComparisonOut
    found_at_k: McNemarOut
    cases: list[CaseComparisonOut]


class ComparisonOut(BaseModel):
    baseline_id: int
    baseline_configuration_name: str
    test_collection_id: int
    test_collection_name: str
    k: int
    tau: int
    comparisons: list[RunComparisonOut]


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

    report = aggregate_result_cases(result_cases, k, tau)

    return ResultCollectionReportOut(
        id=result_collection.id,
        test_collection_id=result_collection.test_collection_id,
        test_collection_name=result_collection.test_collection.name,
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


@router.get("/{result_collection_id}/metric-sweep", response_model=MetricSweepOut)
def get_metric_sweep(
    result_collection_id: int,
    tau: int = Query(1, ge=0, le=3),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> MetricSweepOut:
    result_collection = _get_visible_result_collection(db, result_collection_id, principal)
    result_cases = (
        db.query(ResultCase).filter(ResultCase.result_collection_id == result_collection.id).all()
    )
    cases_for_metrics = [(ranked_ids(rc), target_relevance(rc)) for rc in result_cases]

    points = []
    mrr = 0.0
    for k in range(_SWEEP_K_MIN, _SWEEP_K_MAX + 1):
        report = aggregate(cases_for_metrics, k, tau)
        mrr = report["mrr"]  # invariant across k — reciprocal rank isn't capped by k
        points.append(
            MetricSweepPointOut(
                k=k,
                recall_at_k=report["recall_at_k"],
                precision_at_k=report["precision_at_k"],
                ndcg_at_k=report["ndcg_at_k"],
            )
        )

    return MetricSweepOut(tau=tau, mrr=mrr, points=points)


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

    metrics = evaluate_case(ranked_ids(result_case), target_relevance(result_case), k, tau)
    return ResultCaseDetailOut(
        id=result_case.id,
        test_case_id=result_case.test_case_id,
        test_collection_id=result_collection.test_collection_id,
        test_collection_name=result_collection.test_collection.name,
        results=result_case.results,
        snapshot=result_case.snapshot,
        score_stats=ScoreStats(**result_case.score_stats) if result_case.score_stats else None,
        recall_at_k=metrics["recall_at_k"],
        precision_at_k=metrics["precision_at_k"],
        reciprocal_rank=metrics["reciprocal_rank"],
        ndcg_at_k=metrics["ndcg_at_k"],
    )


_COMPARISON_METRIC_KEYS = ("recall_at_k", "precision_at_k", "reciprocal_rank", "ndcg_at_k")


@router.get("/{baseline_id}/compare", response_model=ComparisonOut)
def compare_result_collections(
    baseline_id: int,
    candidate_id: list[int] = Query(...),
    k: int = Query(10, ge=1, le=50),
    tau: int = Query(1, ge=0, le=3),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> ComparisonOut:
    baseline = _get_visible_result_collection(db, baseline_id, principal)
    if baseline.status != "completed":
        raise HTTPException(status_code=400, detail="Baseline result collection is not completed")
    if baseline_id in candidate_id:
        raise HTTPException(status_code=400, detail="Baseline cannot also be a candidate")

    candidates = [_get_visible_result_collection(db, cid, principal) for cid in candidate_id]
    for candidate in candidates:
        if candidate.test_collection_id != baseline.test_collection_id:
            raise HTTPException(
                status_code=400,
                detail="Candidate result collection belongs to a different test collection",
            )
        if candidate.status != "completed":
            raise HTTPException(
                status_code=400, detail="Candidate result collection is not completed"
            )

    baseline_cases = (
        db.query(ResultCase).filter(ResultCase.result_collection_id == baseline.id).all()
    )

    comparisons = []
    for candidate in candidates:
        candidate_cases = (
            db.query(ResultCase).filter(ResultCase.result_collection_id == candidate.id).all()
        )
        paired = paired_case_metrics(baseline_cases, candidate_cases, k, tau)

        metric_blocks = {}
        for key in _COMPARISON_METRIC_KEYS:
            baseline_values = [baseline_metrics[key] for _, _, baseline_metrics, _ in paired]
            candidate_values = [candidate_metrics[key] for _, _, _, candidate_metrics in paired]
            baseline_mean = sum(baseline_values) / len(baseline_values) if paired else 0.0
            candidate_mean = sum(candidate_values) / len(candidate_values) if paired else 0.0
            wilcoxon_result = wilcoxon_signed_rank(baseline_values, candidate_values)
            metric_blocks[key] = MetricComparisonOut(
                baseline=baseline_mean,
                candidate=candidate_mean,
                delta=candidate_mean - baseline_mean,
                wilcoxon_statistic=wilcoxon_result["statistic"],
                wilcoxon_p_value=wilcoxon_result["p_value"],
                n=wilcoxon_result["n"],
            )

        n_baseline_only = sum(
            1
            for _, _, baseline_metrics, candidate_metrics in paired
            if baseline_metrics["recall_at_k"] > 0 and not candidate_metrics["recall_at_k"] > 0
        )
        n_candidate_only = sum(
            1
            for _, _, baseline_metrics, candidate_metrics in paired
            if candidate_metrics["recall_at_k"] > 0 and not baseline_metrics["recall_at_k"] > 0
        )

        comparisons.append(
            RunComparisonOut(
                candidate_id=candidate.id,
                candidate_configuration_name=candidate.configuration_snapshot["name"],
                overlap_case_count=len(paired),
                recall_at_k=metric_blocks["recall_at_k"],
                precision_at_k=metric_blocks["precision_at_k"],
                reciprocal_rank=metric_blocks["reciprocal_rank"],
                ndcg_at_k=metric_blocks["ndcg_at_k"],
                found_at_k=McNemarOut(**mcnemar_exact(n_baseline_only, n_candidate_only)),
                cases=[
                    CaseComparisonOut(
                        test_case_id=baseline_rc.test_case_id,
                        content=baseline_rc.snapshot["content"],
                        baseline=CaseMetricValuesOut(**baseline_metrics),
                        candidate=CaseMetricValuesOut(**candidate_metrics),
                    )
                    for baseline_rc, _, baseline_metrics, candidate_metrics in paired
                ],
            )
        )

    return ComparisonOut(
        baseline_id=baseline.id,
        baseline_configuration_name=baseline.configuration_snapshot["name"],
        test_collection_id=baseline.test_collection_id,
        test_collection_name=baseline.test_collection.name,
        k=k,
        tau=tau,
        comparisons=comparisons,
    )


@router.get("/{result_collection_id}/export")
def export_result_collection(
    result_collection_id: int,
    k: int = Query(10, ge=1, le=50),
    tau: int = Query(1, ge=0, le=3),
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> Response:
    result_collection = _get_visible_result_collection(db, result_collection_id, principal)
    if result_collection.status != "completed":
        raise HTTPException(status_code=400, detail="Result collection is not completed")

    result_cases = (
        db.query(ResultCase).filter(ResultCase.result_collection_id == result_collection.id).all()
    )
    content = build_export_zip(
        result_collection, result_cases, result_collection.test_collection.name, k, tau
    )
    return Response(
        content=content,
        media_type="application/zip",
        headers={
            "Content-Disposition": (
                f'attachment; filename="result-collection-{result_collection.id}-export.zip"'
            )
        },
    )


@router.delete("/{result_collection_id}", status_code=204)
def delete_result_collection(
    result_collection_id: int,
    db: Session = Depends(get_db),
    principal: Principal = Depends(require_role("run_experiments")),
) -> None:
    result_collection = _get_visible_result_collection(db, result_collection_id, principal)
    db.delete(result_collection)
    db.commit()
