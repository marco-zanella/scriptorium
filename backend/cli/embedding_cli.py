import json
from pathlib import Path

import httpx
import typer

app = typer.Typer()


def _read_documents(input_file: Path) -> list[dict]:
    lines = input_file.read_text().splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def _write_documents(output_file: Path, documents: list[dict]) -> None:
    with output_file.open("w") as f:
        for document in documents:
            f.write(json.dumps(document) + "\n")


@app.command()
def encode(input_file: Path, language: str, output_file: Path) -> None:
    """Compute embeddings for each document's content and variant content.

    Reads/writes JSON-lines: {book, chapter, verse, source, content, variant: [{source, content}]}.
    """
    from app.embeddings.model import encode_documents, load_model
    from app.registry import get_language_pack

    language_pack = get_language_pack(language)
    spec = language_pack.embedding_spec
    if spec is None:
        typer.echo(f"{language} has no embedding model configured", err=True)
        raise typer.Exit(code=1)

    documents = _read_documents(input_file)
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

    _write_documents(output_file, documents)
    typer.echo(f"Encoded {len(documents)} documents -> {output_file}")


@app.command()
def push(
    input_file: Path,
    language: str,
    server_url: str,
    api_key: str = typer.Option(..., envvar="SCRIPTORIUM_API_KEY"),
) -> None:
    """Push already-embedded JSON-lines documents to the ingestion API."""
    from app.registry import get_language_pack

    language_pack = get_language_pack(language)
    spec = language_pack.embedding_spec
    if spec is None:
        typer.echo(f"{language} has no embedding model configured", err=True)
        raise typer.Exit(code=1)

    documents = _read_documents(input_file)
    response = httpx.post(
        f"{server_url.rstrip('/')}/api/ingestion/{language}",
        json={
            "model_id": spec.model_id,
            "model_revision": spec.revision,
            "dimension": spec.dimension,
            "documents": documents,
        },
        headers={"Authorization": f"Bearer {api_key}"},
        timeout=120.0,
    )
    if response.is_error:
        typer.echo(f"Ingestion failed ({response.status_code}): {response.text}", err=True)
        raise typer.Exit(code=1)

    typer.echo(response.json())


if __name__ == "__main__":
    app()
