/**
 * Matrix media URL helpers shared by the chat renderers.
 *
 * `mxc://` content URIs are converted to homeserver download URLs. Shared
 * between MarkdownMessage (inline media) and AttachmentCard (long-message
 * attachments) so the mapping stays in one place.
 */

export interface MxcUrlOptions {
  /**
   * Append `?download=true` so the homeserver responds with
   * Content-Disposition: attachment (forces a real file download instead of
   * the browser trying to preview PDFs/text inline).
   */
  download?: boolean;
}

/** Convert a Matrix `mxc://` content URI to an HTTP download URL. */
export function mxcToDownloadUrl(mxc: string, homeserver?: string, options: MxcUrlOptions = {}): string | undefined {
  if (!mxc) return undefined;
  if (mxc.startsWith('http')) {
    if (!options.download) return mxc;
    try {
      const u = new URL(mxc);
      u.searchParams.set('download', 'true');
      return u.toString();
    } catch {
      return mxc;
    }
  }
  if (!mxc.startsWith('mxc://')) return undefined;
  const parts = mxc.replace('mxc://', '').split('/');
  if (parts.length < 2) return undefined;
  const serverName = parts[0];
  const mediaId = parts.slice(1).join('/');
  const base = homeserver || '';
  const url = `${base}/_matrix/media/v3/download/${serverName}/${mediaId}`;
  return options.download ? `${url}?download=true` : url;
}
