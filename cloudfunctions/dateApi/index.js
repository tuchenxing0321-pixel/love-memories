'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const { randomUUID } = require('crypto');
const {
  WRITE_LIMIT,
  WRITE_WINDOW_SECONDS,
  shapeDate,
  validateDate,
  validateId,
  validatePayload
} = require('./core');

const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV,
  accessKey: process.env.CLOUDBASE_APIKEY,
});
const auth = app.auth();
const db = app.rdb({ database: 'public' });
const ok = (data) => ({ ok: true, data });
const fail = (error, code = 400) => ({ ok: false, code, error });

function uidFrom() {
  const { uid } = auth.getUserInfo();
  if (!uid) {
    const error = new Error('匿名身份无效，请刷新页面后重试');
    error.status = 401;
    throw error;
  }
  return uid;
}

async function accessFor(uid) {
  const rows = await query(db.from('archive_members').select('uid,role,display_name,active')
    .eq('uid', uid).eq('active', true).limit(1));
  const member = rows[0];
  return {
    uid,
    role: member?.role || 'viewer',
    displayName: member?.display_name || '',
    canWrite: member?.role === 'owner' || member?.role === 'editor',
    isOwner: member?.role === 'owner'
  };
}

async function requireWriter(uid) {
  const access = await accessFor(uid);
  if (!access.canWrite) {
    const error = new Error('仅主人和已授权管理员可以修改');
    error.status = 403;
    throw error;
  }
}

async function query(builder) {
  const { data, error } = await builder;
  if (error) {
    const problem = new Error(error.message || '数据库操作失败');
    problem.status = error.status || 500;
    throw problem;
  }
  return data || [];
}

async function one(id) {
  return (await query(db.from('important_dates').select('*').eq('id', id).limit(1)))[0] || null;
}

async function takeWriteSlot(uid) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rows = await query(db.from('date_write_rate_limits').select('*').eq('actor_uid', uid).limit(1));
    const current = rows[0];
    const now = new Date().toISOString();

    if (!current) {
      try {
        await query(db.from('date_write_rate_limits').insert({
          actor_uid: uid,
          window_started_at: now,
          write_count: 1
        }));
        return;
      } catch (error) {
        if (/duplicate|unique|23505/i.test(error.message || '')) continue;
        throw error;
      }
    }

    const expired = Date.parse(current.window_started_at) <= Date.now() - WRITE_WINDOW_SECONDS * 1000;
    if (expired) {
      const updated = await query(db.from('date_write_rate_limits').update({
        window_started_at: now,
        write_count: 1
      }).eq('actor_uid', uid).eq('window_started_at', current.window_started_at).select('actor_uid'));
      if (updated.length) return;
      continue;
    }

    if (Number(current.write_count) >= WRITE_LIMIT) break;
    const updated = await query(db.from('date_write_rate_limits').update({
      write_count: Number(current.write_count) + 1
    }).eq('actor_uid', uid).eq('write_count', current.write_count).select('actor_uid'));
    if (updated.length) return;
  }

  const problem = new Error('操作太频繁，请一分钟后再试');
  problem.status = 429;
  throw problem;
}

exports.main = async (event, context) => {
  try {
    const uid = uidFrom();
    const action = typeof event?.action === 'string' ? event.action : '';
    const payload = validatePayload(event?.payload);

    if (action === 'listDates') {
      const rows = await query(db.from('important_dates').select('*')
        .order('date', { ascending: true }).order('created_at', { ascending: true }));
      return ok(rows.map(shapeDate));
    }

    if (action === 'getAccess') return ok(await accessFor(uid));

    await requireWriter(uid);

    if (action === 'createDate') {
      const date = validateDate(payload);
      await takeWriteSlot(uid);
      const id = randomUUID();
      await query(db.from('important_dates').insert({
        id,
        ...date,
        created_by_uid: uid,
        updated_by_uid: uid
      }));
      return ok(shapeDate(await one(id)));
    }

    if (action === 'updateDate') {
      const id = validateId(payload.id);
      const date = validateDate(payload);
      if (!(await one(id))) return fail('日期不存在', 404);
      await takeWriteSlot(uid);
      await query(db.from('important_dates').update({
        ...date,
        updated_by_uid: uid,
        updated_at: new Date().toISOString()
      }).eq('id', id));
      return ok(shapeDate(await one(id)));
    }

    if (action === 'deleteDate') {
      const id = validateId(payload.id);
      if (!(await one(id))) return fail('日期不存在', 404);
      await takeWriteSlot(uid);
      await query(db.from('important_dates').delete().eq('id', id));
      return ok({ id });
    }

    return fail('未知操作', 404);
  } catch (error) {
    console.error('dateApi failed', error);
    return fail(error.message || '服务暂时不可用', error.status || 500);
  }
};
