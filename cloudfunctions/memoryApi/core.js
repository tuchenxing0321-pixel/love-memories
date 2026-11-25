'use strict';

const TITLE_MAX = 60;
const PLACE_MAX = 80;
const STORY_MAX = 1200;
const CAPTION_MAX = 120;
const FILE_NAME_MAX = 180;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const WRITE_LIMIT = 20;
const WRITE_WINDOW_SECONDS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif'
});
const MIME_TYPES = new Set(Object.keys(MIME_EXTENSIONS));

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validatePayload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('请求数据格式无效');
  }
  return value;
}

function validateId(value, label = '记录') {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${label} ID 无效`);
  return value;
}

function extensionForMime(mimeType) {
  const extension = MIME_EXTENSIONS[mimeType];
  if (!extension) throw new Error('照片文件类型无效');
  return extension;
}

function objectKeyFor(memoryId, photoId, mimeType) {
  const validMemoryId = validateId(memoryId, '回忆');
  const validPhotoId = validateId(photoId, '照片');
  return `shared-memories/${validMemoryId}/${validPhotoId}.${extensionForMime(mimeType)}`;
}

function validateObjectKey(value, memoryId, photoId, mimeType) {
  if (typeof value !== 'string' || value !== objectKeyFor(memoryId, photoId, mimeType)) {
    throw new Error('照片文件路径无效');
  }
  return value;
}

function text(value, label, max, required = false) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new Error(`${label}必须是字符串`);
  const result = value.trim();
  if (required && !result) throw new Error(`请填写${label}`);
  if (result.length > max) throw new Error(`${label}不能超过 ${max} 个字符`);
  return result;
}

function validateMemory(value) {
  const payload = validatePayload(value);
  const kind = payload.kind === 'photo' ? 'photo' : payload.kind === 'event' ? 'event' : '';
  if (!kind) throw new Error('回忆类型无效');
  if (!validDate(payload.date)) throw new Error('请填写有效日期');
  const eventType = payload.eventType === 'major' ? 'major' : 'minor';
  return {
    kind,
    title: text(payload.title, '标题', TITLE_MAX, true),
    date: payload.date,
    eventType,
    place: text(payload.place, '地点', PLACE_MAX),
    story: text(payload.story, '事件内容', STORY_MAX),
    sortOrder: Number.isSafeInteger(payload.sortOrder) ? payload.sortOrder : 0
  };
}

function bytesFromBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new Error('图片数据格式无效');
  }
  const buffer = Buffer.from(value, 'base64');
  if (!buffer.length || buffer.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) {
    throw new Error('图片数据格式无效');
  }
  if (buffer.length > IMAGE_MAX_BYTES) throw new Error('单张图片不能超过 2 MB');
  return buffer;
}

function detectedMime(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buffer.subarray(0, 6).toString() === 'GIF87a' || buffer.subarray(0, 6).toString() === 'GIF89a') return 'image/gif';
  return '';
}

function validatePhoto(value) {
  const payload = validatePayload(value);
  const id = validateId(payload.id, '照片');
  const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType.toLowerCase() : '';
  if (!MIME_TYPES.has(mimeType)) throw new Error('只允许 JPEG、PNG、WebP 或 GIF 图片');
  const buffer = bytesFromBase64(payload.base64);
  if (detectedMime(buffer) !== mimeType) throw new Error('图片内容与文件类型不一致');
  return {
    id,
    mimeType,
    buffer,
    filename: text(payload.filename || '回忆照片', '文件名', FILE_NAME_MAX, true),
    caption: text(payload.caption, '照片说明', CAPTION_MAX),
    uploadedAt: validDate(payload.uploadedAt) ? payload.uploadedAt : null,
    sortOrder: Number.isSafeInteger(payload.sortOrder) ? payload.sortOrder : 0
  };
}

module.exports = {
  IMAGE_MAX_BYTES,
  WRITE_LIMIT,
  WRITE_WINDOW_SECONDS,
  detectedMime,
  objectKeyFor,
  validDate,
  validateId,
  validateMemory,
  validateObjectKey,
  validatePayload,
  validatePhoto
};
