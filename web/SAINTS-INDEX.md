# Daily Lives of the Saints index

The page at `/web/saints.html` builds a date-to-PDF-page directory for the 650-page, searchable edition of *Little Pictorial Lives of the Saints* already hosted in Librarium.

## How it works

- Loads the same R2 PDF via the reader's existing PDF.js distribution.
- On first use, scans searchable PDF text for month/day headings; skips probable front matter and uses the chronological order of the book to avoid incidental date mentions.
- Saves the resulting map in the browser's local storage, keyed to this PDF's R2 version.
- Links go to `/web/viewer.html?file=...#page=N`.
- Pages where OCR did not expose a clear date heading are interpolated from verified neighboring dates and **marked as approximate**.
- February 29 is treated as a leap-day shortcut to February 28 if the historical book has no separate leap-day entry.
- If fewer than 120 plausible dated headings can be located, the page refuses to fabricate a date-to-page map. This can then be replaced with a reviewed, checked-in JSON map.

## Review / verification

Because the external R2 PDF was not available to the development environment, **the precise date-to-page results have not yet been visually verified**. Before merging or recommending daily use:

1. Open the branch's `/web/saints.html` deployment preview, preferably on a desktop with good network access for the initial OCR-text scan.
2. Check the identified/estimated count displayed by the page. If extraction fails, the page will say so rather than generating false links.
3. Check January 1, March 25, June 29, October 13 (St. Edward the Confessor), November 1, and December 31 against the PDF's visible headings.
4. Verify iPhone Safari PDF.js page hash navigation.
5. If the source PDF is re-uploaded, update `PDF_URL` to its new versioned URL so stored maps are invalidated.

The date index follows the historical calendar of the printed book; it does not substitute for today's liturgical calendar.