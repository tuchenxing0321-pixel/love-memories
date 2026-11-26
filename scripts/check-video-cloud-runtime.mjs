import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/tt/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error('invalid path');
    const body = await fs.readFile(file);
    response.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html');
    response.end(body);
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const records = [
  { id: 'builtin-vlog-1', category: 'vlog', url: 'https://example.com/one', name: '第一段', date: '2026.06.06', cover: '' },
  { id: 'builtin-vlog-2', category: 'vlog', url: 'https://example.com/two', name: '第二段', date: '2026.10.10', cover: '' }
];
let role = 'viewer';
const context = await browser.newContext();
await context.exposeFunction('mockVideoCloudCall', async (name, action, payload = {}) => {
  if (name !== 'videoApi') throw new Error(`unexpected function ${name}`);
  if (action === 'getVideoAccess') return { role, canWrite: role !== 'viewer' };
  if (action === 'listVideos') return { vlog: records.filter(item => item.category === 'vlog'), dancee: records.filter(item => item.category === 'dancee') };
  if (role === 'viewer') throw new Error('403');
  if (action === 'addVideo') {
    const item = { id: `new-${records.length}`, ...payload };
    records.unshift(item);
    return item;
  }
  if (action === 'removeVideo') {
    const index = records.findIndex(item => item.id === payload.id);
    if (index < 0) throw new Error('not found');
    records.splice(index, 1);
    return { id: payload.id };
  }
  if (action === 'setVideoCover') {
    const item = records.find(record => record.id === payload.id);
    item.cover = payload.cover;
    return { id: payload.id, cover: payload.cover };
  }
  throw new Error(`unexpected action ${action}`);
});
await context.route('**/assets/cloudbase-client.js*', route => route.fulfill({
  contentType: 'text/javascript',
  body: 'window.CloudBaseClient={callFunction:(...args)=>window.mockVideoCloudCall(...args)};'
}));
await context.route('https://static.cloudbase.net/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
await context.route('https://fonts.gstatic.com/**', route => route.abort());

try {
  const viewer = await context.newPage();
  await viewer.goto(`${base}/video.html`);
  await viewer.waitForFunction(() => window.VideoLibrary?.read().vlog.length === 2);
  if (await viewer.locator('.add-card:visible').count()) throw new Error('viewer can see add controls');
  await viewer.goto(`${base}/vlog.html`);
  await viewer.waitForFunction(() => window.VideoLibrary?.read().vlog.length === 2);
  if (await viewer.locator('#manage').isVisible()) throw new Error('viewer can see manage controls');
  if (await viewer.locator('.item').count() !== 2) throw new Error('viewer cannot see both shared videos');
  await viewer.close();

  role = 'owner';
  const owner = await context.newPage();
  await owner.goto(`${base}/video.html`);
  await owner.waitForFunction(() => window.VideoLibrary?.canWrite());
  await owner.locator('.add-card[data-category="vlog"]').click();
  await owner.locator('#video-url').fill('https://example.com/new-video');
  await owner.locator('#video-name').fill('第三段');
  await owner.locator('#video-save').click();
  await owner.waitForFunction(() => window.VideoLibrary?.read().vlog.length === 3);
  await owner.goto(`${base}/vlog.html`);
  await owner.waitForFunction(() => window.VideoLibrary?.read().vlog.length === 3);
  if (await owner.locator('.item').count() !== 3) throw new Error('owner addition did not sync across pages');
  owner.on('dialog', dialog => dialog.accept());
  await owner.locator('#manage').click();
  await owner.locator('.item').first().locator('.delete').click();
  await owner.waitForFunction(() => window.VideoLibrary?.read().vlog.length === 2);
  if (records.length !== 2) throw new Error('owner deletion did not update shared records');
  await owner.close();
  console.log('video cloud runtime check passed');
} finally {
  await context.close();
  await browser.close();
  server.close();
}
