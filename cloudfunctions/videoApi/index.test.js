'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

let currentUid = 'visitor';
const rows = [];
const members = [{ uid: 'owner', role: 'owner', active: true }, { uid: 'editor', role: 'editor', active: false }];
const db = {
  from(table) {
    const filters = [];
    let operation = 'select';
    let values;
    const builder = {
      select() { return builder; },
      eq(key, value) { filters.push([key, value]); return builder; },
      limit() { return builder; },
      order() { return builder; },
      insert(value) { operation = 'insert'; values = value; return builder; },
      update(value) { operation = 'update'; values = value; return builder; },
      then(resolve, reject) {
        try {
          const source = table === 'archive_members' ? members : rows;
          const matches = source.filter(row => filters.every(([key, value]) => row[key] === value));
          if (operation === 'insert') rows.push(values);
          if (operation === 'update') matches.forEach(row => Object.assign(row, values));
          return Promise.resolve({ data: operation === 'select' ? matches : [], error: null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      }
    };
    return builder;
  }
};
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === '@cloudbase/node-sdk') return {
    SYMBOL_CURRENT_ENV: 'test',
    init: () => ({ auth: () => ({ getUserInfo: () => ({ uid: currentUid }) }), rdb: () => db })
  };
  return originalLoad.call(this, request, parent, isMain);
};
const { main } = require('./index');
Module._load = originalLoad;

test('visitors can read but cannot add, remove or change covers', async () => {
  currentUid = 'visitor';
  assert.deepEqual((await main({ action: 'listVideos', payload: {} })).data, { vlog: [], dancee: [] });
  for (const action of ['addVideo', 'removeVideo', 'setVideoCover']) {
    assert.equal((await main({ action, payload: {} })).code, 403);
  }
});

test('only active members can write; deleted rows stay hidden', async () => {
  const input = { category: 'vlog', url: 'https://example.com/watch', name: '片段', date: '2026.11.26', cover: '' };
  currentUid = 'editor';
  assert.equal((await main({ action: 'addVideo', payload: input })).code, 403);
  currentUid = 'owner';
  const created = await main({ action: 'addVideo', payload: input });
  assert.equal(created.ok, true);
  const updatedCover = await main({ action: 'setVideoCover', payload: { id: created.data.id, cover: 'https://example.com/cover.jpg' } });
  assert.equal(updatedCover.data.cover, 'https://example.com/cover.jpg');
  assert.equal((await main({ action: 'listVideos', payload: {} })).data.vlog.length, 1);
  assert.equal((await main({ action: 'removeVideo', payload: { id: created.data.id } })).ok, true);
  assert.equal((await main({ action: 'listVideos', payload: {} })).data.vlog.length, 0);
  assert.equal(rows.length, 1);
  assert.ok(rows[0].deleted_at);
});
