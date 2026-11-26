'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { payload, id, cover, video, shape } = require('./core');

test('accepts a video and gives it a server-generated ID', () => {
  const item = video({ category: 'vlog', url: 'https://example.com/watch', name: '  我们的片段  ', date: '2026.11.26', cover: '' });
  assert.match(item.id, /^[0-9a-f-]{36}$/);
  assert.equal(item.name, '我们的片段');
  assert.equal(shape(item).date, '2026.11.26');
});

test('rejects invalid requests and unsafe links', () => {
  assert.throws(() => payload([]));
  assert.throws(() => id('../../bad'));
  assert.equal(id('builtin-vlog-1'), 'builtin-vlog-1');
  const valid = { category: 'vlog', name: '', date: '2026.11.26', cover: '' };
  assert.throws(() => video({ ...valid, url: 'javascript:alert(1)' }), /http/);
  assert.throws(() => video({ ...valid, url: 'https://example.com', date: '2026.02.30' }), /日期/);
});

test('accepts a real image and rejects a forged or oversized cover', () => {
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
  const valid = `data:image/png;base64,${png.toString('base64')}`;
  assert.equal(cover(valid), valid);
  assert.equal(cover('https://i0.hdslb.com/test.jpg'), 'https://i0.hdslb.com/test.jpg');
  assert.throws(() => cover('javascript:alert(1)'));
  assert.throws(() => cover(valid.replace('image/png', 'image/jpeg')), /文件类型/);
  assert.throws(() => cover(`data:image/png;base64,${Buffer.alloc(2 * 1024 * 1024 + 1).toString('base64')}`), /2 MB/);
});
