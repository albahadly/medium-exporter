import { htmlToMarkdown } from '../shared/converter';
import { buildFrontmatter } from '../shared/frontmatter';
import { parseArticleFromDoc } from '../shared/article-parser';
import JSZip from 'jszip';
import type { ArticleMetadata, ObsidianSettings, WordPressSettings } from '../shared/types';
import type { PopupMessage, BackgroundResponse } from '../shared/messages';

// DOM references
const titleEl = document.getElementById('article-title')!;
const urlEl = document.getElementById('article-url')!;
const articleInfoEl = document.getElementById('article-info')!;
const actionsEl = document.getElementById('actions')!;
const optionsEl = document.getElementById('options')!;
const obsidianSettingsEl = document.getElementById('obsidian-settings')!;

// List-mode DOM references
const listModeEl = document.getElementById('list-mode')!;
const listTitleEl = document.getElementById('list-title')!;
const listCountEl = document.getElementById('list-count')!;
const downloadAllBtn = document.getElementById('btn-download-all') as HTMLButtonElement;
const wordpressAllBtn = document.getElementById('btn-wordpress-all') as HTMLButtonElement;
const batchProgressEl = document.getElementById('batch-progress')!;
const progressFillEl = document.getElementById('progress-fill') as HTMLElement;
const progressLabelEl = document.getElementById('progress-label')!;
const frontmatterToggle = document.getElementById(
  'toggle-frontmatter'
) as HTMLInputElement;
const imagesToggle = document.getElementById(
  'toggle-images'
) as HTMLInputElement;
const copyBtn = document.getElementById('btn-copy') as HTMLButtonElement;
const downloadBtn = document.getElementById('btn-download') as HTMLButtonElement;
const obsidianBtn = document.getElementById('btn-obsidian') as HTMLButtonElement;
const wordpressBtn = document.getElementById('btn-wordpress') as HTMLButtonElement;
const statusEl = document.getElementById('status-message')!;
const versionEl = document.getElementById('version')!;

// Obsidian settings DOM
const toggleSettingsBtn = document.getElementById(
  'btn-toggle-settings'
) as HTMLButtonElement;
const settingsPanel = document.getElementById('settings-panel')!;
const apiUrlInput = document.getElementById('setting-api-url') as HTMLInputElement;
const apiKeyInput = document.getElementById('setting-api-key') as HTMLInputElement;
const folderInput = document.getElementById('setting-folder') as HTMLInputElement;
const saveSettingsBtn = document.getElementById(
  'btn-save-settings'
) as HTMLButtonElement;
const testConnectionBtn = document.getElementById(
  'btn-test-connection'
) as HTMLButtonElement;

// WordPress settings DOM
const toggleWpSettingsBtn = document.getElementById(
  'btn-toggle-wp-settings'
) as HTMLButtonElement;
const wpSettingsPanel = document.getElementById('wp-settings-panel')!;
const wpEndpointInput = document.getElementById('wp-setting-endpoint') as HTMLInputElement;
const wpUsernameInput = document.getElementById('wp-setting-username') as HTMLInputElement;
const wpPasswordInput = document.getElementById('wp-setting-password') as HTMLInputElement;
const saveWpSettingsBtn = document.getElementById(
  'btn-wp-save-settings'
) as HTMLButtonElement;

// Display version from manifest
versionEl.textContent = `v${chrome.runtime.getManifest().version}`;

// State
let currentMarkdown = '';
let currentFilename = '';
let currentMetadata: ArticleMetadata | null = null;
let currentArticleHtml = '';
let obsidianSettings: ObsidianSettings | null = null;
let wordpressSettings: WordPressSettings | null = null;

// Initialization
async function init(): Promise<void> {
  setStatus('Loading...', 'info');

  await loadSettings();

  // Check current tab URL to decide article vs list mode
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const tabUrl = tab?.url || '';

  if (isListPageUrl(tabUrl)) {
    await initListMode();
  } else {
    await initArticleMode();
  }
}

function isListPageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.hostname !== 'medium.com' && !u.hostname.endsWith('.medium.com')) {
      return false;
    }
    return /\/list\//.test(u.pathname) || /\/@[^/]+\/lists/.test(u.pathname);
  } catch {
    return false;
  }
}

async function initArticleMode(): Promise<void> {
  // Reveal single-article sections
  articleInfoEl.classList.remove('hidden');
  actionsEl.classList.remove('hidden');
  optionsEl.classList.remove('hidden');
  obsidianSettingsEl.classList.remove('hidden');

  setStatus('Extracting article...', 'info');

  const response = await sendMessage({ type: 'EXTRACT' });

  if (response.type === 'ERROR') {
    setStatus(response.error, 'error');
    return;
  }

  if (response.type === 'EXTRACT_SUCCESS') {
    currentMetadata = response.metadata;
    currentArticleHtml = response.articleHtml;

    titleEl.textContent = currentMetadata.title || 'Untitled';
    urlEl.textContent = currentMetadata.canonicalUrl || '';
    urlEl.title = currentMetadata.canonicalUrl || '';

    buildMarkdown();
    copyBtn.disabled = false;
    downloadBtn.disabled = false;
    obsidianBtn.disabled = false;
    wordpressBtn.disabled = false;
    setStatus('Ready.', 'success');
  }
}

async function initListMode(): Promise<void> {
  // Swap visible sections
  articleInfoEl.classList.add('hidden');
  actionsEl.classList.add('hidden');
  optionsEl.classList.add('hidden');
  obsidianSettingsEl.classList.add('hidden');
  listModeEl.classList.remove('hidden');

  setStatus('Finding articles in list...', 'info');

  const response = await sendMessage({ type: 'EXTRACT_LIST' });

  if (response.type === 'ERROR') {
    setStatus(response.error, 'error');
    return;
  }

  if (response.type === 'EXTRACT_LIST_SUCCESS') {
    const { articleUrls, listTitle } = response;
    listTitleEl.textContent = listTitle;
    listCountEl.textContent = `${articleUrls.length} article${articleUrls.length === 1 ? '' : 's'} found`;
    downloadAllBtn.disabled = false;
    wordpressAllBtn.disabled = false;
    setStatus('Ready.', 'success');

    downloadAllBtn.addEventListener('click', async () => {
      // Must request permission in direct response to user gesture
      const hasPermission = await chrome.permissions.contains({
        origins: ['https://medium.com/*', 'https://*.medium.com/*'],
      });
      if (!hasPermission) {
        const granted = await chrome.permissions.request({
          origins: ['https://medium.com/*', 'https://*.medium.com/*'],
        });
        if (!granted) {
          setStatus('Permission required to fetch articles.', 'error');
          return;
        }
      }
      await downloadAllArticles(articleUrls);
    });

    wordpressAllBtn.addEventListener('click', async () => {
      if (!wordpressSettings?.username || !wordpressSettings?.password) {
        setStatus('Configure WordPress settings first.', 'error');
        wpSettingsPanel.classList.remove('hidden');
        return;
      }

      const endpointUrl = wordpressSettings.endpointUrl || 'http://192.168.68.92:9879/wp-json/wp/v2/posts';

      // Request Medium fetch permission
      const hasPermission = await chrome.permissions.contains({
        origins: ['https://medium.com/*', 'https://*.medium.com/*'],
      });
      if (!hasPermission) {
        const granted = await chrome.permissions.request({
          origins: ['https://medium.com/*', 'https://*.medium.com/*'],
        });
        if (!granted) {
          setStatus('Permission required to fetch articles.', 'error');
          return;
        }
      }

      const wpGranted = await ensureHostPermission(endpointUrl);
      if (!wpGranted) {
        setStatus('Permission denied for WordPress API URL.', 'error');
        return;
      }

      await sendAllToWordPress(articleUrls, { ...wordpressSettings, endpointUrl });
    });
  }
}

