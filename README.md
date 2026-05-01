# Medium to Markdown Exporter

A Chrome extension that exports Medium content into clean, Obsidian-compatible Markdown. Export a single article, process list pages in batch, download ZIP bundles, or send posts directly to Obsidian and WordPress.

## Features

- **Single-article export** — copy Markdown, download `.md`, send to Obsidian, or publish to WordPress
- **List-page batch mode** — discover list articles and select exactly which items to process
- **Batch ZIP export** — convert selected articles and save as one ZIP file
- **Batch WordPress publish** — publish selected list items directly to WordPress
- **Retry failed items** — rerun only failed URLs after a batch run
- **Concurrent processing** — bounded parallel fetch and conversion for faster large-list exports
- **YAML frontmatter toggle** — include title/author/source/date metadata when needed
- **Image toggle** — include or strip images from output
- **Smart extraction** — removes claps, responses, recommendations, and common Medium chrome
- **Code-block preservation** — fenced blocks with language detection and fence-length safety
- **Fully local processing** — no telemetry and no third-party cloud dependency

## Install

### From source

```bash
git clone https://github.com/shawnohn/medium-exporter.git
cd medium-exporter
npm install
npm run build
```

1. Open `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked** → select the `dist/` folder

### Development

```bash
npm run dev
```

Starts Vite with HMR. The extension auto-reloads on code changes.

## Usage

### Single article

1. Open a Medium article.
2. Click the extension icon.
3. Toggle **Include frontmatter** and **Include images**.
4. Choose one action:
	- **Copy as Markdown**
	- **Download .md**
	- **Send to Obsidian**
	- **Send to WordPress**

### Medium list page (batch mode)

1. Open a Medium list URL (`/list/` or `/@user/lists`).
2. Click the extension icon.
3. Select articles from the discovered list.
4. Choose **Download Selected as ZIP** or **Send Selected to WordPress**.
5. If some items fail, use **Retry Failed** to process only failures.

### Send to Obsidian setup

To send articles directly to your Obsidian vault:

1. Install the [Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) community plugin in Obsidian
2. In the plugin settings, **enable the Insecure Server** (HTTP on port 27123) — this avoids self-signed certificate issues that HTTPS requires
3. Copy the API key from the plugin settings
4. In the extension popup, click **Obsidian Settings**, paste your API key, and click **Save**
5. Optionally set a vault folder (e.g. `Medium Articles/`) to organize exported notes — defaults to the vault root if left empty

The extension defaults to `http://127.0.0.1:27123` (the plugin's HTTP server). Using HTTP is strongly recommended — the HTTPS server (port 27124) requires installing a self-signed certificate into your OS trust store, which varies by platform and is error-prone. HTTP is safe here since traffic never leaves your machine, and the API key still protects against unauthorized access.

### Send to WordPress setup

1. Generate an Application Password in WordPress for your user account.
2. In extension **WordPress Settings**, set endpoint URL to:
	- `https://your-site.example/wp-json/wp/v2/posts`
3. Enter your WordPress username and application password, then click **Save**.

Notes:
- For non-local endpoints, the extension requires HTTPS.
- In list mode, the list title is used as the WordPress category name. The extension resolves or creates the category automatically.

### Example output

```markdown
---
title: "How to Build a Chrome Extension"
author: "Jane Doe"
source: "https://medium.com/@jane/how-to-build-a-chrome-extension-abc123"
published: "2025-03-15"
retrieved: "2025-04-01"
---

# How to Build a Chrome Extension

Article content converted to clean Markdown...
```

## Architecture

| Component | File | Role |
|-----------|------|------|
| Content extractor | `src/content/extractor.ts` | Injected into article pages to extract HTML + metadata |
| List extractor | `src/content/list-extractor.ts` | Injected into list pages to collect article URLs |
| Service worker | `src/background/service-worker.ts` | Message router, fetch/download, Obsidian and WordPress API calls |
| Popup | `src/popup/` | UI orchestration, conversion, batch queue, retry state, settings |
| Article parser | `src/shared/article-parser.ts` | Shared DOM parser for batch HTML fetched in popup |
| Converter | `src/shared/converter.ts` | Turndown with custom rules for code blocks, figures, images |
| Frontmatter | `src/shared/frontmatter.ts` | YAML frontmatter generation |

## Tech Stack

- TypeScript
- Vite + [@crxjs/vite-plugin](https://crxjs.dev/vite-plugin/)
- [Turndown](https://github.com/mixmark-io/turndown) for HTML-to-Markdown
- Chrome Extension Manifest V3

## Permissions

| Permission | Reason |
|------------|--------|
| `activeTab` | Access the current tab when user clicks the extension |
| `scripting` | Inject the content extractor into the page |
| `clipboardWrite` | Copy Markdown to clipboard |
| `downloads` | Save `.md` files |
| `storage` | Persist Obsidian settings (API URL, API key, folder path) |

`optional_host_permissions` are requested at runtime per origin:
- HTTPS origins for list batch fetches (handles Medium redirects to publication domains)
- Localhost/127.0.0.1 for Obsidian HTTP APIs
- HTTPS origins for WordPress APIs

## License

MIT
