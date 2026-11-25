export function isSlideDocument(filename: string): boolean {
  return /\.(pdf|pptx?)$/i.test(filename);
}

export const DOCUMENT_PREVIEW_MAX_BYTES = 50 * 1024 * 1024;
