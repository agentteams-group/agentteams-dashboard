/**
 * Prepend the Next.js basePath to an API path so fetch() works
 * regardless of whether the app is deployed at root or under /dashboard.
 *
 * Usage:  fetch(apiUrl('/api/auth/login'), { ... })
 */
export function apiUrl(path: string): string {
  // NEXT_PUBLIC_BASE_PATH is baked at build time by Next.js.
  const base = process.env.NEXT_PUBLIC_BASE_PATH || '';
  // Ensure no double slashes
  return `${base}${path}`;
}
