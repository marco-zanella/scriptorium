"""Bridges ORM `ResultCase` rows into the pure metrics functions in `metrics.py`."""

from app.eval.metrics import aggregate, evaluate_case
from app.eval.models import ResultCase


def ranked_ids(result_case: ResultCase) -> list[str]:
    return [hit["id"] for hit in result_case.results]


def target_relevance(result_case: ResultCase) -> dict[str, int]:
    return {t["target"]: t["relevance"] for t in result_case.snapshot["targets"]}


def aggregate_result_cases(result_cases: list[ResultCase], k: int, tau: int) -> dict:
    cases_for_metrics = [(ranked_ids(rc), target_relevance(rc)) for rc in result_cases]
    return aggregate(cases_for_metrics, k, tau)


def paired_case_metrics(
    baseline_cases: list[ResultCase], candidate_cases: list[ResultCase], k: int, tau: int
) -> list[tuple[ResultCase, ResultCase, dict[str, float], dict[str, float]]]:
    """Matches baseline/candidate result cases by `test_case_id` and evaluates
    both sides at the same k/tau. Cases present on only one side (the test
    collection's membership changed between the two runs) are excluded —
    a paired comparison has nothing to pair them against.
    """
    baseline_by_case = {rc.test_case_id: rc for rc in baseline_cases}
    candidate_by_case = {rc.test_case_id: rc for rc in candidate_cases}
    shared_ids = sorted(baseline_by_case.keys() & candidate_by_case.keys())

    paired = []
    for test_case_id in shared_ids:
        baseline_rc = baseline_by_case[test_case_id]
        candidate_rc = candidate_by_case[test_case_id]
        baseline_metrics = evaluate_case(
            ranked_ids(baseline_rc), target_relevance(baseline_rc), k, tau
        )
        candidate_metrics = evaluate_case(
            ranked_ids(candidate_rc), target_relevance(candidate_rc), k, tau
        )
        paired.append((baseline_rc, candidate_rc, baseline_metrics, candidate_metrics))
    return paired
