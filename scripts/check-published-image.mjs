import { appendFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const [image, tree] = process.argv.slice(2);
if (!image || image.startsWith('-') || !/^[a-f0-9]{40}$/.test(tree ?? '')) {
  throw new Error('Expected an image reference and a Git source tree SHA');
}
const inspected = spawnSync('docker', ['buildx', 'imagetools', 'inspect', image, '--raw'], { encoding: 'utf8', timeout: 90_000 });
let ready = false;
if (inspected.status !== 0) {
  if (inspected.stderr?.trim() !== `ERROR: ${image}: not found`) {
    throw new Error(`Cannot verify ${image}: ${inspected.error?.message ?? inspected.stderr?.trim()}`);
  }
} else {
  let manifest;
  try { manifest = JSON.parse(inspected.stdout); } catch { /* Reject malformed output below. */ }
  if (manifest?.schemaVersion !== 2 || !Array.isArray(manifest.manifests)) {
    throw new Error(`Invalid manifest for ${image}`);
  }
  const architectures = new Set(manifest.manifests
    .filter(entry => entry.platform?.os === 'linux').map(entry => entry.platform.architecture));
  if (manifest.annotations?.['io.agentteams.source-tree'] !== tree
      || !architectures.has('amd64') || !architectures.has('arm64')) {
    throw new Error(`Existing version ${image} has different or unverifiable source/architectures; refusing to overwrite it`);
  }
  ready = true;
}
const output = `ready=${ready}\n`;
process.stdout.write(output);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
