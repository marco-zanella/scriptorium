import pytest

from app.search.service import _confidence, _percentile, _score_stats


def test_score_stats_none_when_no_results() -> None:
    assert _score_stats([]) is None


def test_score_stats_single_result() -> None:
    stats = _score_stats([{"score": 2.5}])
    assert stats.count == 1
    assert stats.min == stats.max == stats.avg == 2.5
    assert stats.std_deviation == 0.0
    assert all(v == 2.5 for v in stats.percentiles.values())
    assert stats.gap == 0.0  # no rank-2 to compare against
    assert stats.confidence == 0.0  # nothing to be confident about either


def test_score_stats_computed_from_hits_own_scores_not_a_wider_population() -> None:
    """The whole point of this fix: stats describe exactly the scores the
    caller's hits carry (post-normalization, if any), never anything wider
    or on a different scale — see the docstring on _score_stats for why an
    OpenSearch aggregation on `_score` got this wrong for hybrid queries."""
    # Descending, as OpenSearch actually returns ranked hits.
    results = [{"score": 4.0}, {"score": 3.0}, {"score": 2.0}, {"score": 1.0}]
    stats = _score_stats(results)
    assert stats.count == 4
    assert stats.min == 1.0
    assert stats.max == 4.0
    assert stats.avg == pytest.approx(2.5)
    assert stats.percentiles["50"] == pytest.approx(2.5)


def test_score_stats_gap_reads_off_rank_order_not_sorted_order() -> None:
    results = [{"score": 9.0}, {"score": 6.0}, {"score": 5.0}]
    stats = _score_stats(results)
    assert stats.gap == pytest.approx(3.0)


def test_confidence_zero_for_a_flat_distribution() -> None:
    assert _confidence([1.0, 1.0, 1.0, 1.0]) == 0.0


def test_confidence_high_for_one_clear_leader() -> None:
    """One dominant score and a tight cluster near the bottom — the 'system is
    sure' case from the design discussion — should score much higher than a
    gently, evenly decaying ranking of the same size."""
    dominant_leader = [10.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]
    even_decay = [10.0, 9.0, 8.0, 7.0, 6.0, 5.0, 4.0, 3.0, 2.0, 1.0]
    assert _confidence(sorted(dominant_leader)) > _confidence(sorted(even_decay))


def test_confidence_single_value_is_zero() -> None:
    assert _confidence([5.0]) == 0.0


def test_percentile_linear_interpolation_between_closest_ranks() -> None:
    values = [10.0, 20.0, 30.0, 40.0, 50.0]
    assert _percentile(values, 0) == 10.0
    assert _percentile(values, 100) == 50.0
    assert _percentile(values, 50) == 30.0
    # rank = 0.25 * 4 = 1.0 -> exactly the 2nd element, no interpolation needed
    assert _percentile(values, 25) == 20.0
    # rank = 0.6 * 4 = 2.4 -> 40% of the way from the 3rd to the 4th element
    assert _percentile(values, 60) == pytest.approx(34.0)


def test_percentile_single_value_returns_that_value() -> None:
    assert _percentile([7.0], 95) == 7.0
