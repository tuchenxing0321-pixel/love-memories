'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  IMAGE_MAX_BYTES,
  objectKeyFor,
  validateId,
  validateMemory,
  validateObjectKey,
  validatePhoto
} = require('./core');

const uuid = '123e4567-e89b-42d3-a456-426614174000';
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]).toString('base64');

test('accepts and trims a valid event', () => {
  assert.deepEqual(validateMemory({ kind: 'event', title: '  第一次旅行  ', date: '2026-10-26',
    eventType: 'major', place: '  宜昌 ', story: ' 故事 ' }), {
    kind: 'event', title: '第一次旅行', date: '2026-10-26', eventType: 'major',
    place: '宜昌', story: '故事', sortOrder: 0
  });
});

test('rejects invalid dates and oversized memory text', () => {
  assert.throws(() => validateMemory({ kind: 'event', title: '标题', date: '2026-02-30' }), /有效日期/);
  assert.throws(() => validateMemory({ kind: 'event', title: 'x'.repeat(61), date: '2026-10-26' }), /60/);
  assert.throws(() => validateMemory({ kind: 'event', title: '标题', date: '2026-10-26', story: 'x'.repeat(1201) }), /1200/);
});

test('accepts a valid JPEG and rejects MIME spoofing', () => {
  const photo = validatePhoto({ id: uuid, mimeType: 'image/jpeg', base64: jpeg,
    filename: 'test.jpg', uploadedAt: '2026-10-26' });
  assert.equal(photo.buffer.length, 4);
  assert.throws(() => validatePhoto({ id: uuid, mimeType: 'image/png', base64: jpeg, filename: 'x.png' }), /不一致/);
});

test('rejects invalid identifiers, formats and oversized files', () => {
  assert.throws(() => validateId('../escape'), /ID/);
  assert.throws(() => validatePhoto({ id: uuid, mimeType: 'text/html', base64: jpeg, filename: 'x.html' }), /只允许/);
  const oversized = Buffer.alloc(IMAGE_MAX_BYTES + 1, 1).toString('base64');
  assert.throws(() => validatePhoto({ id: uuid, mimeType: 'image/jpeg', base64: oversized, filename: 'x.jpg' }), /2 MB/);
});

test('accepts only the exact server-generated storage path for a photo row', () => {
  const memoryId = '550e8400-e29b-41d4-a716-446655440000';
  assert.equal(
    objectKeyFor(memoryId, uuid, 'image/jpeg'),
    `shared-memories/${memoryId}/${uuid}.jpg`
  );
  assert.equal(
    validateObjectKey(`shared-memories/${memoryId}/${uuid}.jpg`, memoryId, uuid, 'image/jpeg'),
    `shared-memories/${memoryId}/${uuid}.jpg`
  );

  assert.throws(
    () => validateObjectKey(`shared-memories/${memoryId}/../${uuid}.jpg`, memoryId, uuid, 'image/jpeg'),
    /路径无效/
  );
  assert.throws(
    () => validateObjectKey(`shared-memories/${uuid}/${uuid}.jpg`, memoryId, uuid, 'image/jpeg'),
    /路径无效/
  );
  assert.throws(
    () => validateObjectKey(`shared-memories/${memoryId}/${uuid}.exe`, memoryId, uuid, 'image/jpeg'),
    /路径无效/
  );
  assert.throws(
    () => validateObjectKey(`shared-memories/${memoryId}/${uuid}.png`, memoryId, uuid, 'image/jpeg'),
    /路径无效/
  );
});
