import pytest

from app.eval.metrics import mcnemar_exact, wilcoxon_signed_rank


def test_mcnemar_exact_hand_computed_binomial() -> None:
    # hand-computed independently (not by calling this implementation):
    # n=6 discordant pairs (1 baseline-only, 5 candidate-only); exact two-sided
    # binomial sign test p = 2 * P(X<=1 | n=6, p=0.5) = 2 * (1+6)/64 = 0.21875
    result = mcnemar_exact(n_baseline_only=1, n_candidate_only=5)
    assert result["statistic"] == 1
    assert result["p_value"] == pytest.approx(0.21875)


def test_mcnemar_exact_no_discordant_pairs_is_not_significant() -> None:
    result = mcnemar_exact(n_baseline_only=0, n_candidate_only=0)
    assert result["p_value"] == 1.0
    assert result["statistic"] == 0


def test_mcnemar_exact_symmetric_in_direction() -> None:
    assert mcnemar_exact(2, 7)["p_value"] == pytest.approx(mcnemar_exact(7, 2)["p_value"])


def test_wilcoxon_signed_rank_hand_verified() -> None:
    # baseline/candidate chosen so ranks can be hand-derived:
    # diffs = candidate - baseline = [1, -1, 2, 2, 4]
    # |diffs| ranks (ties averaged) = [1.5, 1.5, 3.5, 3.5, 5]
    # W+ (positive-signed ranks) = 1.5 + 3.5 + 3.5 + 5 = 13.5
    # W- (negative-signed ranks) = 1.5
    # statistic = min(W+, W-) = 1.5; exact two-sided p independently verified
    # by brute-force enumeration over all 2^5 sign patterns on these same
    # ranks = 0.1875 (matches scipy's own exact-method result)
    baseline = [1.0, 2.0, 3.0, 4.0, 5.0]
    candidate = [2.0, 1.0, 5.0, 6.0, 9.0]
    result = wilcoxon_signed_rank(baseline, candidate)
    assert result["statistic"] == pytest.approx(1.5)
    assert result["p_value"] == pytest.approx(0.1875)
    assert result["n"] == 5


def test_wilcoxon_signed_rank_all_ties_returns_null() -> None:
    result = wilcoxon_signed_rank([1.0, 2.0, 3.0], [1.0, 2.0, 3.0])
    assert result == {"statistic": None, "p_value": None, "n": 0}


def test_wilcoxon_signed_rank_empty_returns_null() -> None:
    result = wilcoxon_signed_rank([], [])
    assert result == {"statistic": None, "p_value": None, "n": 0}
