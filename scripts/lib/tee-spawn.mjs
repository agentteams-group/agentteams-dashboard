// Cross-platform "pipe to tee" wrapper (A7.2): spawns a command with
// piped stdio, mirrors stdout/stderr to both the terminal and a log file,
// forwards SIGINT/SIGTERM, and exits with the child's code.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';

/**
 * @param {string} logFile
 * @param {string} command
 * @param {string[]} args
 * @returns {Promise<number>}
 */
export function teeSpawn(logFile, command, args) {
  return new Promise((resolve, reject) => {
    const log = createWriteStream(logFile, { flags: 'w' });
    log.on('error', reject);
    const child = spawn(command, args, { stdio: ['inherit', 'pipe', 'pipe'] });

    const mirror = (source) => {
      source.on('data', (chunk) => {
        process.stdout.write(chunk);
        log.write(chunk);
      });
    };
    mirror(child.stdout);
    mirror(child.stderr);

    const forward = (signal) => {
      if (!child.killed) child.kill(signal);
    };
    process.on('SIGINT', forward);
    process.on('SIGTERM', forward);

    child.on('error', (err) => {
      log.end();
      reject(err);
    });
    child.on('close', (code, signal) => {
      log.end(() => {
        process.exitCode = code ?? (signal ? 1 : 0);
        resolve(process.exitCode);
      });
    });
  });
}
