import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/tt/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error('invalid path');
    const body = await fs.readFile(file);
    response.setHeader('content-type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'text/javascript' : file.endsWith('.jpg') ? 'image/jpeg' : 'text/html');
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const motionRequests = [];
const screenshotDir = process.env.HOME_MOTION_SCREENSHOT_DIR;
page.on('request', request => {
  if (request.url().includes('/assets/motion-webp/')) motionRequests.push(request.url());
});

try {
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  await page.route('https://fonts.gstatic.com/**', route => route.abort());
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#girlMotion')?.toDataURL().length > 5000);

  const snapshots = [];
  for (let index = 0; index < 4; index++) {
    snapshots.push(await page.locator('#girlMotion').evaluate(canvas => canvas.toDataURL()));
    await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  }

  if (new Set(snapshots).size !== 1) {
    throw new Error('home motion changes frames even though the scroll position did not change');
  }

  const initialFrames = new Set(motionRequests);
  if (initialFrames.size > 40) {
    throw new Error(`home motion eagerly loads ${initialFrames.size} frames before the user scrolls`);
  }
  if ([...initialFrames].some(url => url.endsWith('/frame-026.jpg'))) {
    throw new Error('home motion eagerly loads the middle frame before it is needed');
  }

  await page.evaluate(() => {
    const sequence = document.querySelector('#motionSequence');
    const distance = sequence.offsetHeight - innerHeight;
    scrollTo(0, sequence.offsetTop + distance * .5);
  });
  await page.waitForTimeout(500);
  for (const [person, frame] of [['girl', '022'], ['boy', '024']]) {
    if (!motionRequests.some(url => url.includes(`/assets/motion-webp/${person}/frame-${frame}.webp`))) {
      throw new Error(`home motion does not load ${person} frame ${frame} when scrolling to the middle`);
    }
  }
  if (screenshotDir) {
    await fs.mkdir(screenshotDir, { recursive: true });
    await page.screenshot({ path: path.join(screenshotDir, 'home-motion-middle.png') });
  }

  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(250);
  if (screenshotDir) await page.screenshot({ path: path.join(screenshotDir, 'home-motion-start.png') });

  await page.evaluate(async () => {
    const open = () => new Promise((resolve, reject) => {
      const request = indexedDB.open('nono-profile-gallery', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('photos', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const db = await open();
    const transaction = db.transaction('photos', 'readwrite');
    const image = index => ({ id: `image-${index}`, data: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="100%" height="100%" fill="hsl(${index * 90} 55% 70%)"/></svg>`)}` });
    transaction.objectStore('photos').put({ id: 'profile-1', person: 'girl', layer: 'self', category: '', description: '', image: image(1), createdAt: 1 });
    transaction.objectStore('photos').put({ id: 'profile-2', person: 'girl', layer: 'self', category: '', description: '', image: image(2), createdAt: 2 });
    await new Promise((resolve, reject) => {
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });
  await page.locator('#girlMotion').click();
  await page.waitForSelector('[data-stage="self"] .profile-gallery-card');
  await page.waitForTimeout(100);
  const autoStart = await page.locator('[data-stage="self"]').evaluate(stage => stage.scrollLeft);
  await page.waitForTimeout(250);
  const autoEnd = await page.locator('[data-stage="self"]').evaluate(stage => stage.scrollLeft);
  if (Math.abs(autoEnd - autoStart) < 1) {
    throw new Error(`profile gallery test precondition failed; auto-scroll did not start: ${autoStart} -> ${autoEnd}`);
  }
  await page.locator('[data-carousel="self"]').focus();
  if (!await page.locator('[data-carousel="self"]').evaluate(carousel => carousel === document.activeElement)) {
    throw new Error('profile gallery focus precondition failed');
  }
  await page.waitForTimeout(150);
  const focusedStart = await page.locator('[data-stage="self"]').evaluate(stage => stage.scrollLeft);
  await page.waitForTimeout(700);
  const focusedEnd = await page.locator('[data-stage="self"]').evaluate(stage => stage.scrollLeft);
  if (Math.abs(focusedEnd - focusedStart) > 1) {
    throw new Error(`profile gallery keeps auto-scrolling while keyboard-focused: ${focusedStart} -> ${focusedEnd}`);
  }
  await page.keyboard.press('Escape');
  await page.waitForTimeout(100);
  const closedProfileState = await page.evaluate(() => ({
    open: document.body.classList.contains('profile-open'),
    activeId: document.activeElement?.id || '',
    canvasFocused: document.activeElement?.classList.contains('motion-decoder') || false
  }));
  if (closedProfileState.open || closedProfileState.canvasFocused) {
    throw new Error(`profile close leaves the full-screen motion canvas focused: ${JSON.stringify(closedProfileState)}`);
  }
  console.log('home motion idempotence check passed');
} finally {
  await browser.close();
  server.close();
}
