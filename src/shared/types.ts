export interface ArticleMetadata {
  title: string;
  author: string;
  canonicalUrl: string;
  publishedDate: string;
  retrievedDate: string;
}

export interface ExtractionResult {
  success: true;
  metadata: ArticleMetadata;
  articleHtml: string;
}

export interface ExtractionError {
  success: false;
  error: string;
}

export type ExtractResult = ExtractionResult | ExtractionError;

export interface ExportOptions {
  includeFrontmatter: boolean;
  includeImages: boolean;
}

export interface ObsidianSettings {
  apiUrl: string;      // e.g. "http://127.0.0.1:27123"
  apiKey: string;      // Bearer token from plugin settings
  folderPath: string;  // e.g. "Medium Articles/" or "" for vault root
}

export interface WordPressSettings {
  endpointUrl: string; // e.g. "http://192.168.68.92:9879/wp-json/wp/v2/posts"
  username: string;
  password: string;    // Application Password
}
