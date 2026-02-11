import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const outDir = join(root, 'build', 'chrome-extension');

const filesToCopy = [
  'manifest.json',
  'background.js',
  'content.js',
  'content.css',
  'popup.html',
  'popup.js',
  'workspace.html',
  'workspace.css',
  'workspace.js',
];

const dirsToCopy = ['icons', 'dist'];

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

for (const file of filesToCopy) {
  cpSync(join(root, file), join(outDir, file), { recursive: false });
}

for (const dir of dirsToCopy) {
  const src = join(root, dir);
  if (existsSync(src)) {
    cpSync(src, join(outDir, dir), { recursive: true });
  }
}

console.log(`Chrome extension package ready at: ${outDir}`);
