"""Bridges ORM `ResultCase` rows into the pure metrics functions in `metrics.py`."""

from app.eval.metrics import aggregate
from app.eval.models import ResultCase


def ranked_ids(result_case: ResultCase) -> list[str]:
    return [hit["id"] for hit in result_case.results]


def target_relevance(result_case: ResultCase) -> dict[str, int]:
    return {t["target"]: t["relevance"] for t in result_case.snapshot["targets"]}


def aggregate_result_cases(result_cases: list[ResultCase], k: int, tau: int) -> dict:
    cases_for_metrics = [(ranked_ids(rc), target_relevance(rc)) for rc in result_cases]
    return aggregate(cases_for_metrics, k, tau)
