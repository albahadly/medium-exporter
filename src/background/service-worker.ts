import type { PopupMessage, BackgroundResponse } from '../shared/messages';
import type { ExtractResult, ObsidianSettings, WordPressSettings } from '../shared/types';
import { extractArticle } from '../content/extractor';
import { extractListArticles } from '../content/list-extractor';
import type { ListExtractResult } from '../content/list-extractor';

chrome.runtime.onMessage.addListener(
  (message: PopupMessage, _sender, sendResponse) => {
    if (message.type === 'EXTRACT') {
      handleExtract().then(sendResponse);
      return true; // async response
    }

    if (message.type === 'EXTRACT_LIST') {
      handleExtractList().then(sendResponse);
      return true;
    }

    if (message.type === 'FETCH_ARTICLE_HTML') {
      handleFetchArticleHtml(message.url).then(sendResponse);
      return true;
    }

    if (message.type === 'DOWNLOAD_FILE') {
      handleDownload(
        message.content,
        message.filename,
        message.mimeType ?? 'text/markdown',
        message.saveAs ?? true,
        message.contentIsBase64 ?? false
      ).then(sendResponse);
      return true;
    }

    if (message.type === 'SEND_TO_OBSIDIAN') {
      handleSendToObsidian(
        message.markdown,
        message.filename,
        message.settings
      ).then(sendResponse);
      return true;
    }

    if (message.type === 'SEND_TO_WORDPRESS') {
      handleSendToWordPress(
        message.title,
        message.content,
        message.settings
      ).then(sendResponse);
      return true;
    }
  }
);

async function handleExtractList(): Promise<BackgroundResponse> {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id) {
      return { type: 'ERROR', error: 'No active tab found.' };
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractListArticles,
    });

    const result = results[0]?.result as ListExtractResult | undefined;

    if (!result) {
      return { type: 'ERROR', error: 'List extraction returned no result.' };
    }

    if (!result.success) {
      return { type: 'ERROR', error: result.error };
    }

    return {
      type: 'EXTRACT_LIST_SUCCESS',
      articleUrls: result.articleUrls,
      listTitle: result.listTitle,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { type: 'ERROR', error: `List extraction failed: ${msg}` };
  }
}

async function handleFetchArticleHtml(url: string): Promise<BackgroundResponse> {
  try {
    const response = await fetch(url, {
      credentials: 'include',
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });

    if (!response.ok) {
      return {
        type: 'ERROR',
        error: `Fetch failed (${response.status}): ${response.statusText}`,
      };
    }

    const html = await response.text();
    return { type: 'FETCH_HTML_SUCCESS', html, url };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { type: 'ERROR', error: `Could not fetch article: ${msg}` };
  }
}

async function handleExtract(): Promise<BackgroundResponse> {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });

    if (!tab?.id) {
      return { type: 'ERROR', error: 'No active tab found.' };
    }

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: extractArticle,
    });

    const result = results[0]?.result as ExtractResult | undefined;

    if (!result) {
      return { type: 'ERROR', error: 'Extraction returned no result.' };
    }

    if (!result.success) {
      return { type: 'ERROR', error: result.error };
    }

    return {
      type: 'EXTRACT_SUCCESS',
      metadata: result.metadata,
      articleHtml: result.articleHtml,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { type: 'ERROR', error: `Injection failed: ${msg}` };
  }
}

async function handleSendToObsidian(
  markdown: string,
  filename: string,
  settings: ObsidianSettings
): Promise<BackgroundResponse> {
  try {
    const path = `/vault/${encodeVaultPath(filename)}`;
    const url = new URL(path, settings.apiUrl);

    const response = await fetch(url.href, {
      method: 'PUT',
      headers: {
        'Content-Type': 'text/markdown',
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: markdown,
      mode: 'cors',
    });

    if (response.status === 204 || response.status === 200) {
      return { type: 'OBSIDIAN_SUCCESS' };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        type: 'ERROR',
        error: 'Authentication failed. Check your API key.',
      };
    }

    return {
      type: 'ERROR',
      error: `Obsidian API error (${response.status}): ${response.statusText}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      return {
        type: 'ERROR',
        error:
          'Could not connect to Obsidian. Make sure Obsidian is running with the Local REST API plugin enabled.',
      };
    }
    return { type: 'ERROR', error: `Obsidian send failed: ${msg}` };
  }
}

function encodeVaultPath(filepath: string): string {
  return filepath
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

async function handleSendToWordPress(
  title: string,
  content: string,
  settings: WordPressSettings
): Promise<BackgroundResponse> {
  try {
    const credentials = btoa(`${settings.username}:${settings.password}`);

    const response = await fetch(settings.endpointUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Basic ${credentials}`,
      },
      body: JSON.stringify({ title, content, status: 'publish' }),
      mode: 'cors',
      credentials: 'omit',
    });

    if (response.ok) {
      const data = await response.json() as { link?: string };
      return { type: 'WORDPRESS_SUCCESS', postUrl: data.link ?? '' };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        type: 'ERROR',
        error: 'Authentication failed. Check your WordPress username and application password.',
      };
    }

    return {
      type: 'ERROR',
      error: `WordPress API error (${response.status}): ${response.statusText}`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) {
      return {
        type: 'ERROR',
        error: 'Could not connect to WordPress. Make sure the site is accessible.',
      };
    }
    return { type: 'ERROR', error: `WordPress send failed: ${msg}` };
  }
}

async function handleDownload(
  content: string,
  filename: string,
  mimeType: string,
  saveAs: boolean,
  contentIsBase64: boolean
): Promise<BackgroundResponse> {
  try {
    let base64: string;

    if (contentIsBase64) {
      base64 = content;
    } else {
      const encoder = new TextEncoder();
      const uint8 = encoder.encode(content);
      let binary = '';
      for (let i = 0; i < uint8.length; i++) {
        binary += String.fromCharCode(uint8[i]);
      }
      base64 = btoa(binary);
    }

    const dataUrl = `data:${mimeType};base64,${base64}`;

    await chrome.downloads.download({
      url: dataUrl,
      filename,
      saveAs,
    });

    return { type: 'DOWNLOAD_SUCCESS' };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { type: 'ERROR', error: `Download failed: ${msg}` };
  }
}
