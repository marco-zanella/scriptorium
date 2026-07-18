import pytest

from app.eval.metrics import (
    aggregate,
    evaluate_case,
    ndcg_at_k,
    precision_at_k,
    recall_at_k,
    reciprocal_rank,
)

RANKED = ["a", "b", "c", "d", "e"]
RELEVANT = {"c", "e", "z"}  # "z" is relevant but never retrieved


def test_recall_at_k() -> None:
    assert recall_at_k(RANKED, RELEVANT, 3) == pytest.approx(1 / 3)
    assert recall_at_k(RANKED, RELEVANT, 5) == pytest.approx(2 / 3)


def test_recall_at_k_with_no_relevant_ids_is_zero_not_a_div_by_zero() -> None:
    assert recall_at_k(RANKED, set(), 5) == 0.0


def test_precision_at_k() -> None:
    assert precision_at_k(RANKED, RELEVANT, 3) == pytest.approx(1 / 3)
    assert precision_at_k(RANKED, RELEVANT, 5) == pytest.approx(2 / 5)


def test_precision_at_k_divides_by_k_not_by_retrieved_count() -> None:
    # only 2 documents ever retrieved, but denominator must stay k=10
    assert precision_at_k(["c"], {"c"}, 10) == pytest.approx(1 / 10)


def test_reciprocal_rank() -> None:
    assert reciprocal_rank(RANKED, RELEVANT) == pytest.approx(1 / 3)


def test_reciprocal_rank_is_zero_when_nothing_relevant_is_retrieved() -> None:
    assert reciprocal_rank(RANKED, {"z"}) == 0.0


def test_ndcg_at_k_exponential_gain_hand_verified() -> None:
    # hand-computed independently (not by calling this implementation):
    # gains at positions 1..5 = [0,0,3,0,1], dcg = 7/log2(4) + 1/log2(6) = 3.886852...
    # ideal ordering = [3,2,1] (c,z,e sorted desc)
    # idcg = 7/log2(2) + 3/log2(3) + 1/log2(4) = 9.392789...
    # ndcg = dcg/idcg = 0.4138124...
    target_relevance = {"c": 3, "e": 1, "z": 2}
    assert ndcg_at_k(RANKED, target_relevance, 5) == pytest.approx(0.4138124149651075)


def test_ndcg_at_k_is_zero_when_no_target_has_positive_relevance() -> None:
    assert ndcg_at_k(RANKED, {"c": 0}, 5) == 0.0
    assert ndcg_at_k(RANKED, {}, 5) == 0.0


def test_ndcg_at_k_perfect_ranking_is_one() -> None:
    target_relevance = {"a": 3, "b": 2, "c": 1}
    assert ndcg_at_k(["a", "b", "c", "d", "e"], target_relevance, 5) == pytest.approx(1.0)


def test_evaluate_case_thresholds_relevance_by_tau() -> None:
    target_relevance = {"c": 3, "e": 1, "z": 2}
    # tau=2 excludes "e" (relevance 1) from the relevant set used by
    # recall/precision/mrr, but leaves ndcg untouched (graded, not thresholded)
    result = evaluate_case(RANKED, target_relevance, k=5, tau=2)
    assert result["recall_at_k"] == pytest.approx(1 / 2)  # only "c" of {"c","z"} retrieved
    assert result["precision_at_k"] == pytest.approx(1 / 5)
    assert result["reciprocal_rank"] == pytest.approx(1 / 3)
    assert result["ndcg_at_k"] == pytest.approx(0.4138124149651075)


def test_aggregate_averages_across_cases() -> None:
    cases = [
        (RANKED, {"c": 3, "e": 1, "z": 2}),
        (["z"], {"z": 3}),  # perfect single-hit case: recall/precision/mrr/ndcg all 1.0 at k=1
    ]
    result = aggregate(cases, k=1, tau=1)
    # case 1 at k=1: nothing relevant in top 1 ("a") -> recall/precision/ndcg all zero;
    # reciprocal_rank is NOT capped by k though (by design, matching standard IR
    # practice) -- "c" is the first relevant doc in the full ranked list, at rank 3
    # case 2 at k=1: "z" is the only doc, at rank 1, perfectly relevant -> all 1.0
    assert result["recall_at_k"] == pytest.approx((0.0 + 1.0) / 2)
    assert result["precision_at_k"] == pytest.approx((0.0 + 1.0) / 2)
    assert result["mrr"] == pytest.approx((1 / 3 + 1.0) / 2)
    assert result["ndcg_at_k"] == pytest.approx((0.0 + 1.0) / 2)
    assert len(result["per_case"]) == 2


def test_aggregate_with_no_cases_returns_zeros() -> None:
    result = aggregate([], k=10, tau=1)
    assert result == {
        "recall_at_k": 0.0,
        "precision_at_k": 0.0,
        "mrr": 0.0,
        "ndcg_at_k": 0.0,
        "per_case": [],
    }
