import type { ParsedPresentation, PptxFontOptions, PptxFontSource } from '@extend-ai/react-pptx';

const BASE = `${process.env.NEXT_PUBLIC_BASE_PATH || ''}/document-preview/ppt-fonts`;
const BUDGET = 300_000;
const OFFICE_ALIASES: Record<string, string> = {
  calibri: 'Carlito', arial: 'Arimo', 'times new roman': 'Tinos',
  'courier new': 'Cousine', aptos: 'Intos', 'aptos narrow': 'Intos Narrow',
};

interface FontAsset {
  family: string;
  style: 'normal' | 'italic';
  weight: '400' | '700';
  file: string;
  bytes: number;
  gzipBytes: number;
}

interface RequestedFace {
  originalFamily: string;
  family: string;
  style: 'normal' | 'italic';
  weight: '400' | '700';
}

let manifestPromise: Promise<FontAsset[]> | null = null;
function loadManifest(): Promise<FontAsset[]> {
  manifestPromise ??= fetch(`${BASE}/manifest.json`).then((response) => {
    if (!response.ok) throw new Error(`PPT font manifest HTTP ${response.status}`);
    return response.json() as Promise<FontAsset[]>;
  });
  return manifestPromise;
}

function collectRequestedFaces(presentation: ParsedPresentation): RequestedFace[] {
  const faces = new Map<string, RequestedFace>();
  const walk = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    const node = value as Record<string, unknown>;
    if (typeof node.fontFamily === 'string' && node.fontFamily.trim()) {
      const originalFamily = node.fontFamily.trim();
      const family = OFFICE_ALIASES[originalFamily.toLowerCase()] ?? originalFamily;
      const style = node.italic === true ? 'italic' : 'normal';
      const weight = node.bold === true ? '700' : '400';
      faces.set(`${originalFamily.toLowerCase()}:${style}:${weight}`, { originalFamily, family, style, weight });
    }
    for (const child of Object.values(node)) {
      if (child && typeof child === 'object') walk(child);
    }
  };
  walk(presentation.document.slides);
  return [...faces.values()];
}

/** Select only faces referenced by slide text and keep the whole deck under 300 KB gzip. */
export async function selectPptxFonts(presentation: ParsedPresentation): Promise<PptxFontOptions> {
  const options: PptxFontOptions = {
    useOfficeFallbacks: false,
    loadEmbeddedFonts: true,
    waitForFonts: true,
    loadTimeoutMs: 3000,
    fallbackFamilies: ['system-ui', 'sans-serif'],
  };
  const embedded = new Set((presentation.document.embeddedFonts ?? []).map((font) => font.family.toLowerCase()));
  const requested = collectRequestedFaces(presentation).filter((face) => (
    !embedded.has(face.originalFamily.toLowerCase()) && !embedded.has(face.family.toLowerCase())
  ));
  if (requested.length === 0) return options;

  let assets: FontAsset[];
  try {
    assets = await loadManifest();
  } catch {
    return options;
  }
  const sources: PptxFontSource[] = [];
  const fallbacks: Record<string, string> = {};
  let gzipBytes = (presentation.document.embeddedFonts ?? []).reduce((total, font) => {
    const asset = presentation.document.assets[font.assetId];
    return total + (asset?.byteLength ?? 0);
  }, 0);
  // Prefer regular, then bold, then italic faces when a deck exceeds the budget.
  const priority = { normal: 0, italic: 1 };
  requested.sort((a, b) => priority[a.style] - priority[b.style] || a.weight.localeCompare(b.weight));
  for (const face of requested) {
    const asset = assets.find((candidate) => candidate.family === face.family && candidate.style === face.style && candidate.weight === face.weight);
    if (!asset || gzipBytes + asset.gzipBytes > BUDGET) continue;
    sources.push({
      family: asset.family,
      source: `${BASE}/${asset.file}`,
      descriptors: { style: asset.style, weight: asset.weight },
    });
    fallbacks[face.originalFamily] = asset.family;
    gzipBytes += asset.gzipBytes;
  }
  return { ...options, sources, fallbacks };
}
