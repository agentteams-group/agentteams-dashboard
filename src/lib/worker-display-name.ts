/** The Name field follows the IDENTITY.md template. */
export function workerIdentityName(identity?: string): string | undefined {
  let fence: string | undefined;
  for (const line of identity?.split(/\r?\n/) ?? []) {
    const fenceMarker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (fenceMarker?.[1].startsWith(fence) && !fenceMarker[2].trim()) fence = undefined;
      continue;
    }
    if (fenceMarker) {
      fence = fenceMarker[1];
      continue;
    }
    const field = /^ {0,3}(?:-\s+)?(?:\*\*Name:\*\*|\*\*Name\*\*:|Name:)\s*(.*)$/i.exec(line);
    const value = field?.[1].trim();
    if (value && !/^[_*`]?(?:\(pick something you like\))[_*`]?$/i.test(value)) return value;
  }
}

export function workerDisplayName(worker: { name: string; identity?: string }): string {
  return workerIdentityName(worker.identity) ?? worker.name;
}
