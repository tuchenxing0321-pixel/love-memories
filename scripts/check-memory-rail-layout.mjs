import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/tt/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname;
    const file = path.join(root, pathname === '/' ? 'memories.html' : pathname);
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
const page = await browser.newPage({ viewport: { width: 800, height: 700 } });
const screenshotDir = process.env.MEMORY_SCREENSHOT_DIR;

const photos = Array.from({ length: 8 }, (_, index) => ({
  id: `photo-${index}`,
  remote: true,
  uploadedAt: '2026-10-30',
  data: `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="100%" height="100%" fill="hsl(${index * 42} 55% 70%)"/></svg>`)}`
}));
const records = [
  ...photos.map((image, index) => ({
    id: `memory-${index}`,
    kind: 'photo',
    title: `Photo ${index}`,
    date: '2026-10-30',
    images: [image]
  })),
  ...Array.from({ length: 6 }, (_, index) => ({
    id: `event-${index}`,
    kind: 'event',
    title: `Event ${index}`,
    date: `2026-0${index + 1}-01`,
    story: 'A timeline event that makes the rail fully leave the viewport.',
    images: []
  }))
];

await page.route('https://static.cloudbase.net/**', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
await page.route('**/assets/cloudbase-dates-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
await page.route('**/assets/cloudbase-config.js*', route => route.fulfill({ contentType: 'text/javascript', body: '' }));
await page.route('**/assets/cloudbase-client.js*', route => route.fulfill({
  contentType: 'text/javascript',
  body: 'window.CloudBaseClient={access:async()=>({role:"viewer",canWrite:false})};'
}));
await page.route('**/assets/cloud-memory-library.js*', route => route.fulfill({
  contentType: 'text/javascript',
  body: `window.MemoryLibrary={all:async()=>${JSON.stringify(records)},status:()=>({reason:''}),today:()=>"2026-10-30"};`
}));

try {
  await page.goto(`http://127.0.0.1:${port}/memories.html`);
  await page.waitForSelector('.memory-card');
  for (const viewportWidth of [1600, 2608]) {
    await page.setViewportSize({ width: viewportWidth, height: 800 });
    await page.waitForTimeout(250);
    const result = await page.locator('.memory-lane').evaluateAll(lanes => {
      const railWidth = document.querySelector('#railShell').clientWidth;
      return lanes.map(lane => ({
        sequenceWidth: lane.querySelector('.memory-sequence:not([data-clone])').scrollWidth,
        requiredWidth: railWidth + Math.abs(lane.offsetLeft)
      }));
    });
    if (result.some(({ sequenceWidth, requiredWidth }) => sequenceWidth < requiredWidth)) {
      throw new Error(`photo rail leaves a gap at ${viewportWidth}px: ${JSON.stringify(result)}`);
    }
  }
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(180);
  const offscreenStart = await page.locator('.memory-stream').first().evaluate(stream => getComputedStyle(stream).transform);
  await page.waitForTimeout(300);
  const offscreenEnd = await page.locator('.memory-stream').first().evaluate(stream => getComputedStyle(stream).transform);
  if (offscreenStart !== offscreenEnd) {
    const state = await page.locator('#railShell').evaluate(shell => ({
      paused: shell.classList.contains('is-paused'),
      rect: shell.getBoundingClientRect().toJSON(),
      scrollY,
      viewportHeight: innerHeight,
      playState: getComputedStyle(shell.querySelector('.memory-stream')).animationPlayState
    }));
    throw new Error(`photo rail keeps animating after it leaves the viewport: ${JSON.stringify(state)}`);
  }
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(180);
  const resumedStart = await page.locator('.memory-stream').first().evaluate(stream => getComputedStyle(stream).transform);
  await page.waitForTimeout(300);
  const resumedEnd = await page.locator('.memory-stream').first().evaluate(stream => getComputedStyle(stream).transform);
  if (resumedStart === resumedEnd) throw new Error('photo rail does not resume after returning to the viewport');

  await page.locator('#railToggle').click();
  await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(120);
  await page.evaluate(() => scrollTo(0, 0));
  await page.waitForTimeout(180);
  const manualPause = await page.locator('#railShell').evaluate(shell => ({
    paused: shell.classList.contains('is-paused'),
    pressed: document.querySelector('#railToggle').getAttribute('aria-pressed'),
    transform: getComputedStyle(shell.querySelector('.memory-stream')).transform
  }));
  await page.waitForTimeout(300);
  const manualPauseEnd = await page.locator('.memory-stream').first().evaluate(stream => getComputedStyle(stream).transform);
  if (!manualPause.paused || manualPause.pressed !== 'true' || manualPause.transform !== manualPauseEnd) {
    throw new Error(`manual rail pause is lost after leaving and returning: ${JSON.stringify(manualPause)}`);
  }
  await page.locator('#railToggle').click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload();
  await page.waitForSelector('.memory-card');
  const reducedControl = await page.locator('#railToggle').evaluate(button => ({
    disabled: button.disabled,
    label: button.getAttribute('aria-label'),
    text: button.textContent.trim()
  }));
  if (!reducedControl.disabled || !reducedControl.label?.includes('减少动态')) {
    throw new Error(`reduced-motion control is misleading: ${JSON.stringify(reducedControl)}`);
  }
  if (screenshotDir) {
    await fs.mkdir(screenshotDir, { recursive: true });
    for (const viewport of [{ name: 'desktop', width: 1440, height: 1000 }, { name: 'mobile', width: 390, height: 844 }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.waitForTimeout(180);
      await page.screenshot({ path: path.join(screenshotDir, `memories-${viewport.name}.png`), fullPage: true });
    }
  }
  console.log('memory rail layout check passed');
} finally {
  await browser.close();
  server.close();
}
