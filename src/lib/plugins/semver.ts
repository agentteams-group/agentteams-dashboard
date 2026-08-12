/**
 * Minimal semver matcher for plugin manifest validation.
 * Supports: '*', 'x' wildcards (1.x, 1.2.x), exact versions,
 * comparators (>, >=, <, <=, =), ^ and ~ ranges, AND (space)
 * and OR (||) combinations. No prerelease/build metadata handling
 * beyond stripping, which is enough for Dashboard version gating.
 */

export interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

export function parseSemVer(input: string): SemVer | null {
  const cleaned = input.trim().replace(/^v/i, '').split('-', 1)[0].split('+', 1)[0];
  const parts = cleaned.split('.');
  if (parts.length === 0 || parts.length > 3) return null;
  const nums: number[] = [];
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    nums.push(parseInt(part, 10));
  }
  return {
    major: nums[0] ?? 0,
    minor: nums[1] ?? 0,
    patch: nums[2] ?? 0,
  };
}

function compare(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

type Predicate = (_v: SemVer) => boolean;

function comparatorPredicate(op: string, raw: string): Predicate | null {
  const isWild = (seg: string) => seg === 'x' || seg === 'X' || seg === '*' || seg === '';
  const parts = raw.split('.');
  const major = isWild(parts[0] ?? '') ? null : Number(parts[0]);
  const minor = parts.length > 1 && !isWild(parts[1]) ? Number(parts[1]) : null;
  const patch = parts.length > 2 && !isWild(parts[2]) ? Number(parts[2]) : null;
  if (major !== null && !Number.isFinite(major)) return null;
  if (minor !== null && !Number.isFinite(minor)) return null;
  if (patch !== null && !Number.isFinite(patch)) return null;

  // Wildcards imply a range.
  if (major === null || (op === '=' && (minor === null || patch === null))) {
    if (major === null) return () => true;
    if (minor === null) {
      return (v) => v.major === major;
    }
    return (v) => v.major === major && v.minor === minor;
  }

  const base: SemVer = { major, minor: minor ?? 0, patch: patch ?? 0 };

  switch (op) {
    case '=':
    case '==':
      return (v) => compare(v, base) === 0;
    case '>':
      return (v) => compare(v, base) > 0;
    case '>=':
      return (v) => compare(v, base) >= 0;
    case '<':
      return (v) => compare(v, base) < 0;
    case '<=':
      return (v) => compare(v, base) <= 0;
    case '^': {
      // >=base <next breaking
      let upper: SemVer;
      if (major > 0) upper = { major: major + 1, minor: 0, patch: 0 };
      else if ((minor ?? 0) > 0) upper = { major: 0, minor: (minor ?? 0) + 1, patch: 0 };
      else upper = { major: 0, minor: 0, patch: (patch ?? 0) + 1 };
      return (v) => compare(v, base) >= 0 && compare(v, upper) < 0;
    }
    case '~': {
      const upper = { major, minor: (minor ?? 0) + 1, patch: 0 };
      return (v) => compare(v, base) >= 0 && compare(v, upper) < 0;
    }
    default:
      return null;
  }
}

function parseComparator(token: string): Predicate | null {
  const match = token.match(/^(>=|<=|==|=|>|<|\^|~)?\s*(.+)$/);
  if (!match) return null;
  const op = match[1] || '=';
  const target = match[2].trim();
  if (target === '*' || target === 'x' || target === 'X' || target === '') {
    return () => true;
  }
  return comparatorPredicate(op, target);
}

function parseRangeGroup(group: string): Predicate | null {
  const tokens = group.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return () => true;
  const predicates: Predicate[] = [];
  // Merge hyphen ranges "a - b".
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i] === '-' && i > 0 && i < tokens.length - 1) {
      const lower = parseComparator(`>=${tokens[i - 1]}`);
      const upper = parseComparator(`<=${tokens[i + 1]}`);
      if (!lower || !upper) return null;
      predicates.splice(predicates.length - 1, 1); // remove lower's plain predicate
      predicates.push((v) => lower(v) && upper(v));
      i += 1;
      continue;
    }
    const predicate = parseComparator(tokens[i]);
    if (!predicate) return null;
    predicates.push(predicate);
  }
  return (v) => predicates.every((p) => p(v));
}

/**
 * Returns true when `version` satisfies `range`.
 * Invalid versions always fail; empty/'*' ranges always pass.
 */
export function satisfies(version: string, range: string | undefined): boolean {
  if (!range || range.trim() === '' || range.trim() === '*') return true;
  const v = parseSemVer(version);
  if (!v) return false;
  const groups = range.split('||').map((g) => g.trim()).filter(Boolean);
  if (groups.length === 0) return true;
  return groups.some((group) => {
    const predicate = parseRangeGroup(group);
    return predicate ? predicate(v) : false;
  });
}

/** Orders plugin ids deterministically for display. */
export function compareSemVer(a: string, b: string): number {
  const pa = parseSemVer(a);
  const pb = parseSemVer(b);
  if (!pa || !pb) return a.localeCompare(b);
  return compare(pa, pb);
}