async function downloadAllArticles(urls: string[]): Promise<void> {
  downloadAllBtn.disabled = true;
  batchProgressEl.classList.remove('hidden');
  updateProgress(0, urls.length);

  const options = {
    includeFrontmatter: frontmatterToggle.checked,
    includeImages: imagesToggle.checked,
  };

  const zip = new JSZip();
  let done = 0;
  let failed = 0;

  for (const url of urls) {
    setStatus(`Fetching ${done + 1} of ${urls.length}\u2026`, 'info');

    const fetchResp = await sendMessage({ type: 'FETCH_ARTICLE_HTML', url });

    if (fetchResp.type !== 'FETCH_HTML_SUCCESS') {
      failed++;
      done++;
      updateProgress(done, urls.length);
      continue;
    }

    const doc = new DOMParser().parseFromString(fetchResp.html, 'text/html');
    const parsed = parseArticleFromDoc(doc, url);

    if (!parsed.success) {
      failed++;
      done++;
      updateProgress(done, urls.length);
      continue;
    }

    const body = htmlToMarkdown(parsed.articleHtml, options);
    let md = options.includeFrontmatter
      ? buildFrontmatter(parsed.metadata) + '\n'
      : '';
    md += `# ${parsed.metadata.title}\n\n${body}`;
    md = md.replace(/^\n+/, '');

    const filename = generateFilename(parsed.metadata);
    zip.file(filename, md);

    done++;
    updateProgress(done, urls.length);

    // Brief pause to avoid hammering the server
    await new Promise<void>((r) => setTimeout(r, 400));
  }

  setStatus('Building ZIP\u2026', 'info');

  const zipBlob = await zip.generateAsync({ type: 'base64' });
  const listTitle = listTitleEl.textContent?.trim() || 'medium-list';
  const zipFilename = listTitle.replace(/[<>:"/\\|?*]/g, '').trim() + '.zip';

  const response = await sendMessage({
    type: 'DOWNLOAD_FILE',
    content: zipBlob,
    filename: zipFilename,
    mimeType: 'application/zip',
    contentIsBase64: true,
    saveAs: true,
  });

  const successCount = done - failed;
  const msg =
    failed > 0
      ? `ZIP saved — ${successCount} of ${urls.length} articles (${failed} failed).`
      : `ZIP saved — ${done} articles.`;
  setStatus(
    response.type === 'DOWNLOAD_SUCCESS' ? msg : (response as { error: string }).error,
    response.type === 'DOWNLOAD_SUCCESS' && failed === 0 ? 'success' : 'info'
  );
  downloadAllBtn.disabled = false;
}

async function sendAllToWordPress(urls: string[], settings: WordPressSettings): Promise<void> {
  wordpressAllBtn.disabled = true;
  batchProgressEl.classList.remove('hidden');
  updateProgress(0, urls.length);

  let done = 0;
  let failed = 0;

  for (const url of urls) {
    setStatus(`Sending ${done + 1} of ${urls.length} to WordPress\u2026`, 'info');

    const fetchResp = await sendMessage({ type: 'FETCH_ARTICLE_HTML', url });

    if (fetchResp.type !== 'FETCH_HTML_SUCCESS') {
      failed++;
      done++;
      updateProgress(done, urls.length);
      continue;
    }

    const doc = new DOMParser().parseFromString(fetchResp.html, 'text/html');
    const parsed = parseArticleFromDoc(doc, url);

    if (!parsed.success) {
      failed++;
      done++;
      updateProgress(done, urls.length);
      continue;
    }

    const wpResp = await sendMessage({
      type: 'SEND_TO_WORDPRESS',
      title: parsed.metadata.title || 'Untitled',
      content: parsed.articleHtml,
      settings,
    });

    if (wpResp.type !== 'WORDPRESS_SUCCESS') {
      failed++;
    }

    done++;
    updateProgress(done, urls.length);

    // Brief pause to avoid hammering the server
    await new Promise<void>((r) => setTimeout(r, 400));
  }

  const successCount = done - failed;
  const msg =
    failed > 0
      ? `Sent ${successCount} of ${urls.length} articles to WordPress (${failed} failed).`
      : `Sent ${done} articles to WordPress!`;
  setStatus(msg, failed === 0 ? 'success' : 'info');
  wordpressAllBtn.disabled = false;
}

function updateProgress(done: number, total: number): void {
  const pct = total > 0 ? (done / total) * 100 : 0;
  progressFillEl.style.width = `${pct}%`;
  progressLabelEl.textContent = `${done} / ${total}`;
}

function buildMarkdown(): void {
  if (!currentMetadata || !currentArticleHtml) return;

  const options = {
    includeFrontmatter: frontmatterToggle.checked,
    includeImages: imagesToggle.checked,
  };

  const body = htmlToMarkdown(currentArticleHtml, options);

  let md = '';
  if (options.includeFrontmatter) {
    md += buildFrontmatter(currentMetadata) + '\n';
  }
  md += `# ${currentMetadata.title}\n\n`;
  md += body;

  // Remove any leading blank lines from the final output
  currentMarkdown = md.replace(/^\n+/, '');
  currentFilename = generateFilename(currentMetadata);
}

function generateFilename(meta: ArticleMetadata): string {
  const title = meta.title
    .replace(/[<>:"/\\|?*]/g, '')
    .trim();
  return `${title || 'Untitled'}.md`;
}

// Obsidian settings

async function loadSettings(): Promise<void> {
  const result = await chrome.storage.local.get(['obsidianSettings', 'wordpressSettings']);
  if (result.obsidianSettings) {
    obsidianSettings = result.obsidianSettings as ObsidianSettings;
    apiUrlInput.value = obsidianSettings.apiUrl;
    apiKeyInput.value = obsidianSettings.apiKey;
    folderInput.value = obsidianSettings.folderPath;
  }
  if (result.wordpressSettings) {
    wordpressSettings = result.wordpressSettings as WordPressSettings;
    wpEndpointInput.value = wordpressSettings.endpointUrl;
    wpUsernameInput.value = wordpressSettings.username;
    wpPasswordInput.value = wordpressSettings.password;
  }
}

async function saveSettings(): Promise<void> {
  let folderPath = folderInput.value.trim();
  if (folderPath && !folderPath.endsWith('/')) {
    folderPath += '/';
  }

  obsidianSettings = {
    apiUrl: apiUrlInput.value.trim() || 'http://127.0.0.1:27123',
    apiKey: apiKeyInput.value.trim(),
    folderPath,
  };

  await chrome.storage.local.set({ obsidianSettings });
  setStatus('Obsidian settings saved.', 'success');
}

async function saveWpSettings(): Promise<void> {
  wordpressSettings = {
    endpointUrl: wpEndpointInput.value.trim() || 'http://192.168.68.92:9879/wp-json/wp/v2/posts',
    username: wpUsernameInput.value.trim(),
    password: wpPasswordInput.value.trim(),
  };

  await chrome.storage.local.set({ wordpressSettings });
  setStatus('WordPress settings saved.', 'success');
}

async function ensureHostPermission(apiUrl: string): Promise<boolean> {
  const origin = new URL(apiUrl).origin + '/*';
  const hasPermission = await chrome.permissions.contains({
    origins: [origin],
  });
  if (hasPermission) return true;

  return chrome.permissions.request({ origins: [origin] });
}

async function testConnection(): Promise<void> {
  if (!obsidianSettings?.apiKey) {
    setStatus('Enter an API key and save first.', 'error');
    return;
  }

  const apiUrl = obsidianSettings.apiUrl || 'http://127.0.0.1:27123';

  const granted = await ensureHostPermission(apiUrl);
  if (!granted) {
    setStatus('Permission denied for Obsidian API URL.', 'error');
    return;
  }

  setStatus('Testing connection...', 'info');

  try {
    const response = await fetch(new URL('/', apiUrl).href, {
      method: 'GET',
      headers: { Authorization: `Bearer ${obsidianSettings.apiKey}` },
      mode: 'cors',
    });

    if (!response.ok) {
      setStatus(`Connection failed (${response.status}).`, 'error');
      return;
    }

    const data = await response.json();
    if (data.authenticated) {
      setStatus('Connection successful!', 'success');
    } else {
      setStatus('Connected but not authenticated. Check API key.', 'error');
    }
  } catch {
    setStatus(
      'Could not connect. Is Obsidian running with Local REST API enabled?',
      'error'
    );
  }
}

// Event handlers
frontmatterToggle.addEventListener('change', () => buildMarkdown());
imagesToggle.addEventListener('change', () => buildMarkdown());

toggleSettingsBtn.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

toggleWpSettingsBtn.addEventListener('click', () => {
  wpSettingsPanel.classList.toggle('hidden');
});

saveSettingsBtn.addEventListener('click', () => saveSettings());
testConnectionBtn.addEventListener('click', () => testConnection());
saveWpSettingsBtn.addEventListener('click', () => saveWpSettings());

copyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(currentMarkdown);
    setStatus('Copied to clipboard!', 'success');
  } catch {
    setStatus('Clipboard write failed.', 'error');
  }
});

downloadBtn.addEventListener('click', async () => {
  setStatus('Starting download...', 'info');
  const response = await sendMessage({
    type: 'DOWNLOAD_FILE',
    content: currentMarkdown,
    filename: currentFilename,
  });

  if (response.type === 'DOWNLOAD_SUCCESS') {
    setStatus('Download started.', 'success');
  } else if (response.type === 'ERROR') {
    setStatus(response.error, 'error');
  }
});

obsidianBtn.addEventListener('click', async () => {
  if (!obsidianSettings?.apiKey) {
    setStatus('Configure Obsidian settings first.', 'error');
    settingsPanel.classList.remove('hidden');
    return;
  }

  const apiUrl = obsidianSettings.apiUrl || 'http://127.0.0.1:27123';

  const granted = await ensureHostPermission(apiUrl);
  if (!granted) {
    setStatus('Permission denied for Obsidian API URL.', 'error');
    return;
  }

  setStatus('Sending to Obsidian...', 'info');

  const filename = obsidianSettings.folderPath
    ? obsidianSettings.folderPath + currentFilename
    : currentFilename;

  const response = await sendMessage({
    type: 'SEND_TO_OBSIDIAN',
    markdown: currentMarkdown,
    filename,
    settings: { ...obsidianSettings, apiUrl },
  });

  if (response.type === 'OBSIDIAN_SUCCESS') {
    setStatus('Sent to Obsidian!', 'success');
  } else if (response.type === 'ERROR') {
    setStatus(response.error, 'error');
  }
});

wordpressBtn.addEventListener('click', async () => {
  if (!wordpressSettings?.username || !wordpressSettings?.password) {
    setStatus('Configure WordPress settings first.', 'error');
    wpSettingsPanel.classList.remove('hidden');
    return;
  }

  const endpointUrl = wordpressSettings.endpointUrl || 'http://192.168.68.92:9879/wp-json/wp/v2/posts';

  const granted = await ensureHostPermission(endpointUrl);
  if (!granted) {
    setStatus('Permission denied for WordPress API URL.', 'error');
    return;
  }

  setStatus('Sending to WordPress...', 'info');

  const response = await sendMessage({
    type: 'SEND_TO_WORDPRESS',
    title: currentMetadata?.title ?? 'Untitled',
    content: currentArticleHtml,
    settings: { ...wordpressSettings, endpointUrl },
  });

  if (response.type === 'WORDPRESS_SUCCESS') {
    setStatus('Sent to WordPress as draft!', 'success');
  } else if (response.type === 'ERROR') {
    setStatus(response.error, 'error');
  }
});

// Helpers
function sendMessage(msg: PopupMessage): Promise<BackgroundResponse> {
  return chrome.runtime.sendMessage(msg);
}

function setStatus(
  text: string,
  level: 'info' | 'success' | 'error'
): void {
  statusEl.textContent = text;
  statusEl.className = level;
}

// Start
init();
