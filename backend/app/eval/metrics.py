"""Ranking metrics for the eval harness — pure functions, no DB/HTTP.

`recall_at_k`/`precision_at_k`/`reciprocal_rank` all consume a plain
`set[str]` of relevant ids: the caller thresholds a test case's graded
`test_case_target` relevance against `tau` once
(`{t for t, rel in target_relevance.items() if rel >= tau}`) and passes the
result to all three, rather than each function re-implementing thresholding.
`ndcg_at_k` is the one graded-relevance-native metric — it consumes the raw
`target_relevance` dict directly and takes no `tau`.
"""

import math

from scipy.stats import wilcoxon


def recall_at_k(ranked_ids: list[str], relevant_ids: set[str], k: int) -> float:
    if not relevant_ids:
        return 0.0
    retrieved = set(ranked_ids[:k])
    return len(retrieved & relevant_ids) / len(relevant_ids)


def precision_at_k(ranked_ids: list[str], relevant_ids: set[str], k: int) -> float:
    retrieved = ranked_ids[:k]
    hits = sum(1 for doc_id in retrieved if doc_id in relevant_ids)
    return hits / k


def reciprocal_rank(ranked_ids: list[str], relevant_ids: set[str]) -> float:
    for rank, doc_id in enumerate(ranked_ids, start=1):
        if doc_id in relevant_ids:
            return 1 / rank
    return 0.0


def _dcg(relevances: list[int]) -> float:
    return sum(
        (2**relevance - 1) / math.log2(position + 1)
        for position, relevance in enumerate(relevances, start=1)
    )


def ndcg_at_k(ranked_ids: list[str], target_relevance: dict[str, int], k: int) -> float:
    gains = [target_relevance.get(doc_id, 0) for doc_id in ranked_ids[:k]]
    ideal_gains = sorted(target_relevance.values(), reverse=True)[:k]
    idcg = _dcg(ideal_gains)
    if idcg == 0:
        return 0.0
    return _dcg(gains) / idcg


def evaluate_case(
    ranked_ids: list[str], target_relevance: dict[str, int], k: int, tau: int
) -> dict[str, float]:
    relevant_ids = {target for target, relevance in target_relevance.items() if relevance >= tau}
    return {
        "recall_at_k": recall_at_k(ranked_ids, relevant_ids, k),
        "precision_at_k": precision_at_k(ranked_ids, relevant_ids, k),
        "reciprocal_rank": reciprocal_rank(ranked_ids, relevant_ids),
        "ndcg_at_k": ndcg_at_k(ranked_ids, target_relevance, k),
    }


def mcnemar_exact(n_baseline_only: int, n_candidate_only: int) -> dict:
    """Exact two-sided McNemar's test (binomial sign test) on the discordant
    pairs of a paired binary found/not-found comparison. Concordant pairs
    (both found, both missed) carry no information about a *difference*
    between the two runs and are deliberately not passed in here.
    """
    n = n_baseline_only + n_candidate_only
    if n == 0:
        p_value = 1.0
    else:
        smaller = min(n_baseline_only, n_candidate_only)
        tail = sum(math.comb(n, i) for i in range(smaller + 1)) / 2**n
        p_value = min(1.0, 2 * tail)
    return {
        "n_baseline_only": n_baseline_only,
        "n_candidate_only": n_candidate_only,
        "statistic": min(n_baseline_only, n_candidate_only),
        "p_value": p_value,
    }


def wilcoxon_signed_rank(baseline_values: list[float], candidate_values: list[float]) -> dict:
    """Paired Wilcoxon signed-rank test on `candidate - baseline`. Ties
    (equal values on both sides) are dropped before ranking (scipy's
    `zero_method="wilcox"`) — if every pair ties (or there are no pairs at
    all), there's nothing to test: checked explicitly rather than relying on
    scipy's behavior in that case, which varies by version (older scipy
    raises `ValueError`; newer scipy divides 0/0 into a `RuntimeWarning` plus
    a not-really-meaningful result).
    """
    non_zero = sum(1 for b, c in zip(baseline_values, candidate_values, strict=True) if b != c)
    if non_zero == 0:
        return {"statistic": None, "p_value": None, "n": 0}
    result = wilcoxon(candidate_values, baseline_values, zero_method="wilcox", method="auto")
    return {"statistic": float(result.statistic), "p_value": float(result.pvalue), "n": non_zero}


def aggregate(cases: list[tuple[list[str], dict[str, int]]], k: int, tau: int) -> dict:
    per_case = [
        evaluate_case(ranked_ids, target_relevance, k, tau)
        for ranked_ids, target_relevance in cases
    ]
    if not per_case:
        return {
            "recall_at_k": 0.0,
            "precision_at_k": 0.0,
            "mrr": 0.0,
            "ndcg_at_k": 0.0,
            "per_case": [],
        }

    return {
        "recall_at_k": sum(c["recall_at_k"] for c in per_case) / len(per_case),
        "precision_at_k": sum(c["precision_at_k"] for c in per_case) / len(per_case),
        "mrr": sum(c["reciprocal_rank"] for c in per_case) / len(per_case),
        "ndcg_at_k": sum(c["ndcg_at_k"] for c in per_case) / len(per_case),
        "per_case": per_case,
    }
