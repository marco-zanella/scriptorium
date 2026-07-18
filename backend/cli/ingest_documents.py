import argparse
import json
from pathlib import Path

import httpx


def _read_documents(input_file: Path) -> list[dict]:
    lines = input_file.read_text().splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Push an already-embedded corpus JSONL file to the ingestion API. "
            "Assumes every document already carries its embedding — this does "
            "no encoding of its own (see embed_documents.py for that)."
        )
    )
    parser.add_argument("--input-file", required=True, type=Path)
    parser.add_argument("--language", required=True)
    parser.add_argument(
        "--api-key",
        required=True,
        help="An ingestion-scoped API key, copied from your account page",
    )
    args = parser.parse_args()

    from app.core.config import settings
    from app.registry import get_language_pack

    spec = get_language_pack(args.language).embedding_spec
    if spec is None:
        raise SystemExit(f"{args.language} has no embedding model configured")

    documents = _read_documents(args.input_file)
    response = httpx.post(
        f"{settings.server_url}/api/ingestion/{args.language}",
        json={
            "model_id": spec.model_id,
            "model_revision": spec.revision,
            "dimension": spec.dimension,
            "documents": documents,
        },
        headers={"Authorization": f"Bearer {args.api_key}"},
        timeout=120.0,
    )
    if response.is_error:
        raise SystemExit(f"Ingestion failed ({response.status_code}): {response.text}")

    print(response.json())


if __name__ == "__main__":
    main()
