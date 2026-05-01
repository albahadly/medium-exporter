# CLAUDE.md - Medium to Markdown Exporter

## Project Overview
Chrome Extension (Manifest V3) that exports Medium articles to clean, Obsidian-compatible Markdown.
Supports single-article export and list-page batch processing.
Users can copy markdown, download `.md`/ZIP, send to Obsidian, or publish to WordPress.

## Tech Stack
- **Build:** Vite + @crxjs/vite-plugin v2
- **Language:** TypeScript (strict mode)
- **UI:** Plain HTML + CSS (no framework)
- **Conversion:** Turndown v7 (bundled locally)
- **Target:** Chrome Extension Manifest V3

## Architecture

### Core Components
1. **Article Extractor** (`src/content/extractor.ts`) — Injected on Medium article pages via `chrome.scripting.executeScript({ func })`. Must be self-contained at runtime.
2. **List Extractor** (`src/content/list-extractor.ts`) — Injected on Medium list pages to collect article URLs.
3. **Background Service Worker** (`src/background/service-worker.ts`) — Message router, network fetches, file downloads, Obsidian API, WordPress API.
4. **Popup** (`src/popup/`) — UI orchestrator. Runs Turndown conversion, handles selection state, batch progress, and retry.
5. **Shared Parser** (`src/shared/article-parser.ts`) — Parses fetched article HTML during batch mode in popup context.

### Message Flow
```
Popup opens → EXTRACT → Background → injects extractor → returns { metadata, articleHtml }
Copy click → popup calls navigator.clipboard.writeText() directly (no message needed)
Download click → DOWNLOAD_FILE → Background → chrome.downloads.download
Send to Obsidian click → SEND_TO_OBSIDIAN → Background → fetch PUT /vault/{path} → Obsidian Local REST API
List page popup → EXTRACT_LIST → Background → injects list extractor → returns article URLs
Batch worker → FETCH_ARTICLE_HTML per selected URL → popup parses + converts
WordPress click → SEND_TO_WORDPRESS → Background → WordPress REST API /posts
```

### Why Turndown runs in Popup (not Service Worker)
Turndown requires a DOM (`document`). Service workers have no DOM. The popup has a full DOM context.

## Directory Structure
```
medium-exporter/
├── CLAUDE.md
├── README.md
├── docs/                      # Reference documentation
│   ├── PRD.md
│   ├── implementation-plan.md
│   ├── deployment.md
│   └── development.md
├── package.json
├── tsconfig.json
├── vite.config.ts
├── manifest.json
├── public/icons/           # 16/32/48/128px PNGs
└── src/
    ├── shared/
    │   ├── types.ts        # Shared interfaces (ArticleMetadata, ExportOptions, integration settings)
    │   ├── messages.ts     # Typed message protocol (extract, fetch, download, integrations)
    │   ├── article-parser.ts # Shared parser for batch-fetched HTML
    │   ├── converter.ts    # Turndown config + custom rules
    │   └── frontmatter.ts  # YAML frontmatter builder
    ├── content/
    │   ├── extractor.ts    # Self-contained extractArticle() function
    │   └── list-extractor.ts # Self-contained list URL extraction function
    ├── background/
    │   └── service-worker.ts
    └── popup/
        ├── popup.html
        ├── popup.css
        └── popup.ts        # Orchestrator: UI state, conversion, batch queue, integrations
```

## Key Conventions

### Extractor Must Be Self-Contained
`extractArticle()` is passed to `chrome.scripting.executeScript({ func })`, which serializes the function. It CANNOT reference:
- Imported modules (only type-only imports allowed, erased at compile time)
- Variables outside the function scope
- Closures

All extraction logic (Medium detection, metadata parsing, HTML cleaning) must live inside this single function.

### Metadata Extraction Priority
1. JSON-LD (`<script type="application/ld+json">`)
2. Meta tags (`og:title`, `article:published_time`, etc.)
3. DOM fallback (`document.title`, `<link rel="canonical">`, etc.)

### Content Cleaning Strategy
- Use semantic selectors (`button`, `aside`, `[role="button"]`, `svg`) over brittle class names
- Be conservative: better to leave minor noise than strip article content
- Medium's DOM changes over time; class names are unreliable

### Turndown Custom Rules
- Fenced code blocks with language detection from `class="language-xxx"`
- `<figure>` with `<figcaption>` → `![alt](src)` + italic caption
- Image toggle support: strip `<img>` when images disabled
- Post-processing: collapse 3+ newlines to 2, trim trailing whitespace

