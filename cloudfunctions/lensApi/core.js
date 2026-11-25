'use strict';

const crypto = require('crypto');

const NICKNAME_MAX = 24;
const NOTE_MAX = 160;
const FILE_NAME_MAX = 180;
const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MIME_EXTENSIONS = Object.freeze({
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp'
});

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function normalizeNickname(value) {
  if (typeof value !== 'string') throw new Error('请输入你的昵称');
  const nickname = value.trim().replace(/\s+/g, ' ');
  if (!nickname) throw new Error('请输入你的昵称');
  if (nickname.length > NICKNAME_MAX) throw new Error(`昵称不能超过 ${NICKNAME_MAX} 个字符`);
  if (/[<>\u0000-\u001f\u007f]/.test(nickname)) throw new Error('昵称包含不可用字符');
  return nickname;
}

function text(value, label, max) {
  if (value === undefined || value === null) value = '';
  if (typeof value !== 'string') throw new Error(`${label}格式无效`);
  const result = value.trim();
  if (result.length > max) throw new Error(`${label}不能超过 ${max} 个字符`);
  return result;
}

function validateId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('照片 ID 无效');
  return value;
}

function bytesFromBase64(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) throw new Error('照片数据格式无效');
  const buffer = Buffer.from(value, 'base64');
  if (!buffer.length || buffer.toString('base64').replace(/=+$/, '') !== value.replace(/=+$/, '')) throw new Error('照片数据格式无效');
  if (buffer.length > IMAGE_MAX_BYTES) throw new Error('单张照片不能超过 2 MB');
  return buffer;
}

function detectedMime(buffer) {
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]))) return 'image/png';
  if (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return '';
}

function validatePhoto(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('照片数据格式无效');
  const id = validateId(value.id);
  const mimeType = typeof value.mimeType === 'string' ? value.mimeType.toLowerCase() : '';
  if (!MIME_EXTENSIONS[mimeType]) throw new Error('只允许 JPEG、PNG 或 WebP 图片');
  const buffer = bytesFromBase64(value.base64);
  if (detectedMime(buffer) !== mimeType) throw new Error('照片内容与文件类型不一致');
  return {
    id,
    mimeType,
    buffer,
    filename: text(value.filename || '投稿照片', '文件名', FILE_NAME_MAX),
    note: text(value.note, '照片说明', NOTE_MAX)
  };
}

function signingKey(secret, accessKey) {
  if (!secret || !accessKey) throw new Error('你的镜头尚未完成服务端配置');
  return crypto.createHash('sha256').update(`${secret}\0${accessKey}`).digest();
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function signSession(nickname, secret, accessKey, now = Date.now()) {
  const clean = normalizeNickname(nickname);
  const key = signingKey(secret, accessKey);
  const subject = crypto.createHmac('sha256', key).update(clean.toLocaleLowerCase('zh-CN')).digest('hex');
  const payload = { v: 1, sub: subject, nickname: clean, exp: Math.floor(now / 1000) + SESSION_SECONDS };
  const body = encode(payload);
  const signature = crypto.createHmac('sha256', key).update(body).digest('base64url');
  return { token: `${body}.${signature}`, identity: payload };
}

function verifySession(token, secret, accessKey, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 1200) throw new Error('访客登录已失效，请重新进入');
  const [body, signature, extra] = token.split('.');
  if (!body || !signature || extra) throw new Error('访客登录已失效，请重新进入');
  const key = signingKey(secret, accessKey);
  const expected = crypto.createHmac('sha256', key).update(body).digest('base64url');
  if (!constantTimeEqual(signature, expected)) throw new Error('访客登录已失效，请重新进入');
  let payload;
  try { payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (_) { throw new Error('访客登录已失效，请重新进入'); }
  if (payload?.v !== 1 || typeof payload.sub !== 'string' || payload.sub.length !== 64 || normalizeNickname(payload.nickname) !== payload.nickname || !Number.isSafeInteger(payload.exp) || payload.exp <= Math.floor(now / 1000)) {
    throw new Error('访客登录已失效，请重新进入');
  }
  return payload;
}

function objectKeyFor(id, mimeType) {
  const extension = MIME_EXTENSIONS[mimeType];
  if (!extension) throw new Error('照片文件类型无效');
  return `lens-photos/${validateId(id)}.${extension}`;
}

module.exports = {
  IMAGE_MAX_BYTES,
  SESSION_SECONDS,
  constantTimeEqual,
  detectedMime,
  normalizeNickname,
  objectKeyFor,
  signSession,
  validateId,
  validatePhoto,
  verifySession
};
