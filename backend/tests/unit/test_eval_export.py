import csv
import io
import json
import zipfile

from app.eval.export import build_export_zip
from app.eval.models import ResultCase, ResultCollection

SAMPLE_SNAPSHOT = {
    "content": "who created the world",
    "language": "eng",
    "source": None,
    "context": None,
    "tags": [],
    "targets": [
        {"target": "kjv:gen:1:1", "relevance": 3},
        {"target": "kjv:gen:1:2", "relevance": 1},
    ],
}


def _result_case(case_id: int, test_case_id: int, ranked_ids: list[str]) -> ResultCase:
    return ResultCase(
        id=case_id,
        test_case_id=test_case_id,
        result_collection_id=1,
        results=[
            {
                "id": doc_id,
                "type": "verse",
                "book": "Genesis",
                "chapter": "1",
                "verse": str(i + 1),
                "source": "kjv",
                "score": 1.0 / (i + 1),
            }
            for i, doc_id in enumerate(ranked_ids)
        ],
        snapshot=SAMPLE_SNAPSHOT,
        score_stats=None,
    )


def _result_collection() -> ResultCollection:
    return ResultCollection(
        id=1,
        test_collection_id=1,
        configuration_snapshot={"name": "hybrid", "weights": {}},
        books_snapshot=[],
        sources_snapshot=[],
        status="completed",
    )


def test_manifest_has_hand_computed_metrics() -> None:
    # Single case, ranked_ids finds the relevance=3 target at rank 1 and misses
    # the relevance=1 target entirely: recall@10 (tau=1, both targets relevant)
    # = 1/2, precision@10 = 1/10, MRR = 1, nDCG@10 hand-verified against the
    # existing eval report endpoint's own fixture shape in test_eval_results_api.py.
    result_case = _result_case(1, 1, ["kjv:gen:1:1", "kjv:gen:2:1", "kjv:gen:3:1"])
    result_collection = _result_collection()

    zip_bytes = build_export_zip(result_collection, [result_case], "my collection", k=10, tau=1)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        manifest = json.loads(zf.read("manifest.json"))

    assert manifest["result_collection_id"] == 1
    assert manifest["test_collection_id"] == 1
    assert manifest["test_collection_name"] == "my collection"
    assert manifest["status"] == "completed"
    assert manifest["k"] == 10
    assert manifest["tau"] == 1
    assert manifest["metrics"]["recall_at_k"] == 0.5
    assert manifest["metrics"]["precision_at_k"] == 0.1
    assert manifest["metrics"]["mrr"] == 1.0


def test_case_csv_annotates_ranked_hits_with_target_relevance() -> None:
    result_case = _result_case(7, 42, ["kjv:gen:1:1", "kjv:gen:1:5", "kjv:gen:1:2"])
    result_collection = _result_collection()

    zip_bytes = build_export_zip(result_collection, [result_case], "my collection", k=10, tau=1)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        assert zf.namelist() == ["manifest.json", "test_case_42.csv"]
        rows = list(csv.DictReader(io.StringIO(zf.read("test_case_42.csv").decode())))

    assert [r["id"] for r in rows] == ["kjv:gen:1:1", "kjv:gen:1:5", "kjv:gen:1:2"]
    assert [r["rank"] for r in rows] == ["1", "2", "3"]

    matched, unmatched, missed_grade_row = rows[0], rows[1], rows[2]
    assert matched["is_target"] == "True"
    assert matched["relevance"] == "3"
    assert unmatched["is_target"] == "False"
    assert unmatched["relevance"] == ""
    assert missed_grade_row["is_target"] == "True"
    assert missed_grade_row["relevance"] == "1"


def test_multiple_result_cases_each_get_their_own_csv() -> None:
    cases = [_result_case(1, 10, ["a"]), _result_case(2, 11, ["b"])]
    zip_bytes = build_export_zip(_result_collection(), cases, "coll", k=10, tau=1)
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
        assert set(zf.namelist()) == {"manifest.json", "test_case_10.csv", "test_case_11.csv"}