### Filename Format
`Article Title.md` (original title, filesystem-unsafe characters stripped)

## Permissions
- `activeTab` — access current tab on user interaction only
- `scripting` — inject extractor function
- `clipboardWrite` — clipboard access
- `downloads` — file download trigger
- `storage` — persist Obsidian/WordPress settings via `chrome.storage.local`

No `content_scripts` in manifest (on-demand injection only). No `host_permissions`.

`optional_host_permissions` are runtime-requested per feature:
- HTTPS origins for list batch fetches (supports Medium redirects to publication domains)
- `localhost` / `127.0.0.1` for local integrations over HTTP/HTTPS
- HTTPS origins for WordPress and other non-local endpoints

## Dependencies
```
Runtime:    turndown ^7.2.0
Dev:        @crxjs/vite-plugin ^2.0.0
            @types/chrome ^0.0.287
            @types/turndown ^5.0.5
            typescript ^5.6.0
            vite ^6.0.0
```

No `turndown-plugin-gfm` — not needed for MVP. Custom rules handle code blocks and figures.

## Build Commands
```bash
npm run dev     # Vite dev server with HMR, outputs to dist/
npm run build   # Production build (tsc + vite build)
npm run version:bump  # Bump extension patch version in package + manifest
```

## Loading in Chrome
1. `chrome://extensions/` → Enable Developer mode
2. Click "Load unpacked" → select `dist/` directory
3. CRXJS provides auto-reload during `npm run dev`

### Obsidian Integration
- Uses the [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) community plugin (no custom Obsidian plugin needed)
- Defaults to HTTP (`http://127.0.0.1:27123`) to avoid self-signed certificate trust issues
- Users must enable "Insecure Server" in the Local REST API plugin settings
- Settings (API URL, API key, folder path) stored in `chrome.storage.local`
- Settings passed in each message to keep the background service worker stateless

### WordPress Integration
- Uses WordPress REST API endpoint `/wp-json/wp/v2/posts`
- Auth via username + Application Password (Basic auth)
- List mode uses list title as category and attempts to resolve/create category before publishing
- Non-local WordPress endpoints are expected to use HTTPS

## Design Principles
- Fully local: no external API calls, no telemetry, no data persistence
- Minimal permissions: `activeTab` over broad host permissions
- No over-engineering: no framework for a simple popup, no GFM plugin for basic rules
- Conservative cleaning: semantic selectors over brittle class names
- Error visibility: all failures surface as user-facing messages in the popup

## Error Handling
- Non-Medium page → "This does not appear to be a Medium article page."
- Extraction failure → specific error from extractor
- Clipboard failure → "Clipboard write failed."
- Download failure → "Download failed: {reason}"
- Obsidian not configured → "Configure Obsidian settings first." + settings panel expands
- Obsidian auth failure → "Authentication failed. Check your API key."
- Obsidian unreachable → "Could not connect to Obsidian. Make sure Obsidian is running with the Local REST API plugin enabled."
- WordPress auth failure → "Authentication failed. Check your WordPress username and application password."
- WordPress category resolution/create failures surface as WordPress send errors
- Batch mode tracks failed URLs and allows "Retry Failed"
- All errors shown in popup status area with `.error` styling

## Implementation Order
1. Project scaffold (package.json, tsconfig, vite config, manifest, icons)
2. Shared types and message protocol
3. Content extractor (extractArticle function)
4. Background service worker (EXTRACT + DOWNLOAD_FILE handlers)
5. Popup UI (HTML + CSS + TS orchestrator)
6. Turndown converter + frontmatter builder
7. Error handling and polish

## Testing
Manual QA — load extension, test on:
- Standard Medium article
- Article with code blocks (verify fenced blocks + language)
- Article with images (verify toggle works)
- Article with lists and blockquotes
- Member-only article (partial content)
- Non-Medium page (verify error)
- Paste result into Obsidian (verify rendering)

## Reference Docs
- `docs/PRD.md` — Product requirements
- `docs/implementation-plan.md` — Implementation task list and build phases
- `docs/deployment.md` — Build, load unpacked, Chrome Web Store submission
- `docs/development.md` — Local dev setup, coding rules, testing

When changing architecture, permissions, build steps, or project structure, update the relevant docs, `README.md`, and this `CLAUDE.md`.
