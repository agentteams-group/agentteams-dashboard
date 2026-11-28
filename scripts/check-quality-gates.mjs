import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

const DEFAULT_CONFIG = 'scripts/quality-gates.config.json';
const numberFormat = new Intl.NumberFormat('en-US');
const stdout = (message = '') => process.stdout.write(`${message}\n`);

class QualityGateError extends Error {
  constructor(message) {
    super(message);
    this.name = 'QualityGateError';
  }
}

export function toPosix(value) {
  return value.split(path.sep).join('/');
}

function walkFiles(root, predicate = () => true) {
  const files = [];
  if (!existsSync(root)) return files;

  const visit = (directory) => {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(absolute);
      } else if (entry.isFile() && predicate(absolute)) {
        files.push(absolute);
      }
    }
  };

  visit(root);
  return files;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch (error) {
    throw new QualityGateError(`Unable to read JSON from ${filePath}: ${error.message}`);
  }
}

function normalizeChunkRef(reference) {
  return toPosix(reference)
    .replace(/^\/+/, '')
    .replace(/^_next\//, '')
    .replace(/^\.\//, '');
}

function resolveChunkPath(nextDir, reference) {
  const absolute = path.resolve(nextDir, reference);
  const prefix = `${path.resolve(nextDir)}${path.sep}`;
  if (!absolute.startsWith(prefix)) {
    throw new QualityGateError(`Chunk path escapes .next: ${reference}`);
  }
  return absolute;
}

function extractTurbopackAsyncGroups(source) {
  const groups = [];
  const pattern = /(\d+),([A-Za-z_$][\w$]*)=>\{\s*\2\.v\(([A-Za-z_$][\w$]*)=>\s*Promise\.all\(\[([\s\S]*?)\]\.map\([^)]*\)\)\)\.then\(\(\)=>\3\((\d+)\)\)\s*\)\s*\}/g;
  for (const match of source.matchAll(pattern)) {
    const files = [...match[4].matchAll(/(["'])(.*?)\1/g)].map((entry) => entry[2]);
    groups.push({ source: 'turbopack', id: match[1], moduleId: match[5], files });
  }

  const workerPattern = /(\d+),([A-Za-z_$][\w$]*)=>\{\s*\2\.v\(\2\.r\([^)]*\)\.f\((["'])(.*?)\3,\[([\s\S]*?)\]\)\)\}/g;
  for (const match of source.matchAll(workerPattern)) {
    const files = [match[4], ...[...match[5].matchAll(/(["'])(.*?)\1/g)].map((entry) => entry[2])];
    groups.push({ source: 'worker', id: match[1], moduleId: null, files });
  }
  return groups;
}

function extractLoadableModuleIds(source) {
  const ids = new Set();
  for (const match of source.matchAll(/loadableGenerated:\{modules:\[([0-9,]+)\]\}/g)) {
    for (const id of match[1].split(',')) ids.add(id);
  }
  return ids;
}

function extractReferencedChunks(source) {
  const references = new Set();
  for (const match of source.matchAll(/static\/chunks\/[^"'`\s)]+\.js/g)) {
    references.add(normalizeChunkRef(match[0]));
  }
  return references;
}

function readPageClientManifest(filePath) {
  if (!existsSync(filePath)) {
    throw new QualityGateError(`Missing ${filePath}. Run a production build first.`);
  }

  const source = readFileSync(filePath, 'utf8');
  const marker = 'globalThis.__RSC_MANIFEST["/page"] = ';
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new QualityGateError(`Unable to locate the root page client manifest in ${filePath}.`);
  }

  const jsonStart = start + marker.length;
  const end = source.lastIndexOf(';');
  if (end < jsonStart) {
    throw new QualityGateError(`Unable to parse the root page client manifest in ${filePath}.`);
  }

  try {
    return JSON.parse(source.slice(jsonStart, end));
  } catch (error) {
    throw new QualityGateError(`Unable to parse ${filePath}: ${error.message}`);
  }
}

function measureChunks(nextDir, references, cache) {
  const measured = [];
  for (const reference of new Set(references.map(normalizeChunkRef))) {
    if (!reference.endsWith('.js')) continue;
    if (!cache.has(reference)) {
      const absolute = resolveChunkPath(nextDir, reference);
      if (!existsSync(absolute)) {
        throw new QualityGateError(`Missing build chunk: ${reference}. Run a production build first.`);
      }
      const bytes = readFileSync(absolute);
      cache.set(reference, {
        file: `.next/${reference}`,
        bytes: bytes.length,
        gzipBytes: gzipSync(bytes, { level: 9 }).length,
      });
    }
    measured.push(cache.get(reference));
  }
  return measured;
}

function summarizeChunks(chunks) {
  return {
    files: chunks.length,
    bytes: chunks.reduce((total, chunk) => total + chunk.bytes, 0),
    gzipBytes: chunks.reduce((total, chunk) => total + chunk.gzipBytes, 0),
  };
}

export function collectBundleMetrics(repoRoot, bundleConfig = { route: '/' }) {
  if (bundleConfig.route !== '/') {
    throw new QualityGateError('Bundle metrics currently support only the root route (/).');
  }

  const nextDir = path.join(repoRoot, '.next');
  const pageDir = path.join(nextDir, 'server', 'app', 'page');
  const buildManifestPath = path.join(pageDir, 'build-manifest.json');
  const clientManifestPath = path.join(nextDir, 'server', 'app', 'page_client-reference-manifest.js');
  const loadableManifestPath = path.join(pageDir, 'react-loadable-manifest.json');

  for (const required of [buildManifestPath, clientManifestPath, loadableManifestPath]) {
    if (!existsSync(required)) {
      throw new QualityGateError(`Missing ${toPosix(path.relative(repoRoot, required))}. Run a production build first.`);
    }
  }

  const buildManifest = readJson(buildManifestPath);
  const clientManifest = readPageClientManifest(clientManifestPath);
  const loadableManifest = readJson(loadableManifestPath);
  const cache = new Map();
  const sourceCache = new Map();
  const initialReferences = [
    ...(buildManifest.rootMainFilesTree?.['/page'] || buildManifest.rootMainFiles || []),
    ...Object.values(clientManifest.entryJSFiles || {}).flat(),
  ].map(normalizeChunkRef).filter((reference) => reference.endsWith('.js'));
  const initialReferenceSet = new Set(initialReferences);
  const legacyReferences = (buildManifest.polyfillFiles || [])
    .map(normalizeChunkRef)
    .filter((reference) => reference.endsWith('.js'));
  const initialChunks = measureChunks(nextDir, initialReferences, cache);
  const legacyPolyfills = measureChunks(nextDir, legacyReferences, cache);

  const loadableGroups = Object.entries(loadableManifest).map(([id, group]) => ({
    source: 'loadable',
    id,
    files: (group.files || []).map(normalizeChunkRef).filter((reference) => reference.endsWith('.js')),
  }));
  const loadableIds = new Set(loadableGroups.map((group) => group.id));
  const turbopackGroups = new Map();
  const lazyModuleIds = new Set();
  const referencedChunks = new Set();
  const scanned = new Set();
  const pending = [...initialReferences, ...loadableGroups.flatMap((group) => group.files)];

  const readChunkSource = (reference) => {
    if (!sourceCache.has(reference)) {
      const absolute = resolveChunkPath(nextDir, reference);
      if (!existsSync(absolute)) {
        throw new QualityGateError(`Missing build chunk: ${reference}. Run a production build first.`);
      }
      sourceCache.set(reference, readFileSync(absolute, 'utf8'));
    }
    return sourceCache.get(reference);
  };

  while (pending.length > 0) {
    const reference = normalizeChunkRef(pending.shift());
    if (!reference.endsWith('.js') || scanned.has(reference)) continue;
    scanned.add(reference);
    const source = readChunkSource(reference);
    for (const id of extractLoadableModuleIds(source)) lazyModuleIds.add(id);
    for (const chunk of extractReferencedChunks(source)) referencedChunks.add(chunk);
    for (const group of extractTurbopackAsyncGroups(source)) {
      const files = [...new Set(group.files
        .map(normalizeChunkRef)
        .filter((file) => file.endsWith('.js')))].sort();
      const key = `${group.source}:${group.id}:${files.join('|')}`;
      if (!turbopackGroups.has(key)) {
        turbopackGroups.set(key, { source: group.source, id: group.id, files });
      }
      pending.push(...files);
    }
  }

  const asyncGroupSources = [
    ...loadableGroups,
    ...[...turbopackGroups.values()],
  ].map((group) => ({
    ...group,
    files: [...new Set(group.files
      .map(normalizeChunkRef)
      .filter((file) => file.endsWith('.js')))].sort(),
  }));
  const assignedReferences = new Set();
  const variantCounts = new Map();
  for (const group of asyncGroupSources) {
    const baseId = `${group.source}:${group.id}`;
    variantCounts.set(baseId, (variantCounts.get(baseId) || 0) + 1);
    for (const file of group.files) assignedReferences.add(file);
  }

  const variantIndexes = new Map();
  const budgetGroups = new Map();
  for (const group of asyncGroupSources) {
    const baseId = `${group.source}:${group.id}`;
    const variantIndex = (variantIndexes.get(baseId) || 0) + 1;
    variantIndexes.set(baseId, variantIndex);
    const label = variantCounts.get(baseId) > 1 ? `${baseId}#${variantIndex}` : baseId;
    const incrementalFiles = group.files.filter((file) => !initialReferenceSet.has(file));
    const chunks = measureChunks(nextDir, incrementalFiles, cache);
    const key = chunks.length > 0 ? chunks.map((chunk) => chunk.file).sort().join('|') : `empty:${label}`;
    const existing = budgetGroups.get(key);
    if (existing) {
      existing.aliases.push(label);
      existing.id = existing.aliases.join(' + ');
      existing.source = 'combined';
    } else {
      budgetGroups.set(key, {
        id: label,
        aliases: [label],
        source: group.source,
        ...summarizeChunks(chunks),
        chunks,
      });
    }
  }
  const asyncGroups = [...budgetGroups.values()]
    .sort((a, b) => b.gzipBytes - a.gzipBytes || a.id.localeCompare(b.id));

  const unassignedAsyncChunks = [...referencedChunks]
    .filter((reference) => !initialReferenceSet.has(reference) && !assignedReferences.has(reference))
    .sort();
  const missingLoadableGroups = [...lazyModuleIds]
    .filter((id) => !loadableIds.has(id))
    .sort((a, b) => Number(a) - Number(b));
  const reachableChunks = measureChunks(nextDir, [...scanned], cache);
  const allChunks = measureChunks(
    nextDir,
    walkFiles(path.join(nextDir, 'static', 'chunks'), (file) => file.endsWith('.js'))
      .map((file) => toPosix(path.relative(nextDir, file))),
    cache,
  );

  return {
    initial: { ...summarizeChunks(initialChunks), chunks: initialChunks },
    legacyPolyfills: { ...summarizeChunks(legacyPolyfills), chunks: legacyPolyfills },
    asyncGroups,
    unassignedAsyncChunks,
    missingLoadableGroups,
    reachable: summarizeChunks(reachableChunks),
    allChunks: summarizeChunks(allChunks),
    measurement: 'JavaScript-only gzip level 9 estimate; initial excludes noModule polyfills and async groups exclude initial chunks',
  };
}

export function validateBundleMetrics(metrics, config) {
  const violations = [];
  const check = (kind, label, actual, limit, unit) => {
    if (actual > limit) {
      violations.push({ kind, label, actual, limit, unit });
    }
  };

  check(
    'initial-gzip',
    `Initial route ${config.route}`,
    metrics.initial.gzipBytes,
    config.initial.maxGzipBytes,
    'bytes',
  );
  check(
    'initial-files',
    `Initial route ${config.route}`,
    metrics.initial.files,
    config.initial.maxFiles,
    'files',
  );

  for (const group of metrics.asyncGroups) {
    check(
      'async-gzip',
      `Async group ${group.id}`,
      group.gzipBytes,
      config.asyncGroup.maxGzipBytes,
      'bytes',
    );
    check(
      'async-files',
      `Async group ${group.id}`,
      group.files,
      config.asyncGroup.maxFiles,
      'files',
    );
  }

  check(
    'async-coverage',
    'Unassigned async chunks',
    metrics.unassignedAsyncChunks?.length || 0,
    0,
    'files',
  );
  check(
    'lazy-manifest-coverage',
    'Lazy modules missing from loadable manifest',
    metrics.missingLoadableGroups?.length || 0,
    0,
    'modules',
  );

  return violations;
}

function matchesExcludePattern(filePath, patterns) {
  return patterns.some((pattern) => {
    const candidates = pattern.startsWith('**/') ? [pattern, pattern.slice(3)] : [pattern];
    return candidates.some((candidate) => {
      const escaped = candidate
        .replace(/[.+^${}()|[\]\\]/g, '\\$&')
        .replace(/\*\*/g, '___DOUBLE_STAR___')
        .replace(/\*/g, '[^/]*')
        .replace(/___DOUBLE_STAR___/g, '.*');
      return new RegExp(`^${escaped}$`).test(filePath);
    });
  });
}

function countLines(text) {
  if (text.length === 0) return 0;
  const lines = text.split(/\r?\n/).length;
  return text.endsWith('\n') ? lines - 1 : lines;
}

export function collectSourceLineMetrics(repoRoot, config) {
  const sourceRoot = path.join(repoRoot, config.root);
  if (!existsSync(sourceRoot)) {
    throw new QualityGateError(`Missing source directory: ${toPosix(path.relative(repoRoot, sourceRoot))}`);
  }

  const excludeDirectories = new Set(config.excludeDirectories || []);
  const files = walkFiles(sourceRoot, (file) => {
    const relative = toPosix(path.relative(sourceRoot, file));
    return config.extensions.includes(path.extname(file))
      && !matchesExcludePattern(relative, config.excludePatterns || []);
  }).filter((file) => {
    const relative = toPosix(path.relative(sourceRoot, file));
    return !relative.split('/').some((segment) => excludeDirectories.has(segment));
  });

  const linesByPath = new Map();
  for (const file of files) {
    const relative = toPosix(path.relative(repoRoot, file));
    linesByPath.set(relative, countLines(readFileSync(file, 'utf8')));
  }

  const overLimit = [...linesByPath.entries()]
    .filter(([, lines]) => lines > config.maxLines)
    .map(([file, lines]) => ({ file, lines }))
    .sort((a, b) => b.lines - a.lines || a.file.localeCompare(b.file));

  return {
    scannedFiles: files.length,
    overLimit,
    linesByPath,
  };
}

export function findWhitelistGrowth(currentBaseline, baseBaseline) {
  const baseByPath = new Map(baseBaseline.map((entry) => [entry.path, entry.maxLines]));
  const violations = [];

  for (const entry of currentBaseline) {
    const baseLimit = baseByPath.get(entry.path);
    if (baseLimit === undefined) {
      violations.push({
        kind: 'whitelist-path-added',
        label: entry.path,
        actual: entry.maxLines,
        limit: 0,
        unit: 'lines',
      });
    } else if (entry.maxLines > baseLimit) {
      violations.push({
        kind: 'whitelist-limit-raised',
        label: entry.path,
        actual: entry.maxLines,
        limit: baseLimit,
        unit: 'lines',
      });
    }
  }

  return violations;
}

export function validateSourceLineMetrics(metrics, config, baseBaseline = null) {
  const baselineByPath = new Map(config.baseline.map((entry) => [entry.path, entry.maxLines]));
  const violations = [];
  const exceptions = [];

  for (const file of metrics.overLimit) {
    const baselineLimit = baselineByPath.get(file.file);
    if (baselineLimit === undefined) {
      violations.push({
        kind: 'new-over-limit-file',
        label: file.file,
        actual: file.lines,
        limit: config.maxLines,
        unit: 'lines',
      });
    } else if (file.lines > baselineLimit) {
      violations.push({
        kind: 'baseline-file-grew',
        label: file.file,
        actual: file.lines,
        limit: baselineLimit,
        unit: 'lines',
      });
    } else {
      exceptions.push(file);
    }
  }

  for (const entry of config.baseline) {
    const currentLines = metrics.linesByPath.get(entry.path);
    if (currentLines === undefined || currentLines <= config.maxLines) {
      violations.push({
        kind: 'stale-baseline-entry',
        label: entry.path,
        actual: currentLines ?? 0,
        limit: config.maxLines,
        unit: 'lines',
      });
    }
  }

  if (baseBaseline) {
    violations.push(...findWhitelistGrowth(config.baseline, baseBaseline));
  }

  return { violations, exceptions };
}

export function loadBaselineFromGit(repoRoot, configPath, baseRef) {
  const relativeConfig = toPosix(path.relative(repoRoot, path.resolve(repoRoot, configPath)));
  try {
    const output = execFileSync('git', ['show', `${baseRef}:${relativeConfig}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const config = JSON.parse(output);
    if (!Array.isArray(config.sourceLines?.baseline)) {
      throw new Error('sourceLines.baseline is missing or invalid');
    }
    return config.sourceLines.baseline;
  } catch (error) {
    const stderr = error.stderr?.toString() || '';
    if (/does not exist in|exists on disk, but not in/i.test(stderr)) {
      return null;
    }
    throw new QualityGateError(`Unable to load baseline from ${baseRef}: ${error.message}`);
  }
}

function parseArgs(argv) {
  const options = {
    command: null,
    warnOnly: false,
    json: false,
    baseRef: null,
    root: process.cwd(),
    config: DEFAULT_CONFIG,
    help: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const optionValue = (option) => {
      const value = argv[index + 1];
      if (!value || value.startsWith('-')) {
        throw new QualityGateError(`Missing value for ${option}.`);
      }
      index += 1;
      return value;
    };
    if (argument === '--warn-only') options.warnOnly = true;
    else if (argument === '--json') options.json = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else if (argument === '--base-ref') options.baseRef = optionValue(argument);
    else if (argument === '--root') options.root = optionValue(argument);
    else if (argument === '--config') options.config = optionValue(argument);
    else if (!argument.startsWith('-') && !options.command) options.command = argument;
    else throw new QualityGateError(`Unknown argument: ${argument}`);
  }

  if (options.command === 'lines' && !options.baseRef) {
    options.baseRef = process.env.QUALITY_GATES_BASE_REF
      || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : null);
  }
  return options;
}

function formatBytes(bytes) {
  return `${numberFormat.format(bytes)} B`;
}

function printBundleReport(metrics, violations, warnOnly) {
  stdout('Bundle budget (JavaScript-only gzip estimate)');
  stdout(`  Initial ${metrics.initial.files} files, ${formatBytes(metrics.initial.gzipBytes)} gzip`);
  stdout(`  Legacy noModule polyfills: ${metrics.legacyPolyfills.files} files, ${formatBytes(metrics.legacyPolyfills.gzipBytes)} gzip`);
  for (const group of metrics.asyncGroups) {
    stdout(`  Async ${group.id}: ${group.files} files, ${formatBytes(group.gzipBytes)} gzip`);
  }
  stdout(`  Reachable chunks: ${metrics.reachable.files} files, ${formatBytes(metrics.reachable.gzipBytes)} gzip`);
  stdout(`  All build chunks: ${metrics.allChunks.files} files, ${formatBytes(metrics.allChunks.gzipBytes)} gzip`);
  stdout(`  Measurement: ${metrics.measurement}`);
  for (const file of metrics.unassignedAsyncChunks || []) {
    stdout(`  UNASSIGNED ${file}`);
  }
  for (const id of metrics.missingLoadableGroups || []) {
    stdout(`  MISSING LOADABLE MANIFEST MODULE ${id}`);
  }
  for (const violation of violations) {
    const actual = violation.unit === 'bytes' ? formatBytes(violation.actual) : `${violation.actual} ${violation.unit}`;
    const limit = violation.unit === 'bytes' ? formatBytes(violation.limit) : `${violation.limit} ${violation.unit}`;
    stdout(`  FAIL ${violation.label}: ${actual} > ${limit}`);
  }
  stdout(violations.length ? `  ${violations.length} violation(s)${warnOnly ? ' (warning only)' : ''}` : '  All bundle checks passed.');
}

function printSourceLineReport(metrics, result, warnOnly, baseRef, baseBaseline) {
  stdout('Source line budget');
  stdout(`  Scanned ${metrics.scannedFiles} non-test source files.`);
  stdout(`  Baseline exceptions: ${result.exceptions.length}; over-limit files: ${metrics.overLimit.length}.`);
  if (baseRef) {
    stdout(`  Whitelist ratchet: ${baseBaseline ? `checked against ${baseRef}` : `unavailable at ${baseRef}; skipped`}`);
  }
  for (const violation of result.violations) {
    stdout(`  FAIL ${violation.kind}: ${violation.label} (${violation.actual} > ${violation.limit} ${violation.unit})`);
  }
  stdout(result.violations.length ? `  ${result.violations.length} violation(s)${warnOnly ? ' (warning only)' : ''}` : '  All source line checks passed.');
}

function printUsage() {
  stdout('Usage: node scripts/check-quality-gates.mjs <bundle|lines> [options]');
  stdout('  --warn-only       Report violations without a non-zero exit code');
  stdout('  --base-ref <ref>  Reject whitelist growth relative to a Git ref');
  stdout('  --json            Print machine-readable output');
  stdout('  --root <path>     Repository root (defaults to cwd)');
  stdout('  --config <path>   Config path (defaults to scripts/quality-gates.config.json)');
}

export function main(argv = process.argv.slice(2)) {
  try {
    const options = parseArgs(argv);
    if (options.help || !options.command) {
      printUsage();
      return options.help ? 0 : 2;
    }
    if (!['bundle', 'lines'].includes(options.command)) {
      throw new QualityGateError(`Unknown command: ${options.command}`);
    }
    if ((options.baseRef && !options.command) || (options.baseRef && options.command !== 'lines')) {
      throw new QualityGateError('--base-ref is only supported by the lines command.');
    }

    const repoRoot = path.resolve(options.root);
    const configPath = path.resolve(repoRoot, options.config);
    const config = readJson(configPath);
    let report;
    let violations;

    if (options.command === 'bundle') {
      const metrics = collectBundleMetrics(repoRoot, config.bundle);
      violations = validateBundleMetrics(metrics, config.bundle);
      report = { command: options.command, metrics, violations, warnOnly: options.warnOnly };
      if (!options.json) printBundleReport(metrics, violations, options.warnOnly);
    } else {
      const metrics = collectSourceLineMetrics(repoRoot, config.sourceLines);
      const baseBaseline = options.baseRef
        ? loadBaselineFromGit(repoRoot, configPath, options.baseRef)
        : null;
      const result = validateSourceLineMetrics(metrics, config.sourceLines, baseBaseline);
      violations = result.violations;
      report = {
        command: options.command,
        scannedFiles: metrics.scannedFiles,
        overLimit: metrics.overLimit,
        exceptions: result.exceptions,
        baseRef: options.baseRef,
        baselineComparison: options.baseRef ? (baseBaseline ? 'checked' : 'unavailable') : 'not_requested',
        violations,
        warnOnly: options.warnOnly,
      };
      if (!options.json) printSourceLineReport(metrics, result, options.warnOnly, options.baseRef, baseBaseline);
    }

    if (options.json) stdout(JSON.stringify(report, null, 2));
    return violations.length > 0 && !options.warnOnly ? 1 : 0;
  } catch (error) {
    console.error(`Quality gate error: ${error.message}`);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.exitCode = main();
}
