'use strict';

const { readFileSync } = require('node:fs');
const { runInNewContext } = require('node:vm');
const test = require('node:test');
const assert = require('node:assert/strict');

const source = readFileSync(require.resolve('./cloud-memory-library.js'), 'utf8');

function loadLibrary(responses = {}) {
  const calls = [];
  const timers = [];
  const window = {
    CloudBaseClient: {
      call: async (action, payload) => {
        calls.push({ action, payload });
        return responses[action] || [];
      },
      status: () => ({ ready: true, mode: 'cloud', reason: '' })
    }
  };
  runInNewContext(source, {
    window,
    Intl,
    Date,
    Math,
    String,
    Number,
    Array,
    Promise,
    Error,
    setTimeout: (callback, delay) => { timers.push({ callback, delay }); return timers.length; }
  });
  return { library: window.MemoryLibrary, calls, timers };
}

const event = {
  id: '11111111-1111-4111-8111-111111111111',
  kind: 'event',
  title: '第一次旅行',
  date: '2026-10-26',
  eventType: 'major',
  place: '上海',
  story: '测试事件',
  images: []
};

const pendingImage = {
  id: '22222222-2222-4222-8222-222222222222',
  data: 'data:image/jpeg;base64,/9j/2Q==',
  filename: 'test.jpg',
  mimeType: 'image/jpeg',
  caption: '测试照片',
  uploadedAt: '2026-10-26',
  remote: false
};

test('new events and photos are written only through cloud-function actions', async () => {
  const { library, calls } = loadLibrary();
  await library.put({ ...event, images: [pendingImage] });
  assert.deepEqual(calls.map(call => call.action), ['createMemory', 'addPhoto']);
  assert.equal(calls[1].payload.memoryId, event.id);
  assert.equal(calls[1].payload.photo.base64, '/9j/2Q==');
});

test('existing remote photos are not uploaded again when an event is edited', async () => {
  const remoteImage = { ...pendingImage, remote: true, data: 'https://example.test/signed.jpg' };
  const { library, calls } = loadLibrary({ listMemories: [{ ...event, images: [remoteImage] }] });
  await library.all();
  await library.put({ ...event, title: '修改后的标题', images: [remoteImage] });
  assert.deepEqual(calls.map(call => call.action), ['listMemories', 'updateMemory']);
});

test('editing an existing standalone photo keeps its image and updates its story', async () => {
  const remoteImage = { ...pendingImage, remote: true, data: 'https://example.test/signed.jpg' };
  const saved = { ...event, kind: 'photo', title: '一张照片', images: [remoteImage] };
  const { library, calls } = loadLibrary({ listMemories: [saved] });
  await library.all();
  await library.put({ ...saved, story: '后来补上的故事' });
  assert.deepEqual(calls.map(call => call.action), ['listMemories', 'updateMemory']);
  assert.equal(calls[1].payload.story, '后来补上的故事');
});

test('standalone photos and deletion use their dedicated server actions', async () => {
  const { library, calls, timers } = loadLibrary();
  await library.put({ ...event, kind: 'photo', title: '独立照片', images: [pendingImage] });
  await library.remove(event.id);
  await library.removePhoto(pendingImage.id);
  assert.deepEqual(calls.map(call => call.action), [
    'createStandalonePhoto', 'softDeleteMemory', 'softDeletePhoto'
  ]);
  assert.equal(timers.length, 2);
  assert.ok(timers.every(timer => timer.delay === 7600));
});
