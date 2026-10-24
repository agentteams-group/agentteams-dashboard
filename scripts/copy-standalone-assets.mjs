// npm run build helper (A7): copies the static assets Next.js does not
// include in the standalone server output. Replaces the Unix-only
// `cp -r` chain so the build runs on Windows cmd too.
import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

// Node 24's recursive cpSync aborts with exit code 127 on this tree under
// Windows, so walk it manually instead.
function copyDir(source, destination) {
  if (statSync(source).isDirectory()) {
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(source)) {
      copyDir(path.join(source, entry), path.join(destination, entry));
    }
    return;
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  copyFileSync(source, destination);
}

const root = process.cwd();
const standalone = path.join(root, '.next', 'standalone');

copyDir(path.join(root, '.next', 'static'), path.join(standalone, '.next', 'static'));
copyDir(path.join(root, 'public'), path.join(standalone, 'public'));
