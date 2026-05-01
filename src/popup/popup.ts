import { htmlToMarkdown } from '../shared/converter';
import { buildFrontmatter } from '../shared/frontmatter';
import { parseArticleFromDoc } from '../shared/article-parser';
import JSZip from 'jszip';
import type { ArticleMetadata, ObsidianSettings, WordPressSettings } from '../shared/types';
import type { PopupMessage, BackgroundResponse } from '../shared/messages';

const DEFAULT_OBSIDIAN_API_URL = 'http://127.0.0.1:27123';
const BATCH_FETCH_ORIGINS = ['https://*/*'];
const DOWNLOAD_CONCURRENCY = 1;
const WORDPRESS_CONCURRENCY = 1;
const FETCH_RETRY_COUNT = 2;
const RETRY_BACKOFF_MS = 250;
const IGNORED_ARTICLE_ERROR = 'Ignored article title: Medium Rules.';
const MIN_BATCH_DELAY_MS = 2000;
const MAX_BATCH_DELAY_MS = 5000;

type BatchMode = 'download' | 'wordpress' | null;

interface ParsedBatchArticle {
  url: string;
  metadata: ArticleMetadata;
  articleHtml: string;
}

interface BatchFailure {
  url: string;
  reason: string;
}

interface BatchSuccess<T> {
  success: true;
  url: string;
  value: T;
}

interface BatchIgnored {
  success: false;
  ignored: true;
  url: string;
  reason: string;
}

interface BatchError {
  success: false;
  ignored?: false;
  url: string;
  reason: string;
}

type BatchResult<T> = BatchSuccess<T> | BatchIgnored | BatchError;

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
const listSelectionEl = document.getElementById('list-selection')!;
const listItemsEl = document.getElementById('list-items')!;
const selectAllBtn = document.getElementById('btn-select-all') as HTMLButtonElement;
const clearSelectionBtn = document.getElementById(
  'btn-clear-selection'
) as HTMLButtonElement;
const downloadAllBtn = document.getElementById('btn-download-all') as HTMLButtonElement;
const wordpressAllBtn = document.getElementById('btn-wordpress-all') as HTMLButtonElement;
const retryFailedBtn = document.getElementById('btn-retry-failed') as HTMLButtonElement;
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
let listArticleUrls: string[] = [];
let selectedArticleUrls = new Set<string>();
let failedBatchUrls: string[] = [];
let lastBatchMode: BatchMode = null;
let isBatchRunning = false;
const parsedArticleCache = new Map<string, ParsedBatchArticle>();

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
    if (isIgnoredArticleReason(response.error)) {
      setStatus('Ignored article: Medium Rules.', 'info');
      return;
    }
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

    listArticleUrls = articleUrls;
    selectedArticleUrls = new Set(articleUrls);
    failedBatchUrls = [];
    lastBatchMode = null;

    listTitleEl.textContent = listTitle;
    renderListSelection();
    listSelectionEl.classList.remove('hidden');
    refreshListActions();
    setStatus('Ready.', 'success');
  }
}

function renderListSelection(): void {
  listItemsEl.textContent = '';

  const fragment = document.createDocumentFragment();
  for (const url of listArticleUrls) {
    const row = document.createElement('label');
    row.className = 'list-item';
    row.setAttribute('data-url', url);

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = selectedArticleUrls.has(url);
    checkbox.setAttribute('data-url', url);
    checkbox.addEventListener('change', () => {
      if (checkbox.checked) {
        selectedArticleUrls.add(url);
      } else {
        selectedArticleUrls.delete(url);
      }
      refreshListActions();
    });

    const label = document.createElement('span');
    label.textContent = formatArticleLabel(url);
    label.title = url;

    row.append(checkbox, label);
    fragment.appendChild(row);
  }

  listItemsEl.appendChild(fragment);
  syncFailedRows();
  refreshListActions();
}

function formatArticleLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const segment = parsed.pathname.split('/').filter(Boolean).pop() || parsed.hostname;
    return decodeURIComponent(segment)
      .replace(/-[a-f0-9]{6,}$/i, '')
      .replace(/-/g, ' ')
      .trim();
  } catch {
    return url;
  }
}

function refreshListActions(): void {
  const selectedCount = getSelectedUrls().length;
  listCountEl.textContent = `${selectedCount} selected of ${listArticleUrls.length}`;
  downloadAllBtn.disabled = isBatchRunning || selectedCount === 0;
  wordpressAllBtn.disabled = isBatchRunning || selectedCount === 0;
  retryFailedBtn.classList.toggle('hidden', failedBatchUrls.length === 0);
  retryFailedBtn.disabled = isBatchRunning || failedBatchUrls.length === 0;
  if (failedBatchUrls.length > 0) {
    retryFailedBtn.textContent = `Retry Failed (${failedBatchUrls.length})`;
  } else {
    retryFailedBtn.textContent = 'Retry Failed';
  }
}

