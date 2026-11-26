'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('all public pages load the current shared state styles', () => {
  const pages = [
    'auth.html',
    'backup.html',
    'dancee.html',
    'dates.html',
    'index.html',
    'lens.html',
    'memories.html',
    'search.html',
    'secret.html',
    'video.html',
    'vlog.html'
  ];

  pages.forEach(page => {
    assert.match(
      read(page),
      /assets\/page-transitions\.css\?v=20261123b/,
      `${page} should use the current shared state stylesheet`
    );
  });
});

test('shared states stay accessible and motion-safe', () => {
  const styles = read('assets/page-transitions.css');

  assert.match(styles, /\.ui-state__action/);
  assert.match(styles, /min-height:\s*44px/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
});

test('data pages keep a recovery path for failed reads', () => {
  assert.match(read('search.html'), /id="searchRetry"/);
  assert.match(read('lens.html'), /'lensRetry','重新读取'/);
  assert.match(read('lens.html'), /'lensReconnect','重新连接'/);
  assert.match(read('memories.html'), /data-state-retry/);
  assert.match(read('dates.html'), /data-date-state-action/);
});

test('mobile year filters keep a full touch target', () => {
  const page = read('memories.html');
  const styles = read('assets/memories-v2.css');

  assert.match(page, /assets\/memories-v2\.css\?v=\d+[a-z]/);
  assert.match(styles, /\.year-nav button\{[^}]*min-height:44px/);
});
