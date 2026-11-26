import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '/Users/tt/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pages = ['index.html', 'memories.html', 'video.html', 'vlog.html', 'dancee.html', 'dates.html', 'search.html', 'backup.html', 'lens.html', 'secret.html', 'auth.html', 'creative.html'];
const variants = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' },
  { name: 'mobile-reduced', viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' }
];
const mime = extension => ({
  '.css': 'text/css', '.js': 'text/javascript', '.html': 'text/html', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.mp3': 'audio/mpeg', '.mp4': 'video/mp4'
})[extension] || 'application/octet-stream';

const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(`${root}${path.sep}`)) throw new Error('invalid path');
    const body = await fs.readFile(file);
    response.setHeader('content-type', mime(path.extname(file).toLowerCase()));
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

try {
  for (const variant of variants) {
    for (const filename of pages) {
      const page = await browser.newPage({ viewport: variant.viewport, reducedMotion: variant.reducedMotion });
      const errors = [];
      page.on('pageerror', error => errors.push(`pageerror: ${error.message}`));
      page.on('console', message => {
        if (message.type() === 'error' || message.type() === 'assert') errors.push(`${message.type()}: ${message.text()}`);
      });
      await page.route('https://**/*', route => route.fulfill({
        status: 200,
        contentType: route.request().url().includes('fonts.googleapis.com') ? 'text/css' : 'text/javascript',
        body: ''
      }));
      await page.goto(`http://127.0.0.1:${port}/${filename}${filename === 'creative.html' ? '?demo=1' : ''}`, { waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(filename === 'index.html' ? 650 : 250);

      const state = await page.evaluate(() => {
        const visible = element => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
        };
        const overflow = [...document.querySelectorAll('body *')].filter(element => {
          const rect = element.getBoundingClientRect();
          return visible(element) && (rect.right > innerWidth + 1 || rect.left < -1);
        }).slice(0, 5).map(element => ({
          tag: element.tagName.toLowerCase(),
          id: element.id,
          className: typeof element.className === 'string' ? element.className : '',
          rect: element.getBoundingClientRect().toJSON()
        }));
        const infiniteAnimations = document.getAnimations().filter(animation => {
          const target = animation.effect?.target;
          return animation.playState === 'running' && animation.effect?.getTiming().iterations === Infinity && target && visible(target);
        }).map(animation => animation.animationName || animation.effect?.target?.className || 'unnamed');
        const primarySurface = document.querySelector('main,.lock-screen');
        return {
          title: document.title,
          overflowWidth: document.documentElement.scrollWidth - innerWidth,
          overflow,
          visibleMain: Boolean(primarySurface && visible(primarySurface)),
          infiniteAnimations,
          visibleVideoDates: [...document.querySelectorAll('.card-date,.date')].filter(visible).map(element => element.textContent.trim()),
          videoLoadError: document.querySelector('#video-sync-status')?.dataset.error === 'true',
          videoRetry: Boolean(document.querySelector('#video-sync-status button')),
          videoCount: document.querySelector('#hero-count')?.textContent.trim()
        };
      });

      if (errors.length) throw new Error(`${filename} ${variant.name} has runtime errors: ${errors.join(' | ')}`);
      if (!state.title || !state.visibleMain) throw new Error(`${filename} ${variant.name} has no visible main content`);
      if (state.overflowWidth > 1) throw new Error(`${filename} ${variant.name} overflows horizontally by ${state.overflowWidth}px: ${JSON.stringify(state.overflow)}`);
      if (variant.reducedMotion === 'reduce' && state.infiniteAnimations.length) {
        throw new Error(`${filename} keeps infinite animations under reduced motion: ${JSON.stringify(state.infiniteAnimations)}`);
      }
      if (['video.html', 'vlog.html', 'dancee.html'].includes(filename) && state.visibleVideoDates.length) {
        throw new Error(`${filename} ${variant.name} shows dates under video cards: ${JSON.stringify(state.visibleVideoDates)}`);
      }
      if (filename === 'video.html' && state.videoLoadError && (!state.videoRetry || state.videoCount !== '— FILMS')) {
        throw new Error('video.html makes a cloud read failure look like an empty collection');
      }
      await page.close();
    }
  }
  const fallbackPage = await browser.newPage();
  await fallbackPage.addInitScript(() => { window.WebGLRenderingContext = undefined; });
  await fallbackPage.route('**/cloud-photo-source.js*', route => route.fulfill({
    contentType: 'text/javascript',
    body: 'window.MemoryUniversePhotoSource = async () => [];'
  }));
  await fallbackPage.goto(`http://127.0.0.1:${port}/creative.html`, { waitUntil: 'networkidle' });
  const emptyFallback = await fallbackPage.locator('.memory-universe__empty').isVisible();
  const blankFallback = await fallbackPage.locator('.memory-universe__fallback').isVisible();
  if (!emptyFallback || blankFallback) throw new Error('creative.html has a blank fallback when no photos exist');
  await fallbackPage.close();
  const photoFallback = await browser.newPage();
  await photoFallback.addInitScript(() => { window.WebGLRenderingContext = undefined; });
  await photoFallback.goto(`http://127.0.0.1:${port}/creative.html?demo=1`, { waitUntil: 'networkidle' });
  if (await photoFallback.locator('.memory-universe__fallback-grid a[target="_blank"]').count() !== 8) {
    throw new Error('creative.html fallback does not allow every photo to be enlarged');
  }
  await photoFallback.close();
  const layoutPage = await browser.newPage();
  await layoutPage.goto(`http://127.0.0.1:${port}/creative.html?demo=1`, { waitUntil: 'networkidle' });
  const layoutCounts = await layoutPage.evaluate(async () => {
    const { MemoryUniverse } = await import('./assets/memory-universe/memory-universe.js');
    const universe = new MemoryUniverse(document.querySelector('#memory-universe'));
    return [100, 300].map(count => universe.createLayout(count).length);
  });
  if (layoutCounts.join(',') !== '100,300') throw new Error(`creative.html lost photos in larger layouts: ${layoutCounts}`);
  await layoutPage.close();
  console.log(`site UI runtime check passed (${pages.length * variants.length} page variants)`);
} finally {
  await browser.close();
  server.close();
}