function getSelectedUrls(): string[] {
  return listArticleUrls.filter((url) => selectedArticleUrls.has(url));
}

function setAllSelections(isSelected: boolean): void {
  selectedArticleUrls = isSelected
    ? new Set(listArticleUrls)
    : new Set<string>();

  listItemsEl
    .querySelectorAll<HTMLInputElement>('input[type="checkbox"][data-url]')
    .forEach((checkbox) => {
      checkbox.checked = isSelected;
    });

  refreshListActions();
}

function setBatchRunning(running: boolean): void {
  isBatchRunning = running;
  refreshListActions();
}

function setBatchFailures(failures: BatchFailure[]): void {
  failedBatchUrls = failures.map((failure) => failure.url);
  syncFailedRows();
  refreshListActions();
}

function syncFailedRows(): void {
  const failed = new Set(failedBatchUrls);
  listItemsEl
    .querySelectorAll<HTMLElement>('.list-item[data-url]')
    .forEach((row) => {
      const url = row.getAttribute('data-url') || '';
      row.classList.toggle('failed', failed.has(url));
    });
}

async function handleDownloadSelected(): Promise<void> {
  const urls = getSelectedUrls();
  if (urls.length === 0) {
    setStatus('Select at least one article first.', 'error');
    return;
  }

  const hasPermission = await ensureBatchFetchPermission();
  if (!hasPermission) {
    setStatus(
      'Permission required to fetch Medium and publication domains.',
      'error'
    );
    return;
  }

  lastBatchMode = 'download';
  await downloadSelectedArticles(urls);
}

async function downloadSelectedArticles(urls: string[]): Promise<void> {
  setBatchRunning(true);
  batchProgressEl.classList.remove('hidden');
  updateProgress(0, urls.length);

  const options = {
    includeFrontmatter: frontmatterToggle.checked,
    includeImages: imagesToggle.checked,
  };

  setStatus(`Preparing ${urls.length} article(s) for ZIP...`, 'info');

  const results = await processWithConcurrency(
    urls,
    DOWNLOAD_CONCURRENCY,
    (url) => prepareDownloadItem(url, options),
    (done, total) => {
      updateProgress(done, total);
      setStatus(`Processed ${done} of ${total} article(s)...`, 'info');
    }
  );

  const failures = collectFailures(results);
  const ignored = collectIgnored(results);
  setBatchFailures(failures);

  const successful = results.filter(
    (result): result is BatchSuccess<{ filename: string; markdown: string }> => result.success
  );

  if (successful.length === 0) {
    if (ignored.length > 0 && failures.length === 0) {
      setStatus(
        `No files exported. ${ignored.length} article(s) were ignored by title filter.`,
        'info'
      );
    } else {
      setStatus('No files were exported. All selected articles failed.', 'error');
    }
    setBatchRunning(false);
    return;
  }

  const zip = new JSZip();
  const filenameUsage = new Map<string, number>();
  for (const item of successful) {
    const uniqueFilename = getUniqueFilename(item.value.filename, filenameUsage);
    zip.file(uniqueFilename, item.value.markdown);
  }

  setStatus('Building ZIP...', 'info');

  const zipBlob = await zip.generateAsync({ type: 'base64' });
  const listTitle = listTitleEl.textContent?.trim() || 'medium-list';
  const zipFilename = sanitizeFilename(listTitle || 'medium-list') + '.zip';

  const response = await sendMessage({
    type: 'DOWNLOAD_FILE',
    content: zipBlob,
    filename: zipFilename,
    mimeType: 'application/zip',
    contentIsBase64: true,
    saveAs: true,
  });

  if (response.type === 'DOWNLOAD_SUCCESS') {
    let message = `ZIP saved with ${successful.length} article(s).`;
    if (ignored.length > 0) {
      message += ` ${ignored.length} ignored by title filter.`;
    }
    if (failures.length > 0) {
      message += ` ${failures.length} failed.`;
    }
    setStatus(message, failures.length === 0 ? 'success' : 'info');
  } else if (response.type === 'ERROR') {
    setStatus(response.error, 'error');
  } else {
    setStatus(`Unexpected response: ${response.type}`, 'error');
  }

  setBatchRunning(false);
}

