// npm run build helper (A7): copies the static assets Next.js does not
// include in the standalone server output. Replaces the Unix-only
// `cp -r` chain so the build runs on Windows cmd too.
import { cpSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');

cpSync(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'), {
  recursive: true,
});
cpSync(path.join(root, 'public'), path.join(standalone, 'public'), {
  recursive: true,
});
