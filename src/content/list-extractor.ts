export interface ListExtractSuccess {
  success: true;
  articleUrls: string[];
  listTitle: string;
}

export interface ListExtractError {
  success: false;
  error: string;
}

export type ListExtractResult = ListExtractSuccess | ListExtractError;

/**
 * Self-contained extractor for Medium list pages.
 * Injected via chrome.scripting.executeScript({ func }).
 * Must not reference anything outside its body at runtime.
 */
export function extractListArticles(): ListExtractResult {
  const normalizeTitle = (value: string): string =>
    value.replace(/\s+/g, ' ').trim().toLowerCase();
  const isIgnoredTitle = (value: string): boolean =>
    normalizeTitle(value) === 'medium rules';
  const getSlugTitle = (path: string): string => {
    const match = path.match(/\/([^/]+)-[a-f0-9]{6,}\/?$/i);
    if (!match) return '';
    try {
      return decodeURIComponent(match[1]).replace(/-/g, ' ');
    } catch {
      return match[1].replace(/-/g, ' ');
    }
  };

  const ogSiteName = document.querySelector('meta[property="og:site_name"]');
  const isMedium =
    (ogSiteName !== null && ogSiteName.getAttribute('content') === 'Medium') ||
    window.location.hostname === 'medium.com' ||
    window.location.hostname.endsWith('.medium.com');

  if (!isMedium) {
    return {
      success: false as const,
      error: 'This does not appear to be a Medium page.',
    };
  }

  const pathname = window.location.pathname;
  const isListPage =
    /\/list\//.test(pathname) ||
    /\/@[^/]+\/lists/.test(pathname);

  if (!isListPage) {
    return {
      success: false as const,
      error: 'Navigate to a Medium reading list page first. List URLs contain "/list/" in the path.',
    };
  }

  const listTitle =
    document.querySelector('h1')?.textContent?.trim() || 'Medium List';

  const seen = new Set<string>();
  const articleUrls: string[] = [];

  document.querySelectorAll('a[href]').forEach((el) => {
    const href = (el as HTMLAnchorElement).href;
    if (!href) return;

    let parsed: URL;
    try {
      parsed = new URL(href);
    } catch {
      return;
    }

    if (
      parsed.hostname !== 'medium.com' &&
      !parsed.hostname.endsWith('.medium.com')
    ) {
      return;
    }

    const path = parsed.pathname;

    // Skip known non-article paths
    if (
      /^\/(tag|topic|search|me|new-story|about|help|membership|plans|business|creators|m\/signin|subscribe)\b/.test(path) ||
      /\/list\//.test(path) ||
      path === '/' ||
      path.endsWith('/lists') ||
      path.endsWith('/followers') ||
      path.endsWith('/following')
    ) {
      return;
    }

    // Medium article paths end with a hash slug: /title-abc1234f or /@user/title-abc1234f
    // Require at least 6 hex chars at the end (Medium uses 12-char hex IDs)
    if (!/\/[^/]+-[a-f0-9]{6,}\/?$/.test(path)) return;

    // Ignore specifically filtered article titles.
    const anchorTitle = (el.textContent || '').trim();
    if (isIgnoredTitle(anchorTitle)) return;

    const slugTitle = getSlugTitle(path);
    if (slugTitle && isIgnoredTitle(slugTitle)) return;

    const canonical = parsed.origin + parsed.pathname.replace(/\/$/, '');
    if (!seen.has(canonical)) {
      seen.add(canonical);
      articleUrls.push(canonical);
    }
  });

  if (articleUrls.length === 0) {
    return {
      success: false as const,
      error:
        'No articles found in this list. The list may be empty or not fully loaded yet.',
    };
  }

  return {
    success: true as const,
    articleUrls,
    listTitle,
  };
}
