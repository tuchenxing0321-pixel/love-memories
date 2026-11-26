import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'cloudfunctions');
const output = path.join(root, 'dist', 'sharedApi');

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await cp(path.join(source, 'sharedApi', 'index.js'), path.join(output, 'index.js'));
await cp(path.join(source, 'sharedApi', 'package.json'), path.join(output, 'package.json'));
for (const name of ['dateApi', 'memoryApi']) {
  await cp(path.join(source, name), path.join(output, name), {
    recursive: true,
    filter: file => !file.endsWith('.test.js') && !file.endsWith('package.json')
  });
}
console.log(`CloudBase sharedApi package ready: ${output}`);
