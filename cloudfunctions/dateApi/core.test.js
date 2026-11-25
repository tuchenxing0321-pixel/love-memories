'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateDate, validateId, validatePayload, validDate } = require('./core');

test('accepts and trims a valid date record', () => {
  assert.deepEqual(validateDate({ title: '  第一次旅行  ', date: '2026-10-24', note: '  武汉  ' }), {
    title: '第一次旅行',
    date: '2026-10-24',
    note: '武汉'
  });
});

test('rejects invalid calendar dates and oversized text', () => {
  assert.equal(validDate('2026-02-30'), false);
  assert.throws(() => validateDate({ title: '旅行', date: '2026-02-30' }), /有效日期/);
  assert.throws(() => validateDate({ title: 'x'.repeat(41), date: '2026-10-24' }), /40/);
  assert.throws(() => validateDate({ title: '旅行', date: '2026-10-24', note: 'x'.repeat(121) }), /120/);
});

test('rejects non-string fields instead of coercing them', () => {
  assert.equal(validDate(['2026-10-24']), false);
  assert.throws(() => validateDate(null), /格式无效/);
  assert.throws(() => validateDate({ title: {}, date: '2026-10-24', note: '' }), /必须是字符串/);
  assert.throws(() => validateDate({ title: '旅行', date: ['2026-10-24'], note: '' }), /必须是字符串/);
  assert.throws(() => validateDate({ title: '旅行', date: '2026-10-24', note: 123 }), /备注必须是字符串/);
});

test('accepts only object request payloads', () => {
  assert.deepEqual(validatePayload(undefined), {});
  assert.deepEqual(validatePayload({ id: 'x' }), { id: 'x' });
  assert.throws(() => validatePayload(null), /请求数据格式无效/);
  assert.throws(() => validatePayload([]), /请求数据格式无效/);
  assert.throws(() => validatePayload('id=x'), /请求数据格式无效/);
});

test('accepts only UUID record identifiers', () => {
  assert.equal(validateId('550e8400-e29b-41d4-a716-446655440000'), '550e8400-e29b-41d4-a716-446655440000');
  assert.throws(() => validateId('../other-record'), /ID 无效/);
  assert.throws(() => validateId(['550e8400-e29b-41d4-a716-446655440000']), /ID 无效/);
});
