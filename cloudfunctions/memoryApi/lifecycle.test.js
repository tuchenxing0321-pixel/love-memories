'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runTrackedRemoval, runTrackedUpload, unfinishedUploadExpired } = require('./lifecycle');

test('cleanup leaves an in-flight upload alone and recovers old pending uploads', () => {
  const now = Date.parse('2026-11-26T12:00:00.000Z');
  assert.equal(unfinishedUploadExpired({ upload_state: 'pending', created_at: '2026-11-26T11:59:00.000Z' }, now), false);
  assert.equal(unfinishedUploadExpired({ upload_state: 'pending', created_at: '2026-11-26T11:30:00.000Z' }, now), true);
  assert.equal(unfinishedUploadExpired({ upload_state: 'pending', created_at: 'invalid' }, now), false);
  assert.equal(unfinishedUploadExpired({ upload_state: 'cleanup' }, now), true);
  assert.equal(unfinishedUploadExpired({ upload_state: 'active', created_at: '2026-11-26T00:00:00.000Z' }, now), false);
});

test('persists a pending record before uploading and activates it afterward', async () => {
  const calls = [];
  const stored = await runTrackedUpload({
    createPending: async () => calls.push('pending'),
    upload: async () => { calls.push('upload'); return { fileId: 'provider-id' }; },
    activate: async value => calls.push(`active:${value.fileId}`),
    markCleanup: async () => calls.push('cleanup')
  });
  assert.deepEqual(calls, ['pending', 'upload', 'active:provider-id']);
  assert.equal(stored.fileId, 'provider-id');
});

test('keeps the pre-existing pending record trackable when activation fails', async () => {
  const state = { pending: false, cleanup: false };
  await assert.rejects(runTrackedUpload({
    createPending: async () => { state.pending = true; },
    upload: async () => ({ fileId: 'provider-id' }),
    activate: async () => { throw new Error('database unavailable'); },
    markCleanup: async () => { state.cleanup = true; }
  }), /database unavailable/);
  assert.deepEqual(state, { pending: true, cleanup: true });
});

test('the pending record still exists even if marking cleanup also fails', async () => {
  const state = { pending: false };
  await assert.rejects(runTrackedUpload({
    createPending: async () => { state.pending = true; },
    upload: async () => ({ fileId: 'provider-id' }),
    activate: async () => { throw new Error('activation failed'); },
    markCleanup: async () => { throw new Error('marker failed'); }
  }), /activation failed/);
  assert.equal(state.pending, true);
});

test('a storage deletion failure is recorded and the database row stays active', async () => {
  const state = { deleted: false, error: '' };
  await assert.rejects(runTrackedRemoval({
    remove: async () => { throw new Error('storage unavailable'); },
    markDeleted: async () => { state.deleted = true; },
    markError: async error => { state.error = error.message; }
  }), /storage unavailable/);
  assert.deepEqual(state, { deleted: false, error: 'storage unavailable' });
});

test('a database update failure after storage removal is also recorded for retry', async () => {
  const state = { removed: false, error: '' };
  await assert.rejects(runTrackedRemoval({
    remove: async () => { state.removed = true; },
    markDeleted: async () => { throw new Error('database unavailable'); },
    markError: async error => { state.error = error.message; }
  }), /database unavailable/);
  assert.deepEqual(state, { removed: true, error: 'database unavailable' });
});

test('a successful storage removal is marked before the row can be deleted', async () => {
  const calls = [];
  await runTrackedRemoval({
    remove: async () => calls.push('storage removed'),
    markDeleted: async () => calls.push('tracked as removed'),
    markError: async () => calls.push('error')
  });
  assert.deepEqual(calls, ['storage removed', 'tracked as removed']);
});
