# Sacrum PDF — Phase One

Small command-line tools for cleaning scanned PDFs before publishing them in Florilegium Reader.

Everything is contained in this `actions/` folder so the reader's base directory remains uncluttered.

## Install

From the repository root in GitHub Codespaces:

```bash
python -m pip install -r actions/requirements.txt
```

## Commands

Run commands from the repository root with:

```bash
python actions/sacrum_pdf.py COMMAND ...
```

All page numbers are **1-based**, matching the page numbers shown by ordinary PDF viewers. The original PDF is never overwritten.

### Inspect a PDF

```bash
python actions/sacrum_pdf.py inspect "this-is-my-book.pdf"
```

This reports the page count, file size, title, author, bookmark count, and whether a text layer was detected in the first pages.

### Remove exact pages

```bash
python actions/sacrum_pdf.py remove-pages "this-is-my-book.pdf" 1-6
```

You can combine individual pages and ranges:

```bash
python actions/sacrum_pdf.py remove-pages "this-is-my-book.pdf" 1-6,10,400-402
```

The default output is:

```text
this-is-my-book-cleaned.pdf
```

Choose another output path with `--output` or `-o`:

```bash
python actions/sacrum_pdf.py remove-pages "this-is-my-book.pdf" 1-6 \
  --output "output/this-is-my-book.pdf"
```

### Trim pages from the front or back

Remove six pages from the front:

```bash
python actions/sacrum_pdf.py trim "this-is-my-book.pdf" --front 6
```

Remove six from the front and two from the back:

```bash
python actions/sacrum_pdf.py trim "this-is-my-book.pdf" --front 6 --back 2
```

The default output is:

```text
this-is-my-book-trimmed.pdf
```

### Keep only selected pages

```bash
python actions/sacrum_pdf.py keep-pages "this-is-my-book.pdf" 7-399
```

You can also combine ranges:

```bash
python actions/sacrum_pdf.py keep-pages "this-is-my-book.pdf" 7-20,25,30-399
```

The default output is:

```text
this-is-my-book-selected.pdf
```

## Help

```bash
python actions/sacrum_pdf.py --help
python actions/sacrum_pdf.py remove-pages --help
python actions/sacrum_pdf.py trim --help
```

## Current scope

Phase One includes:

- PDF inspection
- Removing exact page numbers or ranges
- Trimming a specified number of pages from the beginning or end
- Keeping only selected pages
- Safe output naming without overwriting the source file

Metadata editing, bookmark creation, web optimization, and Cloudflare R2 uploading are intentionally reserved for later phases.