async function handleWordPressSelected(): Promise<void> {
  const urls = getSelectedUrls();
  if (urls.length === 0) {
    setStatus('Select at least one article first.', 'error');
    return;
  }

  const settings = getValidatedWordPressSettings();
  if (!settings) {
    return;
  }

  const hasMediumPermission = await ensureBatchFetchPermission();
  if (!hasMediumPermission) {
    setStatus(
      'Permission required to fetch Medium and publication domains.',
      'error'
    );
    return;
  }

  const wpPermission = await ensureHostPermission(settings.endpointUrl);
  if (!wpPermission) {
    setStatus('Permission denied for WordPress API URL.', 'error');
    return;
  }

  lastBatchMode = 'wordpress';
  await sendSelectedToWordPress(urls, settings);
}

async function sendSelectedToWordPress(
  urls: string[],
  settings: WordPressSettings
): Promise<void> {
  setBatchRunning(true);
  batchProgressEl.classList.remove('hidden');
  updateProgress(0, urls.length);

  const category = listTitleEl.textContent?.trim() || undefined;
  setStatus(`Publishing ${urls.length} article(s) to WordPress...`, 'info');

  const results = await processWithConcurrency(
    urls,
    WORDPRESS_CONCURRENCY,
    (url) => publishArticleToWordPress(url, settings, category),
    (done, total) => {
      updateProgress(done, total);
      setStatus(`Published ${done} of ${total} article(s)...`, 'info');
    }
  );

  const failures = collectFailures(results);
  const ignored = collectIgnored(results);
  setBatchFailures(failures);
  const successfulCount = results.filter((result) => result.success).length;

  let message =
    failures.length > 0
      ? `Published ${successfulCount} article(s). ${failures.length} failed.`
      : `Published ${successfulCount} article(s) to WordPress.`;
  if (ignored.length > 0) {
    message += ` ${ignored.length} ignored by title filter.`;
  }
  setStatus(message, failures.length === 0 ? 'success' : 'info');

  setBatchRunning(false);
}

async function publishArticleToWordPress(
  url: string,
  settings: WordPressSettings,
  category?: string
): Promise<BatchResult<string>> {
  const parsed = await fetchAndParseArticle(url);
  if (!parsed.success) {
    return parsed;
  }

  const wpResp = await sendMessage({
    type: 'SEND_TO_WORDPRESS',
    title: parsed.value.metadata.title || 'Untitled',
    content: parsed.value.articleHtml,
    category,
    settings,
  });

  if (wpResp.type !== 'WORDPRESS_SUCCESS') {
    const reason =
      wpResp.type === 'ERROR'
        ? wpResp.error
        : `Unexpected response: ${wpResp.type}`;
    return {
      success: false,
      url,
      reason,
    };
  }

  return {
    success: true,
    url,
    value: wpResp.postUrl,
  };
}

function collectFailures<T>(results: Array<BatchResult<T>>): BatchFailure[] {
  return results
    .filter((result): result is BatchError => !result.success && result.ignored !== true)
    .map((result) => ({ url: result.url, reason: result.reason }));
}

function collectIgnored<T>(results: Array<BatchResult<T>>): BatchIgnored[] {
  return results.filter(
    (result): result is BatchIgnored => !result.success && result.ignored === true
  );
}

function isIgnoredArticleReason(reason: string): boolean {
  return reason.trim().toLowerCase() === IGNORED_ARTICLE_ERROR.toLowerCase();
}

async function prepareDownloadItem(
  url: string,
  options: { includeFrontmatter: boolean; includeImages: boolean }
): Promise<BatchResult<{ filename: string; markdown: string }>> {
  const parsed = await fetchAndParseArticle(url);
  if (!parsed.success) {
    return parsed;
  }

  const body = htmlToMarkdown(parsed.value.articleHtml, options);
  let markdown = options.includeFrontmatter
    ? buildFrontmatter(parsed.value.metadata) + '\n'
    : '';
  markdown += `# ${parsed.value.metadata.title}\n\n${body}`;
  markdown = markdown.replace(/^\n+/, '');

  return {
    success: true,
    url,
    value: {
      filename: generateFilename(parsed.value.metadata),
      markdown,
    },
  };
}

