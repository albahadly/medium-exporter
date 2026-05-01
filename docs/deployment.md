# Deployment Guide

## Build for Production

```bash
npm run build
```

This produces an optimized `dist/` directory with all extension files.

## Load as Unpacked Extension (Development)

1. Open `chrome://extensions/`
2. Enable **Developer mode** (toggle in top right)
3. Click **Load unpacked**
4. Select the `dist/` directory
5. The extension icon appears in the toolbar

## Chrome Web Store Submission

1. Run `npm run build`
2. Zip the contents of `dist/`:
   ```bash
   cd dist && zip -r ../medium-exporter.zip . && cd ..
   ```
3. Go to the [Chrome Developer Dashboard](https://chrome.google.com/webstore/devconsole)
4. Click **New Item** → upload `medium-exporter.zip`
5. Fill in listing details (description, screenshots, category)
6. Submit for review

## Verification Checklist

- [ ] Extension loads without errors in `chrome://extensions/`
- [ ] Popup opens when clicking the extension icon
- [ ] Article title and URL display on a Medium page
- [ ] "Copy as Markdown" produces valid Markdown
- [ ] "Download .md" saves a file with correct filename format
- [ ] "Send to Obsidian" delivers note to vault
- [ ] WordPress settings save and single-article publish works
- [ ] List page mode finds article URLs and supports item selection
- [ ] "Download Selected as ZIP" creates ZIP with selected articles
- [ ] "Retry Failed" appears only after partial batch failures
- [ ] Batch WordPress publish assigns/resolves category from list title
- [ ] Frontmatter toggle works (on/off)
- [ ] Images toggle works (on/off)
- [ ] Code blocks with backticks render correctly
- [ ] Obsidian settings save and persist across popup reopens
- [ ] Test connection shows success with valid API key
- [ ] Non-Medium pages show an error message
- [ ] No console errors in the popup or service worker
