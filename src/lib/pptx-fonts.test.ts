// @vitest-environment node
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ParsedPresentation } from '@extend-ai/react-pptx';
import { selectPptxFonts } from './pptx-fonts';

const assets = [
  { family: 'Carlito', style: 'normal', weight: '400', file: 'carlito-normal-400.woff2', bytes: 1000, gzipBytes: 1000 },
  { family: 'Carlito', style: 'normal', weight: '700', file: 'carlito-normal-700.woff2', bytes: 1000, gzipBytes: 1000 },
  { family: 'Arimo', style: 'normal', weight: '400', file: 'arimo-normal-400.woff2', bytes: 1000, gzipBytes: 1000 },
];

beforeAll(() => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => assets }));
});

beforeEach(() => {
  vi.mocked(fetch).mockClear();
});

function presentation(
  slides: unknown[],
  embeddedFonts: unknown[] = [],
  embeddedAssets: Record<string, { byteLength: number }> = {},
): ParsedPresentation {
  return {
    document: { slides, embeddedFonts, assets: embeddedAssets },
  } as unknown as ParsedPresentation;
}

describe('selectPptxFonts', () => {
  it('loads only referenced faces and maps Office aliases', async () => {
    const options = await selectPptxFonts(presentation([
      { runs: [{ fontFamily: 'Calibri', bold: true }, { fontFamily: 'Arial' }] },
      { runs: [{ fontFamily: 'Calibri', bold: true }] },
    ]));

    expect(options.sources).toEqual(expect.arrayContaining([
      { family: 'Carlito', source: expect.stringContaining('carlito-normal-700.woff2'), descriptors: { style: 'normal', weight: '700' } },
      { family: 'Arimo', source: expect.stringContaining('arimo-normal-400.woff2'), descriptors: { style: 'normal', weight: '400' } },
    ]));
    expect(options.sources).toHaveLength(2);
    expect(options.fallbacks).toEqual({ Calibri: 'Carlito', Arial: 'Arimo' });
  });

  it('does not fetch fallback fonts for embedded families', async () => {
    const options = await selectPptxFonts(presentation(
      [{ runs: [{ fontFamily: 'Calibri' }] }],
      [{ family: 'Calibri', assetId: 'embedded' }],
      { embedded: { byteLength: 5000 } },
    ));

    expect(options.sources ?? []).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the selected font payload within the deck gzip budget', async () => {
    vi.resetModules();
    const { selectPptxFonts: selectWithBudget } = await import('./pptx-fonts');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => assets.map((asset) => ({ ...asset, gzipBytes: 200_000 })),
    }));

    const options = await selectWithBudget(presentation([
      { runs: [{ fontFamily: 'Calibri' }, { fontFamily: 'Arial' }] },
    ]));

    expect(options.sources).toHaveLength(1);
  });
});
