import type { ArticleMetadata, ObsidianSettings, WordPressSettings } from './types';

// Popup -> Background

export interface ExtractMessage {
  type: 'EXTRACT';
}

export interface ExtractListMessage {
  type: 'EXTRACT_LIST';
}

export interface FetchArticleHtmlMessage {
  type: 'FETCH_ARTICLE_HTML';
  url: string;
}

export interface DownloadFileMessage {
  type: 'DOWNLOAD_FILE';
  /** File content as text (markdown, etc.) */
  content: string;
  filename: string;
  mimeType?: string;
  /** Set true when content is already base64-encoded (e.g. ZIP from JSZip). */
  contentIsBase64?: boolean;
  /** Whether to show a Save As dialog. Defaults to true. */
  saveAs?: boolean;
}

export interface SendToObsidianMessage {
  type: 'SEND_TO_OBSIDIAN';
  markdown: string;
  filename: string;
  settings: ObsidianSettings;
}

export interface SendToWordPressMessage {
  type: 'SEND_TO_WORDPRESS';
  title: string;
  content: string;
  category?: string;
  settings: WordPressSettings;
}

export type PopupMessage =
  | ExtractMessage
  | ExtractListMessage
  | FetchArticleHtmlMessage
  | DownloadFileMessage
  | SendToObsidianMessage
  | SendToWordPressMessage;

// Background -> Popup

export interface ExtractSuccessResponse {
  type: 'EXTRACT_SUCCESS';
  metadata: ArticleMetadata;
  articleHtml: string;
}

export interface ExtractListSuccessResponse {
  type: 'EXTRACT_LIST_SUCCESS';
  articleUrls: string[];
  listTitle: string;
}

export interface FetchHtmlSuccessResponse {
  type: 'FETCH_HTML_SUCCESS';
  html: string;
  url: string;
}

export interface DownloadSuccessResponse {
  type: 'DOWNLOAD_SUCCESS';
}

export interface ObsidianSuccessResponse {
  type: 'OBSIDIAN_SUCCESS';
}

export interface WordPressSuccessResponse {
  type: 'WORDPRESS_SUCCESS';
  postUrl: string;
}

export interface ErrorResponse {
  type: 'ERROR';
  error: string;
}

export type BackgroundResponse =
  | ExtractSuccessResponse
  | ExtractListSuccessResponse
  | FetchHtmlSuccessResponse
  | DownloadSuccessResponse
  | ObsidianSuccessResponse
  | WordPressSuccessResponse
  | ErrorResponse;
