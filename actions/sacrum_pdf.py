#!/usr/bin/env python3
"""Sacrum PDF: small command-line tools for preparing scanned PDFs.

Human-facing page numbers are 1-based. The source PDF is never modified.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Iterable

try:
    import pymupdf
except ImportError:  # pragma: no cover - provides a useful CLI error
    print(
        "PyMuPDF is not installed. Run: pip install -r actions/requirements.txt",
        file=sys.stderr,
    )
    raise SystemExit(1)


class SacrumPDFError(Exception):
    """An error safe to display directly to the user."""


def existing_pdf(value: str) -> Path:
    path = Path(value).expanduser().resolve()
    if not path.exists():
        raise argparse.ArgumentTypeError(f"File not found: {path}")
    if not path.is_file():
        raise argparse.ArgumentTypeError(f"Not a file: {path}")
    if path.suffix.lower() != ".pdf":
        raise argparse.ArgumentTypeError(f"Expected a PDF file: {path}")
    return path


def parse_page_spec(spec: str, page_count: int) -> list[int]:
    """Parse a page expression such as ``1-6,10,14-16``.

    Returns sorted, unique, 1-based page numbers.
    """
    pages: set[int] = set()

    for raw_section in spec.split(","):
        section = raw_section.strip()
        if not section:
            raise SacrumPDFError(f"Invalid empty page section in: {spec!r}")

        if "-" in section:
            parts = section.split("-")
            if len(parts) != 2 or not all(parts):
                raise SacrumPDFError(f"Invalid page range: {section!r}")
            try:
                start, end = (int(part) for part in parts)
            except ValueError as exc:
                raise SacrumPDFError(f"Invalid page range: {section!r}") from exc
            if start > end:
                raise SacrumPDFError(
                    f"Page range must run from low to high: {section!r}"
                )
            pages.update(range(start, end + 1))
        else:
            try:
                pages.add(int(section))
            except ValueError as exc:
                raise SacrumPDFError(f"Invalid page number: {section!r}") from exc

    if not pages:
        raise SacrumPDFError("No pages were specified.")

    invalid = sorted(page for page in pages if page < 1 or page > page_count)
    if invalid:
        rendered = ", ".join(str(page) for page in invalid)
        raise SacrumPDFError(
            f"Pages outside this document's range of 1-{page_count}: {rendered}"
        )

    return sorted(pages)


def default_output(input_path: Path, suffix: str) -> Path:
    return input_path.with_name(f"{input_path.stem}-{suffix}.pdf")


def resolve_output(input_path: Path, requested: str | None, suffix: str) -> Path:
    output_path = (
        Path(requested).expanduser().resolve()
        if requested
        else default_output(input_path, suffix)
    )

    if output_path.suffix.lower() != ".pdf":
        output_path = output_path.with_suffix(".pdf")

    if output_path == input_path:
        raise SacrumPDFError(
            "The output path must differ from the source PDF; the source is never overwritten."
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    return output_path


def save_document(document: pymupdf.Document, output_path: Path) -> None:
    document.save(
        output_path,
        garbage=4,
        deflate=True,
        clean=True,
    )


def format_bytes(size: int) -> str:
    units = ("B", "KB", "MB", "GB")
    amount = float(size)
    for unit in units:
        if amount < 1024 or unit == units[-1]:
            return f"{amount:.1f} {unit}" if unit != "B" else f"{int(amount)} B"
        amount /= 1024
    return f"{size} B"


def inspect_pdf(input_path: Path) -> None:
    try:
        with pymupdf.open(input_path) as document:
            metadata = document.metadata or {}
            toc = document.get_toc(simple=True)
            text_sample = ""
            sample_count = min(document.page_count, 5)
            for index in range(sample_count):
                text_sample += document[index].get_text("text", sort=True).strip()
                if len(text_sample) >= 200:
                    break

            print(f"File:       {input_path.name}")
            print(f"Path:       {input_path}")
            print(f"Pages:      {document.page_count}")
            print(f"Size:       {format_bytes(input_path.stat().st_size)}")
            print(f"Title:      {metadata.get('title') or '(not set)'}")
            print(f"Author:     {metadata.get('author') or '(not set)'}")
            print(f"Bookmarks:  {len(toc)}")
            print(f"Text layer: {'detected' if text_sample else 'not detected in first pages'}")
    except Exception as exc:
        raise SacrumPDFError(f"Could not inspect PDF: {exc}") from exc


def remove_pages(input_path: Path, spec: str, output: str | None) -> Path:
    try:
        with pymupdf.open(input_path) as document:
            pages = parse_page_spec(spec, document.page_count)
            if len(pages) == document.page_count:
                raise SacrumPDFError("This command would remove every page.")

            output_path = resolve_output(input_path, output, "cleaned")
            zero_based = [page - 1 for page in pages]
            document.delete_pages(zero_based)
            save_document(document, output_path)
            return output_path
    except SacrumPDFError:
        raise
    except Exception as exc:
        raise SacrumPDFError(f"Could not remove pages: {exc}") from exc


def trim_pages(
    input_path: Path,
    front: int,
    back: int,
    output: str | None,
) -> Path:
    if front < 0 or back < 0:
        raise SacrumPDFError("--front and --back cannot be negative.")
    if front == 0 and back == 0:
        raise SacrumPDFError("Specify at least one page to trim.")

    try:
        with pymupdf.open(input_path) as document:
            if front + back >= document.page_count:
                raise SacrumPDFError("This command would remove every page.")

            pages: list[int] = list(range(1, front + 1))
            if back:
                pages.extend(range(document.page_count - back + 1, document.page_count + 1))

            output_path = resolve_output(input_path, output, "trimmed")
            document.delete_pages([page - 1 for page in sorted(set(pages))])
            save_document(document, output_path)
            return output_path
    except SacrumPDFError:
        raise
    except Exception as exc:
        raise SacrumPDFError(f"Could not trim PDF: {exc}") from exc


def keep_pages(input_path: Path, spec: str, output: str | None) -> Path:
    try:
        with pymupdf.open(input_path) as source:
            pages = parse_page_spec(spec, source.page_count)
            output_path = resolve_output(input_path, output, "selected")

            result = pymupdf.open()
            try:
                for page in pages:
                    result.insert_pdf(source, from_page=page - 1, to_page=page - 1)
                save_document(result, output_path)
            finally:
                result.close()
            return output_path
    except SacrumPDFError:
        raise
    except Exception as exc:
        raise SacrumPDFError(f"Could not keep selected pages: {exc}") from exc


def add_common_output_argument(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "-o",
        "--output",
        help="Output PDF path. A safe name beside the source is used by default.",
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="sacrum-pdf",
        description="Prepare scanned PDFs without modifying the original file.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    inspect_parser = subparsers.add_parser(
        "inspect", help="Show basic PDF information."
    )
    inspect_parser.add_argument("pdf", type=existing_pdf)

    remove_parser = subparsers.add_parser(
        "remove-pages", help="Remove pages such as 1-6,10,400-402."
    )
    remove_parser.add_argument("pdf", type=existing_pdf)
    remove_parser.add_argument("pages", help="1-based page expression.")
    add_common_output_argument(remove_parser)

    trim_parser = subparsers.add_parser(
        "trim", help="Remove a number of pages from the front and/or back."
    )
    trim_parser.add_argument("pdf", type=existing_pdf)
    trim_parser.add_argument("--front", type=int, default=0)
    trim_parser.add_argument("--back", type=int, default=0)
    add_common_output_argument(trim_parser)

    keep_parser = subparsers.add_parser(
        "keep-pages", help="Create a PDF containing only selected pages."
    )
    keep_parser.add_argument("pdf", type=existing_pdf)
    keep_parser.add_argument("pages", help="1-based page expression.")
    add_common_output_argument(keep_parser)

    return parser


def main(argv: Iterable[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)

    try:
        if args.command == "inspect":
            inspect_pdf(args.pdf)
            return 0

        if args.command == "remove-pages":
            output_path = remove_pages(args.pdf, args.pages, args.output)
        elif args.command == "trim":
            output_path = trim_pages(args.pdf, args.front, args.back, args.output)
        elif args.command == "keep-pages":
            output_path = keep_pages(args.pdf, args.pages, args.output)
        else:  # pragma: no cover
            parser.error(f"Unknown command: {args.command}")
            return 2

        print(f"Created: {output_path}")
        return 0
    except SacrumPDFError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
