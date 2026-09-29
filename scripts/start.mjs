// npm run start wrapper (A7): `node scripts/start.mjs` — serves the
// standalone build with NODE_ENV=production and tees output to server.log.
import { teeSpawn } from './lib/tee-spawn.mjs';

process.env.NODE_ENV = 'production';

await teeSpawn('server.log', process.execPath, ['.next/standalone/server.js']);
