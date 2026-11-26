'use strict';

const { randomUUID } = require('crypto');
const MAX_COVER_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BUILTIN_IDS = new Set(['builtin-vlog-1', 'builtin-vlog-2']);

function payload(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('请求数据格式无效');
  return value;
}

function id(value) {
  if (typeof value !== 'string' || (!UUID.test(value) && !BUILTIN_IDS.has(value))) throw new Error('视频 ID 无效');
  return value;
}

function cleanText(value, label, limit) {
  if (typeof value !== 'string') throw new Error(`${label}必须是文字`);
  const result = value.trim();
  if (result.length > limit) throw new Error(`${label}不能超过 ${limit} 个字符`);
  return result;
}

function cover(value) {
  if (value === '') return '';
  if (typeof value === 'string' && value.length <= 2048) {
    try {
      const url = new URL(value);
      if (url.protocol === 'https:') return url.href;
    } catch (_) {}
  }
  if (typeof value !== 'string' || value.length > Math.ceil(MAX_COVER_BYTES * 4 / 3) + 60) throw new Error('封面不能超过 2 MB');
  const match = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
  if (!match) throw new Error('封面只支持 JPEG、PNG、WebP 或 GIF');
  const bytes = Buffer.from(match[2], 'base64');
  if (!bytes.length || bytes.length > MAX_COVER_BYTES || bytes.toString('base64') !== match[2]) throw new Error('封面图片数据无效或超过 2 MB');
  const type = match[1];
  const actual = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
    : bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) ? 'image/png'
    : bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP' ? 'image/webp'
    : ['GIF87a', 'GIF89a'].includes(bytes.subarray(0, 6).toString()) ? 'image/gif' : '';
  if (actual !== type) throw new Error('封面内容与文件类型不一致');
  return value;
}

function video(input) {
  const data = payload(input);
  const category = data.category;
  if (category !== 'vlog' && category !== 'dancee') throw new Error('视频分类无效');
  const url = cleanText(data.url, '链接', 2048);
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('视频链接无效'); }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('只允许 http 或 https 链接');
  const date = cleanText(data.date, '日期', 10).replaceAll('.', '-');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) throw new Error('视频日期无效');
  return { id: randomUUID(), category, url: parsed.href, name: cleanText(data.name || '', '标题', 120), date, cover: cover(data.cover || '') };
}

function shape(row) {
  const date = row.date instanceof Date ? row.date.toISOString().slice(0, 10) : String(row.date || '').slice(0, 10);
  return { id: row.id, category: row.category, url: row.url, name: row.name, date: date.replaceAll('-', '.'), cover: row.cover || '' };
}

module.exports = { payload, id, cover, video, shape };