async function fetchAndParseArticle(
  url: string
): Promise<BatchResult<ParsedBatchArticle>> {
  const cached = parsedArticleCache.get(url);
  if (cached) {
    return {
      success: true,
      url,
      value: cached,
    };
  }

  let lastError = 'Unknown fetch error.';

  for (let attempt = 0; attempt <= FETCH_RETRY_COUNT; attempt++) {
    const fetchResp = await sendMessage({ type: 'FETCH_ARTICLE_HTML', url });

    if (fetchResp.type === 'FETCH_HTML_SUCCESS') {
      const doc = new DOMParser().parseFromString(fetchResp.html, 'text/html');
      const parsed = parseArticleFromDoc(doc, url);

      if (parsed.success) {
        const value: ParsedBatchArticle = {
          url,
          metadata: parsed.metadata,
          articleHtml: parsed.articleHtml,
        };
        parsedArticleCache.set(url, value);
        return {
          success: true,
          url,
          value,
        };
      }

      if (isIgnoredArticleReason(parsed.error)) {
        return {
          success: false,
          ignored: true,
          url,
          reason: parsed.error,
        };
      }

      lastError = parsed.error;
    } else if (fetchResp.type === 'ERROR') {
      lastError = fetchResp.error;
    } else {
      lastError = `Unexpected response: ${fetchResp.type}`;
    }

    if (attempt < FETCH_RETRY_COUNT) {
      await delay(RETRY_BACKOFF_MS * (attempt + 1));
    }
  }

  return {
    success: false,
    url,
    reason: lastError,
  };
}

async function processWithConcurrency<T>(
  urls: string[],
  concurrency: number,
  worker: (url: string) => Promise<BatchResult<T>>,
  onProgress: (done: number, total: number) => void
): Promise<Array<BatchResult<T>>> {
  const results: Array<BatchResult<T> | undefined> = new Array(urls.length);
  let nextIndex = 0;
  let completed = 0;
  const workerCount = Math.max(1, Math.min(concurrency, urls.length));
  const shouldDelayBetweenArticles = workerCount === 1;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= urls.length) {
        return;
      }

      const url = urls[currentIndex];
      results[currentIndex] = await worker(url);
      completed += 1;
      onProgress(completed, urls.length);

      if (shouldDelayBetweenArticles && nextIndex < urls.length) {
        await delay(getRandomBatchDelayMs());
      }
    }
  };

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));

  return results as Array<BatchResult<T>>;
}

function getRandomBatchDelayMs(): number {
  const range = MAX_BATCH_DELAY_MS - MIN_BATCH_DELAY_MS + 1;
  return MIN_BATCH_DELAY_MS + Math.floor(Math.random() * range);
}

function getUniqueFilename(filename: string, usage: Map<string, number>): string {
  const seen = usage.get(filename) || 0;
  usage.set(filename, seen + 1);
  if (seen === 0) {
    return filename;
  }

  const dotIndex = filename.lastIndexOf('.');
  const base = dotIndex >= 0 ? filename.slice(0, dotIndex) : filename;
  const extension = dotIndex >= 0 ? filename.slice(dotIndex) : '';
  return `${base} (${seen + 1})${extension}`;
}

async function ensureBatchFetchPermission(): Promise<boolean> {
  const hasPermission = await chrome.permissions.contains({
    origins: BATCH_FETCH_ORIGINS,
  });

  if (hasPermission) {
    return true;
  }

  return chrome.permissions.request({ origins: BATCH_FETCH_ORIGINS });
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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
  const title = sanitizeFilename(meta.title).trim();
  return `${title || 'Untitled'}.md`;
}

