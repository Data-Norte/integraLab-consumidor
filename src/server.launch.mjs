import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const serverTsPath = path.join(projectRoot, 'src', 'server.ts');

const args = ['--import', 'tsx', '--env-file-if-exists', '.env', serverTsPath];
const child = spawn(process.execPath, args, {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
});

const forwardSignal = signal => {
  if (!child.killed) {
    child.kill(signal);
  }
};

process.on('SIGINT', () => forwardSignal('SIGINT'));
process.on('SIGTERM', () => forwardSignal('SIGTERM'));

child.on('exit', code => {
  process.exit(code ?? 0);
});

child.on('error', error => {
  console.error('Falha ao iniciar servidor via launcher:', error);
  process.exit(1);
});
