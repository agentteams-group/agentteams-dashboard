// npm run dev wrapper (A7): `node scripts/dev.mjs` — runs `next dev -p 3000`
// via the installed next binary (resolved, so no PATH/.cmd concerns on
// Windows) and tees output to dev.log.
import { createRequire } from 'node:module';
import { teeSpawn } from './lib/tee-spawn.mjs';

const require = createRequire(import.meta.url);
const nextBin = require.resolve('next/dist/bin/next');

await teeSpawn('dev.log', process.execPath, [nextBin, 'dev', '-p', '3000']);
