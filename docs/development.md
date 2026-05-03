# Local Development Guide

## Environment Setup

### Prerequisites
- Node.js 18+
- npm 9+
- Google Chrome

### Install

```bash
git clone https://github.com/shawnohn/medium-exporter.git
cd medium-exporter
npm install
```

## Development Server

```bash
npm run dev
```

Starts Vite with the CRXJS plugin. The `dist/` directory is produced and the extension auto-reloads on file changes.

Load the extension once from `dist/` (see [deployment.md](deployment.md)), then changes hot-reload automatically.

## Type Checking

```bash
npx tsc --noEmit
```

Runs TypeScript in check-only mode. The project uses strict mode with Chrome API types.

## Versioning

```bash
npm run version:bump
```

Bumps patch version and syncs `package.json` + `manifest.json` (+ lockfile when present).

## Coding Rules

### Extractor Constraints
The `extractArticle()` function in `src/content/extractor.ts` is serialized and injected into web pages. It must be:
- **Self-contained** — no module imports (type-only imports are fine)
- **No closures** — cannot reference variables outside the function
- **DOM-only** — can only use browser DOM APIs available in the page context

### Content Cleaning
- Prefer semantic selectors (`button`, `aside`, `svg`) over CSS class names
- Medium's class names change frequently — don't rely on them
- Be conservative: leaving minor noise is better than stripping article content
- `[role="button"]` elements are only removed when they don't contain images (Medium wraps zoomable images in these)

### Conversion
- Turndown runs in the **popup context** (not the service worker) because it requires DOM
- Custom rules are defined in `src/shared/converter.ts`
- Code blocks use dynamic fence length to handle content containing backticks
- Post-processing handles whitespace normalization

### Batch List Processing
- List pages are extracted via `src/content/list-extractor.ts`
- Batch fetches happen through background `FETCH_ARTICLE_HTML` messages
- Popup uses bounded concurrency for faster processing and supports retrying failed URLs
- Parsed article results are cached in-memory during the popup session to reduce duplicate work
- Batch mode requests HTTPS host permission at runtime so redirects to publication domains can be fetched

### Obsidian Integration
- Settings (API URL, API key, folder path) stored in `chrome.storage.local`
- Settings passed in each message to keep the service worker stateless
- `optional_host_permissions` requested at runtime for batch fetch hosts and integration hosts
- Default API URL: `http://127.0.0.1:27123` (HTTP preferred over HTTPS to avoid cert issues)

### WordPress Integration
- Endpoint must end with `/wp-json/wp/v2/posts`
- Public hosts must use HTTPS
- HTTP is allowed for loopback and private-network hosts (`localhost`, `127.0.0.1`, `10.x.x.x`, `172.16-31.x.x`, `192.168.x.x`, and `.local` hostnames)
- Authentication uses WordPress Application Passwords via Basic auth
- In list batch mode, list title is used as category name and resolved/created automatically

## Project Structure

| Directory | Purpose |
|-----------|---------|
| `src/content/` | Content extractor (injected into pages) |
| `src/background/` | Service worker (message routing, fetch, downloads, Obsidian and WordPress APIs) |
| `src/popup/` | Popup UI (single article + list batch orchestration) |
| `src/shared/` | Shared types, messages, parser, converter, frontmatter |
| `public/icons/` | Extension icons (SVG sources + generated PNGs) |
| `docs/` | Project documentation |

## Testing

Manual QA only (no automated tests in MVP). Test on:
- Standard Medium article
- Article with code blocks (including nested backticks)
- Article with images and captions (verify all images appear)
- Article with nested lists and blockquotes
- Member-only article (partial content visible)
- Non-Medium page (should show error)
- Send to Obsidian (verify note appears in correct folder)
- Send to WordPress from single article mode
- Send selected list items to WordPress (category from list title)
- Retry failed list items (ZIP and WordPress batch)
- Paste output into Obsidian to verify rendering
