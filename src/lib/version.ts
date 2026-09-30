/** Shared semver-ish comparison (three numeric segments, `v` prefix tolerated). */

/** Positive result means `a` is newer than `b`. Prerelease suffixes compare as 0. */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v.replace(/^v/, '').split('.').map((n) => Number.parseInt(n, 10) || 0);
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}
