import type { ExtractResult } from '../shared/types';

/**
 * Self-contained extraction function injected into Medium pages
 * via chrome.scripting.executeScript({ func }).
 *
 * IMPORTANT: This function must not reference anything outside its body
 * at runtime. Type-only imports are fine (erased at compile time).
 */
export function extractArticle(): ExtractResult {
  // 1. Detect Medium page
  const article = document.querySelector('article');
  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  const isMedium =
    article !== null ||
    (ogSiteName !== null && ogSiteName.getAttribute('content') === 'Medium');

  if (!isMedium || !article) {
    return {
      success: false as const,
      error: 'This does not appear to be a Medium article page.',
    };
  }

  // 2. Extract metadata
  const metadata = {
    title: '',
    author: '',
    canonicalUrl: '',
    publishedDate: '',
    retrievedDate: new Date().toISOString().slice(0, 10),
  };

  // 2a. JSON-LD
  const ldScripts = document.querySelectorAll(
    'script[type="application/ld+json"]'
  );
  for (const script of ldScripts) {
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
        metadata.canonicalUrl = metadata.canonicalUrl || obj.url || '';
        metadata.publishedDate =
          metadata.publishedDate ||
          (obj.datePublished ? obj.datePublished.slice(0, 10) : '');
      }
    } catch {
      // ignore parse errors
    }
  }

  // 2b. Meta tag fallbacks
  const getMeta = (prop: string): string =>
    document.querySelector(`meta[property="${prop}"]`)?.getAttribute('content') ||
    document.querySelector(`meta[name="${prop}"]`)?.getAttribute('content') ||
    '';

  metadata.title = metadata.title || getMeta('og:title') || '';
  metadata.author =
    metadata.author || getMeta('author') || getMeta('article:author') || '';
  metadata.canonicalUrl = metadata.canonicalUrl || getMeta('og:url') || '';
  metadata.publishedDate =
    metadata.publishedDate ||
    (getMeta('article:published_time') || '').slice(0, 10);

  // 2c. DOM fallbacks
  metadata.title = metadata.title || document.title || '';
  metadata.canonicalUrl =
    metadata.canonicalUrl ||
    document.querySelector('link[rel="canonical"]')?.getAttribute('href') ||
    window.location.href;

  if (metadata.title.replace(/\s+/g, ' ').trim().toLowerCase() === 'medium rules') {
    return {
      success: false as const,
      error: 'Ignored article title: Medium Rules.',
    };
  }

  // 3. Clean article HTML
  const clone = article.cloneNode(true) as HTMLElement;

  // 3a. Remove known non-content elements
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

  // Remove [role="button"] only when it doesn't contain images
  // (Medium wraps zoomable images in role="button" divs)
  clone.querySelectorAll('[role="button"]').forEach((el) => {
    if (!el.querySelector('img, picture')) {
      el.remove();
    }
  });

  // Helper: check if an element has real article content
  // Short paragraphs alone (< 50 chars) don't count — catches badges like
  // "Member-only story" which sit inside <p> tags
  function hasArticleContent(el: Element): boolean {
    if (el.querySelector('h2, h3, h4, h5, h6, ul, ol, pre, blockquote, figure, picture, img, table')) {
      return true;
    }
    const paragraphs = el.querySelectorAll('p');
    for (const p of paragraphs) {
      if ((p.textContent?.trim().length || 0) > 50) {
        return true;
      }
    }
    return false;
  }

  // 3b. Remove byline sections containing Medium internal links
  // Byline links use "source=post_page" param (covers both /@user and /? patterns)
  // Walk up from each link but stop before reaching a container with real content
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

  // 3c. Remove containers (div/section only, NOT spans) with no real content
  // Catches membership badges, byline remnants, metadata chrome, spacers
  // Preserves containers that have images (hero images, inline images)
  // Does NOT touch spans — those may be syntax highlighting inside code blocks
  const containers = Array.from(
    clone.querySelectorAll('div, section')
  ).reverse();
  for (const container of containers) {
    if (!hasArticleContent(container) && !container.querySelector('img, picture')) {
      const text = container.textContent?.trim() || '';
      if (text.length < 200) {
        container.remove();
      }
    }
  }

  // 3d. Remove sign-up prompts and recommendations
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
    success: true as const,
    metadata,
    articleHtml: clone.innerHTML,
  };
}
