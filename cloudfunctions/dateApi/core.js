'use strict';

const TITLE_MAX = 40;
const NOTE_MAX = 120;
const WRITE_LIMIT = 12;
const WRITE_WINDOW_SECONDS = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validDate(value) {
  if (typeof value !== 'string') return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validatePayload(value) {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('请求数据格式无效');
  }
  return value;
}

function validateDate(payload) {
  validatePayload(payload);
  if (typeof payload.title !== 'string' || typeof payload.date !== 'string') {
    throw new Error('标题和日期必须是字符串');
  }
  if (payload.note !== undefined && typeof payload.note !== 'string') {
    throw new Error('备注必须是字符串');
  }
  const title = payload.title.trim();
  const date = payload.date;
  const note = (payload.note || '').trim();
  if (!title) throw new Error('请填写日期标题');
  if (title.length > TITLE_MAX) throw new Error(`标题不能超过 ${TITLE_MAX} 个字符`);
  if (!validDate(date)) throw new Error('请填写有效日期');
  if (note.length > NOTE_MAX) throw new Error(`备注不能超过 ${NOTE_MAX} 个字符`);
  return { title, date, note };
}

function validateId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('日期记录 ID 无效');
  return value;
}

function shapeDate(row) {
  return {
    id: row.id,
    title: row.title,
    date: String(row.date).slice(0, 10),
    note: row.note || '',
    updatedAt: row.updated_at
  };
}

module.exports = {
  NOTE_MAX,
  TITLE_MAX,
  WRITE_LIMIT,
  WRITE_WINDOW_SECONDS,
  shapeDate,
  validDate,
  validateDate,
  validateId,
  validatePayload
};
