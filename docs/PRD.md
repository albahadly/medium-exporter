# 1. Product Overview

## 1.1 Product Name
Medium to Markdown Exporter (Chrome Extension)

## 1.2 Purpose
Enable users to export Medium articles into **Markdown format** and:
- Copy the Markdown to the clipboard
- Download single files or list batches
- Optionally send content directly to Obsidian or WordPress

The product removes dependency on paid third-party services while keeping processing local to the extension, except explicit user-targeted sends (Obsidian/WordPress).

---

# 2. Goals and Non-Goals

## 2.1 Goals
1. Convert Medium articles into clean, Obsidian-compatible Markdown
2. Support one-click clipboard export
3. Support optional `.md` file download
4. Support list-page batch export with selective processing
5. Support direct send to Obsidian and WordPress

## 2.2 Non-Goals (MVP)
1. Image downloading or local attachment management
2. Medium paywall circumvention
3. Multi-platform support (Medium only)
4. Sync, tagging automation, or highlights management

---

# 3. Target Users

1. Obsidian users maintaining a personal knowledge base
2. Developers, researchers, and writers archiving Medium articles
3. Users seeking a no-subscription alternative to Readwise

---

# 4. User Flow

1. User opens a Medium article page
2. User clicks the Chrome extension icon
3. Extension popup opens and detects article content
4. User selects export options
5. User clicks **Copy as Markdown**
6. Markdown content is copied to the clipboard
7. (Optional) User clicks **Download .md**
8. (Optional) User sends directly to Obsidian or WordPress

List mode flow:
1. User opens a Medium list page
2. Extension finds list article URLs
3. User selects which articles to process
4. User clicks **Download Selected as ZIP** or **Send Selected to WordPress**
5. Failed items can be retried using **Retry Failed**

---

# 5. Functional Requirements

## 5.1 Page Detection
The extension shall detect a Medium article page by:
1. Presence of an `<article>` element
2. Or `meta[property="og:site_name"]` equal to `"Medium"`

If detection fails, the extension shall notify the user.

---

## 5.2 Content Extraction

### 5.2.1 Primary Extraction Target
- The `<article>` DOM element

### 5.2.2 Included Content
- Article title
- Paragraphs
- Headings (`h1–h6`)
- Ordered and unordered lists
- Blockquotes
- Code blocks
- Images and captions
- Horizontal rules

### 5.2.3 Excluded Content
- Clap, share, and follow UI elements
- Subscription and sign-up prompts
- Recommended articles
- Comments and responses
- Navigation and footer elements

---

## 5.3 Metadata Extraction

The extension shall extract the following metadata when available:
1. Title
2. Author
3. Canonical URL
4. Published date
5. Retrieved date (current timestamp)

### 5.3.1 Metadata Source Priority
1. JSON-LD (`application/ld+json`)
2. Meta tags (`og:title`, `article:published_time`)
3. DOM fallback parsing

---

## 5.4 Markdown Conversion

The extension shall convert extracted HTML into Markdown using the following rules:

| HTML Element | Markdown Output |
|-------------|-----------------|
| `h1–h6` | `#` to `######` |
| `p` | Plain text |
| `a` | `[text](url)` |
| `img` | `![](image_url)` |
| `blockquote` | `>` |
| `ul`, `ol` | `-`, `1.` |
| `pre > code` | Fenced code blocks using triple backticks |

Markdown output must be compatible with Obsidian’s Markdown renderer.

---

## 5.5 Frontmatter Generation

The extension shall optionally include YAML frontmatter when enabled by the user.

~~~yaml
---
title: "Article Title"
author: "Author Name"
source: "https://medium.com/..."
published: "YYYY-MM-DD"
retrieved: "YYYY-MM-DD"
---
~~~

Frontmatter inclusion shall be controlled via a popup toggle.

---

## 5.6 Clipboard Export

1. The extension shall copy the generated Markdown to the clipboard.
2. Clipboard access shall use standard browser APIs.
3. If clipboard writing fails, the extension shall notify the user.

---

## 5.7 File Download (Optional)

1. The extension shall allow the user to download the Markdown as a `.md` file.
2. Default filename format:
~~~code
   YYYY-MM-DD - article-title.md
~~~
3. Encoding shall be UTF-8.
4. Image references shall remain as remote URLs.

---

# 6. Popup UI Requirements

## 6.1 UI Components
1. Article title display (read-only)
2. Source URL display (read-only)
3. Option toggles:
- Include frontmatter
- Include images
4. Action buttons:
- Copy as Markdown
- Download .md
 - Send to Obsidian
 - Send to WordPress
5. List mode components:
- Select-all / clear controls
- Article checkbox list
- Batch progress + retry failed button

## 6.2 UX Constraints
1. No page reload required
2. All actions are initiated from the popup
3. Background service worker handles network and file operations

---

# 7. Technical Requirements

## 7.1 Architecture
- Chrome Extension using Manifest V3
- Components:
1. Content script (DOM extraction)
2. Background / service worker (clipboard and download handling)
3. Popup UI (user interaction)

## 7.2 Permissions
- `activeTab`
- `scripting`
- `clipboardWrite`
- `downloads` (only when file export is enabled)
- `storage`
- `optional_host_permissions` (requested at runtime for Medium batch fetches, Obsidian, and WordPress endpoints)

## 7.3 Dependencies
- Bundled HTML-to-Markdown conversion library
- No runtime external dependencies

---

# 8. Privacy and Security

1. No data persistence
2. No telemetry, analytics, or tracking
3. Extraction and conversion occur locally in the browser
4. Network calls occur only for user-triggered Obsidian/WordPress sends and Medium list fetches

---

# 9. Error Handling

1. Non-Medium page detected → user notification
2. Article extraction failure → user notification
3. Clipboard operation failure → user notification

---

# 10. Success Criteria

1. Markdown output requires no manual cleanup for Obsidian
2. Core content structure is preserved
3. Works on the majority of publicly accessible Medium articles
4. Clipboard export succeeds consistently across supported browsers

---

# 11. Future Scope (Out of MVP)

1. Local image downloading and attachment management
2. Medium highlight extraction
3. Support for additional platforms
4. Draft scheduling and richer WordPress post options
5. Export profiles for different Markdown targets

---

# 12. Open Questions

1. Handling of Medium-specific highlight markup
2. Reliable fallback strategy when `<article>` is missing
3. Language detection for code blocks