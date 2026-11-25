'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeNickname, objectKeyFor, signSession, verifySession } = require('./core');

const secret = 'a-long-session-secret';
const accessKey = 'shared-key-v1';
const now = Date.UTC(2026, 10, 16);

test('normalizes a nickname without silently accepting markup', () => {
  assert.equal(normalizeNickname('  Xiao   Lin  '), 'Xiao Lin');
  assert.throws(() => normalizeNickname('<admin>'), /不可用/);
});

test('signs and verifies the same visitor identity', () => {
  const session = signSession('小林', secret, accessKey, now);
  const identity = verifySession(session.token, secret, accessKey, now + 1000);
  assert.equal(identity.nickname, '小林');
  assert.equal(identity.sub, session.identity.sub);
});

test('rotating the shared key revokes existing visitor sessions', () => {
  const session = signSession('小林', secret, accessKey, now);
  assert.throws(() => verifySession(session.token, secret, 'shared-key-v2', now + 1000), /已失效/);
});

test('expired and tampered visitor sessions are rejected', () => {
  const session = signSession('小林', secret, accessKey, now);
  assert.throws(() => verifySession(`${session.token}x`, secret, accessKey, now + 1000), /已失效/);
  assert.throws(() => verifySession(session.token, secret, accessKey, now + 31 * 86400000), /已失效/);
});

test('builds a server-controlled storage path', () => {
  assert.equal(objectKeyFor('123e4567-e89b-42d3-a456-426614174000', 'image/webp'), 'lens-photos/123e4567-e89b-42d3-a456-426614174000.webp');
});
