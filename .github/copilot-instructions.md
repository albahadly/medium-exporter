# Copilot Instructions for medium-exporter

## Project Summary
Chrome Extension (Manifest V3) for exporting Medium content to Markdown.

Primary workflows:
- Single article: copy markdown, download .md, send to Obsidian, send to WordPress
- List page batch: select article URLs, download selected as ZIP, send selected to WordPress, retry failed URLs

## Build and Validation
- Install: `npm install`
- Dev: `npm run dev`
- Build: `npm run build`
- Type check only: `npx tsc --noEmit`
- Bump extension version: `npm run version:bump`

Always run type checking after TypeScript edits.

## Versioning Rule
- After any implemented change intended to ship, run `npm run version:bump`.
- Do not edit versions manually in `package.json` or `manifest.json`.
- Use:
	- `npm run version:bump` or `npm run version:bump:patch` for patch releases
	- `npm run version:bump:minor` for minor releases
	- `npm run version:bump:major` for major releases

## Architecture
- `src/content/extractor.ts`: injected article extractor (must be self-contained)
- `src/content/list-extractor.ts`: injected list URL extractor (must be self-contained)
- `src/background/service-worker.ts`: message router, fetch/download, Obsidian and WordPress API calls
- `src/popup/popup.ts`: UI orchestrator, conversion options, batch queue, retry state
- `src/shared/article-parser.ts`: parser used for HTML fetched during batch mode
- `src/shared/converter.ts`: Turndown rules and markdown cleanup
- `src/shared/messages.ts`: typed popup/background protocol
- `src/shared/types.ts`: shared domain interfaces

## Critical Constraints
1. Extractor functions injected by `chrome.scripting.executeScript({ func })` must not rely on runtime imports, closures, or out-of-scope variables.
2. Keep popup and background message contracts aligned. Update both `messages.ts` and handlers when adding message fields.
3. Turndown must run in popup context (service worker has no DOM).
4. Keep service worker stateless. Pass settings in each integration request.
5. Preserve conservative content cleaning: prefer semantic selectors over brittle Medium class names.

## Batch Mode Notes
- Batch processing uses bounded concurrency and retry/backoff for HTML fetch failures.
- Track failed URLs and support retry-only runs.
- Cache parsed article results in-memory per popup session to avoid duplicate parsing work.
- Avoid unbounded loops or very high concurrency values.
- Batch fetches can follow Medium redirects to publication domains, so runtime HTTPS host permission is required.

## Integrations
### Obsidian
- Uses Local REST API plugin
- Default API URL: `http://127.0.0.1:27123`
- Endpoint permission requested at runtime

### WordPress
- Endpoint should be `/wp-json/wp/v2/posts`
- Uses Basic auth with username + Application Password
- In list mode, list title is used as category name; service worker resolves or creates category ID
- In list mode, WordPress publish requests are sent sequentially with a fixed 5-second delay between requests
- Require HTTPS for public hosts; allow HTTP for localhost/private-network hosts

## Permissions and Security
- Keep install-time permissions minimal.
- Runtime host access should be requested per origin when needed.
- Do not reintroduce broad non-optional host permissions.
- Validate user-entered integration URLs and fail with actionable errors.

## UI Expectations
- Popup supports two modes: article mode and list mode.
- List mode includes select-all/clear, selected-count display, progress, and retry failed button.
- Status messages must remain user-friendly and actionable.

## Documentation Sync Rule
When changing architecture, permissions, message flow, batch behavior, or integration behavior, update:
- `README.md`
- `CLAUDE.md`
- relevant docs in `docs/`

## Coding Style
- TypeScript strict mode
- Prefer explicit narrowings for message unions
- Keep functions small and focused
- Avoid unnecessary dependencies
