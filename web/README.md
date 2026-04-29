# MSB Interlinear Viewer (Static Site)

This is a fully static site that renders your USX files in a two-line interlinear style.

## What it does

- Reads bundled `*.usx` files from `web/usx/`.
- Uses each `<char style="rb" gloss="...">...</char>` token.
- Displays:
  - top line: `gloss` (source token)
  - bottom line: char text (translation token)
- Lets you switch books and chapters.

## Run locally

From `web/`, run:

```bash
cd web
python3 -m http.server 8000
```

Then open:

- http://localhost:8000/

## Deploy as a static site

Deploy the `web/` folder to any static host (GitHub Pages, Netlify, Cloudflare Pages, S3 static hosting, etc.).

- Publish directory: `web/`
- No build step
- No backend required

## Files

- `web/index.html` - app shell
- `web/styles.css` - interlinear layout and styling
- `web/books.js` - book-to-file mapping
- `web/app.js` - USX parser + renderer
- `web/usx/*.usx` - source text data files

## Notes

- The app must be served over HTTP(S); opening `index.html` directly from disk (`file://`) will block fetch requests in most browsers.
