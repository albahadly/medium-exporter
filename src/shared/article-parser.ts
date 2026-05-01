import type { ExtractResult } from './types';

/**
 * Parse article metadata and body from a Document.
 * Used by the popup when processing batch list downloads (HTML fetched by
 * the background service worker and parsed via DOMParser in the popup).
 *
 * Mirrors the logic in extractArticle() but accepts an explicit Document
 * instead of using the global `document`.
 */
export function parseArticleFromDoc(doc: Document, sourceUrl: string): ExtractResult {
  const article = doc.querySelector('article');
  const ogSiteName = doc.querySelector('meta[property="og:site_name"]');
  const isMedium =
    article !== null ||
    (ogSiteName !== null && ogSiteName.getAttribute('content') === 'Medium');

  if (!isMedium || !article) {
    return {
      success: false,
      error: 'Not recognised as a Medium article.',
    };
  }

  const metadata = {
    title: '',
    author: '',
    canonicalUrl: sourceUrl,
    publishedDate: '',
    retrievedDate: new Date().toISOString().slice(0, 10),
  };

  // JSON-LD
  doc.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
    try {
      const data = JSON.parse(script.textContent || '');
      const obj = Array.isArray(data) ? data[0] : data;
      if (
        obj['@type'] === 'Article' ||
        obj['@type'] === 'NewsArticle' ||
        obj['@type'] === 'BlogPosting'
      ) {
        metadata.title = metadata.title || obj.headline || obj.name || '';
        metadata.author =
          metadata.author ||
          (typeof obj.author === 'string' ? obj.author : obj.author?.name) ||
          '';
        metadata.canonicalUrl = metadata.canonicalUrl || obj.url || sourceUrl;
        metadata.publishedDate =
          metadata.publishedDate ||
          (obj.datePublished ? obj.datePublished.slice(0, 10) : '');
      }
    } catch {
      // ignore parse errors
    }
  });

  const getMeta = (prop: string): string =>
    doc.querySelector(`meta[property="${prop}"]`)?.getAttribute('content') ||
    doc.querySelector(`meta[name="${prop}"]`)?.getAttribute('content') ||
    '';

  metadata.title = metadata.title || getMeta('og:title') || '';
  metadata.author =
    metadata.author || getMeta('author') || getMeta('article:author') || '';
  metadata.canonicalUrl = metadata.canonicalUrl || getMeta('og:url') || sourceUrl;
  metadata.publishedDate =
    metadata.publishedDate ||
    (getMeta('article:published_time') || '').slice(0, 10);
  metadata.title = metadata.title || doc.title || '';

  if (metadata.title.replace(/\s+/g, ' ').trim().toLowerCase() === 'medium rules') {
    return {
      success: false,
      error: 'Ignored article title: Medium Rules.',
    };
  }

  // Clean article HTML — same strategy as extractArticle()
  const clone = article.cloneNode(true) as HTMLElement;

  const removeSelectors = [
    'h1',
    'button',
    'svg',
    'aside',
    '[data-testid*="response"]',
    '[data-testid*="clap"]',
    '[aria-label*="clap"]',
    '[aria-label*="responses"]',
  ];

  for (const sel of removeSelectors) {
    clone.querySelectorAll(sel).forEach((el) => el.remove());
  }

  clone.querySelectorAll('[role="button"]').forEach((el) => {
    if (!el.querySelector('img, picture')) el.remove();
  });

  function hasArticleContent(el: Element): boolean {
    if (
      el.querySelector(
        'h2, h3, h4, h5, h6, ul, ol, pre, blockquote, figure, picture, img, table'
      )
    ) {
      return true;
    }
    const paragraphs = el.querySelectorAll('p');
    for (const p of paragraphs) {
      if ((p.textContent?.trim().length || 0) > 50) return true;
    }
    return false;
  }

  clone
    .querySelectorAll('a[href*="source=post_page"], a[href^="/@"]')
    .forEach((link) => {
      let target: Element = link;
      let parent = link.parentElement;
      while (parent && parent !== clone) {
        if (hasArticleContent(parent)) break;
        target = parent;
        parent = parent.parentElement;
      }
      target.remove();
    });

  Array.from(clone.querySelectorAll('div, section'))
    .reverse()
    .forEach((container) => {
      if (
        !hasArticleContent(container) &&
        !container.querySelector('img, picture')
      ) {
        const text = container.textContent?.trim() || '';
        if (text.length < 200) container.remove();
      }
    });

  clone.querySelectorAll('div, section').forEach((el) => {
    const text = el.textContent?.trim() || '';
    if (
      text.length < 200 &&
      (/sign up/i.test(text) ||
        /subscribe/i.test(text) ||
        /get started/i.test(text) ||
        /open in app/i.test(text) ||
        /free trial/i.test(text) ||
        /more from/i.test(text) ||
        /recommended from/i.test(text))
    ) {
      el.remove();
    }
  });

  return {
    success: true,
    metadata,
    articleHtml: clone.innerHTML,
  };
}
