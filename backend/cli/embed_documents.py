import argparse
import json
from pathlib import Path


def _read_documents(input_file: Path) -> list[dict]:
    lines = input_file.read_text().splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def _write_documents(output_file: Path, documents: list[dict]) -> None:
    with output_file.open("w") as f:
        for document in documents:
            f.write(json.dumps(document) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(
        description=(
            "Compute embeddings for a corpus JSONL file's content and variant "
            "content. Reads/writes {id, type, book, chapter, verse, source, "
            "content, variant: [{source, content}]} objects, one per line."
        )
    )
    parser.add_argument("--input-file", required=True, type=Path)
    parser.add_argument("--language", required=True)
    parser.add_argument("--output-file", required=True, type=Path)
    args = parser.parse_args()

    from app.embeddings.model import encode_documents, load_model
    from app.registry import get_language_pack

    language_pack = get_language_pack(args.language)
    spec = language_pack.embedding_spec
    if spec is None:
        raise SystemExit(f"{args.language} has no embedding model configured")

    documents = _read_documents(args.input_file)
    model = load_model(spec)

    content_embeddings = encode_documents(model, spec, [doc["content"] for doc in documents])
    for document, embedding in zip(documents, content_embeddings, strict=True):
        document["embedding"] = embedding

    variant_refs = [variant for document in documents for variant in document.get("variant", [])]
    if variant_refs:
        variant_embeddings = encode_documents(
            model, spec, [variant["content"] for variant in variant_refs]
        )
        for variant, embedding in zip(variant_refs, variant_embeddings, strict=True):
            variant["embedding"] = embedding

    _write_documents(args.output_file, documents)
    print(f"Encoded {len(documents)} documents -> {args.output_file}")


if __name__ == "__main__":
    main()
