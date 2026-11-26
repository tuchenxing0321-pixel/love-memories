import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/tt/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname === '/' ? '/search.html' : pathname}`);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error('invalid path');
    const body = await fs.readFile(file);
    response.setHeader('content-type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : 'text/html');
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});

await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const { port } = server.address();
const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
});
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });

try {
  await page.addInitScript(() => localStorage.setItem('nono-important-dates-v1', JSON.stringify([
    { id: 'old-local-date', title: '旧本地日期', date: '2026-01-01', note: '不应出现在共享搜索中' }
  ])));
  await page.addInitScript(() => localStorage.setItem('nono-video-links-v2', JSON.stringify({
    vlog: [{ id: 'old-local-video', name: '旧本地视频', url: 'https://example.com/old' }], dancee: []
  })));
  await page.route('**/assets/memory-library.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.MemoryLibrary={all:async()=>[{id:'old-local-memory',kind:'event',title:'旧本地回忆',date:'2026-01-02',story:'不应出现在共享搜索中'}]};`
  }));
  await page.route('**/assets/cloud-memory-library.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.MemoryLibrary={all:async()=>[{id:'cloud-memory',kind:'event',title:'云端回忆',date:'2026-10-01',story:'所有访问者共享'}],status:()=>({ready:true,reason:''})};`
  }));
  await page.route('**/assets/cloudbase-dates-client.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.CloudBaseDatesClient={status:()=>({ready:true,reason:''}),call:async action=>action==='listDates'?[{id:'cloud-date',title:'云端日期',date:'2026-10-02',note:'所有访问者共享'}]:null};`
  }));
  await page.route('**/assets/cloudbase-client.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('**/assets/cloudbase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('**/assets/cloudbase-dates-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
  await page.route('**/assets/video-library.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: `window.VideoLibrary={load:async()=>({vlog:[{id:'cloud-video',name:'云端视频',url:'https://example.com/new'}],dancee:[]}),title:item=>item.name||'视频'};`
  }));
  await page.route('https://static.cloudbase.net/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));

  await page.goto(`http://127.0.0.1:${port}/search.html`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => !document.querySelector('#status').textContent.includes('正在读取'));
  const titles = await page.locator('.result h2').allTextContents();
  if (!titles.includes('云端回忆') || !titles.includes('云端日期') || !titles.includes('云端视频')) {
    throw new Error(`search does not use the shared CloudBase sources: ${JSON.stringify(titles)}`);
  }
  if (titles.includes('旧本地回忆') || titles.includes('旧本地日期') || titles.includes('旧本地视频')) {
    throw new Error(`search mixes obsolete local data into shared results: ${JSON.stringify(titles)}`);
  }
  console.log('search cloud source check passed');
} finally {
  await browser.close();
  server.close();
}
