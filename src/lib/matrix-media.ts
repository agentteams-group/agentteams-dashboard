/**
 * Matrix media URL helpers shared by the chat renderers.
 *
 * `mxc://` content URIs are converted to homeserver download URLs. Shared
 * between MarkdownMessage (inline media) and AttachmentCard (long-message
 * attachments) so the mapping stays in one place.
 */

/** Convert a Matrix `mxc://` content URI to an HTTP download URL. */
export function mxcToDownloadUrl(mxc: string, homeserver?: string): string | undefined {
  if (!mxc) return undefined;
  if (mxc.startsWith('http')) return mxc;
  if (!mxc.startsWith('mxc://')) return undefined;
  const parts = mxc.replace('mxc://', '').split('/');
  if (parts.length < 2) return undefined;
  const serverName = parts[0];
  const mediaId = parts.slice(1).join('/');
  const base = homeserver || '';
  return `${base}/_matrix/media/v3/download/${serverName}/${mediaId}`;
}
