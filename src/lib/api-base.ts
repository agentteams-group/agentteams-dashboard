/**
 * Prepend the Next.js basePath to an API path so fetch() works
 * regardless of whether the app is deployed at root or under /dashboard.
 *
 * Also ensures trailing slash for API routes (Next.js trailingSlash: true
 * causes 308 redirects on POST requests without trailing slash).
 *
 * Usage:  fetch(apiUrl('/api/auth/login'), { ... })
 */
export function apiUrl(path: string): string {
  // NEXT_PUBLIC_BASE_PATH is baked at build time by Next.js.
  const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
  const [pathname, query] = path.split('?', 2);
  // Ensure the path has a trailing slash without mutating query values.
  const normalized = pathname.endsWith('/') ? pathname : `${pathname}/`;
  return `${base}${normalized}${query ? `?${query}` : ''}`;
}
