// 拖拽上传收集：DataTransferItem.webkitGetAsEntry 只在事件同步阶段有效，
// 故先 snapshotDrop（同步）再 collectDrop（异步递归）。

export const DROP_MAX_FILES = 200;
export const DROP_MAX_BYTES = 200 * 1024 * 1024;

export interface DropFileLike {
  name: string;
  size: number;
}

export interface DropEntryLike {
  isFile: boolean;
  isDirectory: boolean;
  name: string;
  file?: (_ok: (_f: DropFileLike) => void, _fail?: (_e: unknown) => void) => void;
  createReader?: () => {
    readEntries: (
      _ok: (_entries: DropEntryLike[]) => void,
      _fail?: (_e: unknown) => void,
    ) => void;
  };
}

export interface DataTransferLike {
  items?: ArrayLike<{ webkitGetAsEntry?: () => DropEntryLike | null }>;
  files?: ArrayLike<DropFileLike>;
  types?: ArrayLike<string>;
}

export interface DropSnapshot {
  entries: DropEntryLike[];
  files: DropFileLike[];
}

export interface DroppedFile {
  file: DropFileLike;
  relPath: string;
}

export function dragHasFiles(dt: DataTransferLike | null | undefined): boolean {
  if (!dt) return false;
  const types = dt.types;
  if (types && typeof types.length === 'number') {
    for (let i = 0; i < types.length; i += 1) if (types[i] === 'Files') return true;
  }
  return !!dt.files && typeof dt.files.length === 'number' && dt.files.length > 0;
}

export function snapshotDrop(dt: DataTransferLike | null | undefined): DropSnapshot {
  const entries: DropEntryLike[] = [];
  const files: DropFileLike[] = [];
  if (!dt) return { entries, files };
  const items = dt.items;
  if (items && typeof items.length === 'number') {
    for (let i = 0; i < items.length; i += 1) {
      const it = items[i];
      if (!it || typeof it.webkitGetAsEntry !== 'function') continue;
      const e = it.webkitGetAsEntry();
      if (e) entries.push(e);
    }
  }
  const flat = dt.files;
  if (flat && typeof flat.length === 'number') {
    for (let i = 0; i < flat.length; i += 1) files.push(flat[i]);
  }
  return { entries, files };
}

function readFileEntry(entry: DropEntryLike): Promise<DropFileLike | null> {
  return new Promise((resolve) => {
    if (typeof entry.file !== 'function') {
      resolve(null);
      return;
    }
    try {
      entry.file(
        (f) => resolve(f),
        () => resolve(null),
      );
    } catch {
      resolve(null);
    }
  });
}

function readAllEntries(entry: DropEntryLike): Promise<DropEntryLike[]> {
  return new Promise((resolve) => {
    let reader: ReturnType<NonNullable<DropEntryLike['createReader']>>;
    try {
      const made = entry.createReader?.();
      if (!made) {
        resolve([]);
        return;
      }
      reader = made;
    } catch {
      resolve([]);
      return;
    }
    const all: DropEntryLike[] = [];
    let batches = 0;
    const step = (): void => {
      batches += 1;
      if (batches > 10000) {
        resolve(all);
        return;
      }
      try {
        reader.readEntries(
          (batch) => {
            if (!batch || batch.length === 0) {
              resolve(all);
              return;
            }
            all.push(...batch);
            step();
          },
          () => resolve(all),
        );
      } catch {
        resolve(all);
      }
    };
    step();
  });
}

interface Ctx {
  out: DroppedFile[];
  bytes: number;
  truncated: boolean;
  maxFiles: number;
  maxBytes: number;
}

function pushFile(ctx: Ctx, file: DropFileLike, relPath: string): void {
  const size = typeof file.size === 'number' && file.size > 0 ? file.size : 0;
  if (ctx.out.length >= ctx.maxFiles || ctx.bytes + size > ctx.maxBytes) {
    ctx.truncated = true;
    return;
  }
  ctx.bytes += size;
  ctx.out.push({ file, relPath });
}

async function walkEntry(entry: DropEntryLike, prefix: string, ctx: Ctx): Promise<void> {
  if (ctx.out.length >= ctx.maxFiles || ctx.bytes >= ctx.maxBytes) {
    ctx.truncated = true;
    return;
  }
  if (entry.isFile) {
    const f = await readFileEntry(entry);
    if (f) pushFile(ctx, f, `${prefix}${f.name || entry.name}`);
    return;
  }
  if (!entry.isDirectory) return;
  const kids = await readAllEntries(entry);
  const childPrefix = `${prefix}${entry.name}/`;
  for (const k of kids) {
    if (ctx.out.length >= ctx.maxFiles || ctx.bytes >= ctx.maxBytes) {
      ctx.truncated = true;
      return;
    }
    await walkEntry(k, childPrefix, ctx);
  }
}

export async function collectDrop(
  snap: DropSnapshot,
  limits: { maxFiles: number; maxBytes: number } = {
    maxFiles: DROP_MAX_FILES,
    maxBytes: DROP_MAX_BYTES,
  },
): Promise<{ files: DroppedFile[]; truncated: boolean }> {
  const ctx: Ctx = { out: [], bytes: 0, truncated: false, ...limits };
  if (snap.entries.length > 0) {
    for (const e of snap.entries) {
      if (ctx.out.length >= limits.maxFiles || ctx.bytes >= limits.maxBytes) {
        ctx.truncated = true;
        break;
      }
      await walkEntry(e, '', ctx);
    }
    return { files: ctx.out, truncated: ctx.truncated };
  }
  for (const f of snap.files) pushFile(ctx, f, f.name);
  return { files: ctx.out, truncated: ctx.truncated };
}

/** 需要预建的子目录（浅层在前）。 */
export function uniqueParentDirs(relPaths: readonly string[]): string[] {
  const set = new Set<string>();
  for (const p of relPaths) {
    const parts = p.split('/').filter(Boolean);
    for (let i = 1; i < parts.length; i += 1) set.add(parts.slice(0, i).join('/'));
  }
  return [...set].sort((a, b) => {
    const da = a.split('/').length;
    const db = b.split('/').length;
    if (da !== db) return da - db;
    return a < b ? -1 : a > b ? 1 : 0;
  });
}