function sanitizeFilename(value: string): string {
  return value.replace(/[<>:"/\\|?*]/g, '').trim();
}

// Obsidian settings

async function loadSettings(): Promise<void> {
  const result = await chrome.storage.local.get(['obsidianSettings', 'wordpressSettings']);

  apiUrlInput.value = DEFAULT_OBSIDIAN_API_URL;
  wpEndpointInput.value = '';

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
  const endpoint = normalizeAndValidateEndpointUrl(
    apiUrlInput.value,
    'Obsidian',
    DEFAULT_OBSIDIAN_API_URL
  );
  if (!endpoint.ok) {
    setStatus(endpoint.error, 'error');
    return;
  }

  let folderPath = folderInput.value.trim();
  if (folderPath && !folderPath.endsWith('/')) {
    folderPath += '/';
  }

  obsidianSettings = {
    apiUrl: endpoint.url,
    apiKey: apiKeyInput.value.trim(),
    folderPath,
  };

  await chrome.storage.local.set({ obsidianSettings });
  setStatus('Obsidian settings saved.', 'success');
}

async function saveWpSettings(): Promise<void> {
  const endpoint = normalizeAndValidateEndpointUrl(
    wpEndpointInput.value,
    'WordPress',
    ''
  );
  if (!endpoint.ok) {
    setStatus(endpoint.error, 'error');
    return;
  }

  wordpressSettings = {
    endpointUrl: endpoint.url,
    username: wpUsernameInput.value.trim(),
    password: wpPasswordInput.value.trim(),
  };

  await chrome.storage.local.set({ wordpressSettings });
  setStatus('WordPress settings saved.', 'success');
}

async function ensureHostPermission(apiUrl: string): Promise<boolean> {
  let origin: string;
  try {
    origin = new URL(apiUrl).origin + '/*';
  } catch {
    return false;
  }

  const hasPermission = await chrome.permissions.contains({
    origins: [origin],
  });
  if (hasPermission) return true;

  return chrome.permissions.request({ origins: [origin] });
}

function normalizeAndValidateEndpointUrl(
  rawValue: string,
  service: 'Obsidian' | 'WordPress',
  fallback: string
): { ok: true; url: string } | { ok: false; error: string } {
  const value = (rawValue.trim() || fallback).trim();
  if (!value) {
    return {
      ok: false,
      error: `Enter a ${service} API URL first.`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return {
      ok: false,
      error: `Invalid ${service} API URL.`,
    };
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      ok: false,
      error: `${service} API URL must start with http:// or https://.`,
    };
  }

  if (parsed.protocol === 'http:' && !isLoopbackHost(parsed.hostname)) {
    return {
      ok: false,
      error: `${service} API URL must use HTTPS for non-local hosts.`,
    };
  }

  if (
    service === 'WordPress' &&
    !/\/wp-json\/wp\/v2\/posts\/?$/.test(parsed.pathname)
  ) {
    return {
      ok: false,
      error: 'WordPress endpoint must end with /wp-json/wp/v2/posts.',
    };
  }

  return {
    ok: true,
    url: parsed.href,
  };
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '[::1]'
  );
}

function getValidatedWordPressSettings(): WordPressSettings | null {
  if (!wordpressSettings?.username || !wordpressSettings.password) {
    setStatus('Configure WordPress settings first.', 'error');
    wpSettingsPanel.classList.remove('hidden');
    return null;
  }

  const endpoint = normalizeAndValidateEndpointUrl(
    wordpressSettings.endpointUrl,
    'WordPress',
    ''
  );
  if (!endpoint.ok) {
    setStatus(endpoint.error, 'error');
    wpSettingsPanel.classList.remove('hidden');
    return null;
  }

  return {
    ...wordpressSettings,
    endpointUrl: endpoint.url,
  };
}

async function testConnection(): Promise<void> {
  if (!obsidianSettings?.apiKey) {
    setStatus('Enter an API key and save first.', 'error');
    return;
  }

  const endpoint = normalizeAndValidateEndpointUrl(
    obsidianSettings.apiUrl,
    'Obsidian',
    DEFAULT_OBSIDIAN_API_URL
  );
  if (!endpoint.ok) {
    setStatus(endpoint.error, 'error');
    settingsPanel.classList.remove('hidden');
    return;
  }

  const apiUrl = endpoint.url;

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
selectAllBtn.addEventListener('click', () => setAllSelections(true));
clearSelectionBtn.addEventListener('click', () => setAllSelections(false));
downloadAllBtn.addEventListener('click', () => void handleDownloadSelected());
wordpressAllBtn.addEventListener('click', () => void handleWordPressSelected());
retryFailedBtn.addEventListener('click', async () => {
  if (failedBatchUrls.length === 0 || !lastBatchMode) {
    return;
  }

  const retryUrls = [...failedBatchUrls];
  setBatchFailures([]);

  if (lastBatchMode === 'download') {
    await downloadSelectedArticles(retryUrls);
    return;
  }

  const settings = getValidatedWordPressSettings();
  if (!settings) {
    return;
  }
  await sendSelectedToWordPress(retryUrls, settings);
});

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

  const endpoint = normalizeAndValidateEndpointUrl(
    obsidianSettings.apiUrl,
    'Obsidian',
    DEFAULT_OBSIDIAN_API_URL
  );
  if (!endpoint.ok) {
    setStatus(endpoint.error, 'error');
    settingsPanel.classList.remove('hidden');
    return;
  }

  const apiUrl = endpoint.url;

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
  const settings = getValidatedWordPressSettings();
  if (!settings) {
    return;
  }

  const granted = await ensureHostPermission(settings.endpointUrl);
  if (!granted) {
    setStatus('Permission denied for WordPress API URL.', 'error');
    return;
  }

  setStatus('Sending to WordPress...', 'info');

  const response = await sendMessage({
    type: 'SEND_TO_WORDPRESS',
    title: currentMetadata?.title ?? 'Untitled',
    content: currentArticleHtml,
    settings,
  });

  if (response.type === 'WORDPRESS_SUCCESS') {
    setStatus('Sent to WordPress as published!', 'success');
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
