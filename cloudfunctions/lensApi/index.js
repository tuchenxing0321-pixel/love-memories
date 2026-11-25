'use strict';

const crypto = require('crypto');
const cloudbase = require('@cloudbase/node-sdk');
const {
  constantTimeEqual,
  normalizeNickname,
  objectKeyFor,
  signSession,
  validateId,
  validatePhoto,
  verifySession
} = require('./core');

const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV,
  accessKey: process.env.CLOUDBASE_APIKEY
});
const auth = app.auth();
const db = app.rdb({ database: 'public' });
const bucket = () => app.storage.from('lens-photos').throwOnError();
const ok = data => ({ ok: true, data });
const fail = (error, code = 400) => ({ ok: false, code, error });
const iso = () => new Date().toISOString();
const ACCESS_KEY = process.env.LENS_ACCESS_KEY || '';
const SESSION_SECRET = process.env.LENS_SESSION_SECRET || '';

async function query(builder) {
  const { data, error } = await builder;
  if (error) {
    const problem = new Error(error.message || '数据库操作失败');
    problem.status = error.status || 500;
    throw problem;
  }
  return data || [];
}

function uidFrom(required = true) {
  const { uid } = auth.getUserInfo();
  if (!uid && required) {
    const error = new Error('无法建立安全连接，请刷新后重试');
    error.status = 401;
    throw error;
  }
  return uid || '';
}

async function memberFor(uid) {
  const rows = await query(db.from('archive_members').select('uid,role,display_name,active')
    .eq('uid', uid).eq('active', true).limit(1));
  const member = rows[0];
  if (!member || !['owner', 'editor'].includes(member.role)) return null;
  return member;
}

async function actorFor(event, allowMissing = false) {
  const uid = uidFrom(false);
  const member = uid ? await memberFor(uid) : null;
  if (member) {
    return {
      kind: 'manager',
      role: member.role,
      ownerId: crypto.createHash('sha256').update(`cloudbase:${uid}`).digest('hex'),
      nickname: member.display_name || (member.role === 'owner' ? '主人' : '管理员'),
      canManage: true
    };
  }
  const token = typeof event?.token === 'string' ? event.token : '';
  if (!token && allowMissing) return null;
  const visitor = verifySession(token, SESSION_SECRET, ACCESS_KEY);
  return { kind: 'visitor', role: 'visitor', ownerId: visitor.sub, nickname: visitor.nickname, canManage: false };
}

async function takeSlot(actorId, limit = 20, seconds = 60) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rows = await query(db.from('lens_rate_limits').select('*').eq('actor_id', actorId).limit(1));
    const current = rows[0];
    const now = iso();
    if (!current) {
      try {
        await query(db.from('lens_rate_limits').insert({ actor_id: actorId, window_started_at: now, write_count: 1 }));
        return;
      } catch (error) {
        if (/duplicate|unique|23505/i.test(error.message || '')) continue;
        throw error;
      }
    }
    const expired = Date.parse(current.window_started_at) <= Date.now() - seconds * 1000;
    if (expired) {
      const changed = await query(db.from('lens_rate_limits').update({ window_started_at: now, write_count: 1 })
        .eq('actor_id', actorId).eq('window_started_at', current.window_started_at).select('actor_id'));
      if (changed.length) return;
      continue;
    }
    if (Number(current.write_count) >= limit) break;
    const changed = await query(db.from('lens_rate_limits').update({ write_count: Number(current.write_count) + 1 })
      .eq('actor_id', actorId).eq('write_count', current.write_count).select('actor_id'));
    if (changed.length) return;
  }
  const error = new Error('操作太频繁，请稍后再试');
  error.status = 429;
  throw error;
}

async function rowsWithUrls(rows) {
  const urls = new Map();
  for (let index = 0; index < rows.length; index += 50) {
    const batch = rows.slice(index, index + 50);
    const { data } = await bucket().createSignedUrls(batch.map(row => row.object_key), 3600);
    for (const item of data || []) if (!item.error) urls.set(item.path, item.fullSignedURL || '');
  }
  return rows.map(row => ({ row, url: urls.get(row.object_key) || '' })).filter(item => item.url);
}

async function listPhotos(actor) {
  const rows = await query(db.from('lens_photos').select('*').order('created_at', { ascending: false }));
  const resolved = await rowsWithUrls(rows);
  return resolved.map(({ row, url }) => {
    const mine = row.owner_id === actor.ownerId;
    return {
      id: row.id,
      url,
      note: row.note || '',
      createdAt: row.created_at,
      mine,
      canEdit: actor.canManage || mine,
      ownerNickname: actor.canManage ? row.owner_nickname : mine ? actor.nickname : ''
    };
  });
}

async function photoById(id) {
  return (await query(db.from('lens_photos').select('*').eq('id', id).limit(1)))[0] || null;
}

function requireOwnership(row, actor) {
  if (!row) {
    const error = new Error('照片不存在');
    error.status = 404;
    throw error;
  }
  if (!actor.canManage && row.owner_id !== actor.ownerId) {
    const error = new Error('你只能修改自己添加的照片');
    error.status = 403;
    throw error;
  }
}

async function addPhoto(payload, actor) {
  const photo = validatePhoto(payload);
  const objectKey = objectKeyFor(photo.id, photo.mimeType);
  await takeSlot(actor.ownerId);
  const { data } = await bucket().upload(objectKey, photo.buffer, { contentType: photo.mimeType, upsert: false });
  const fileId = String(data?.id || '');
  if (!fileId || fileId.length > 512) {
    try { await bucket().remove([objectKey]); } catch (_) {}
    throw new Error('云存储未返回有效文件 ID');
  }
  try {
    await query(db.from('lens_photos').insert({
      id: photo.id,
      object_key: objectKey,
      file_id: fileId,
      filename: photo.filename,
      mime_type: photo.mimeType,
      size_bytes: photo.buffer.length,
      note: photo.note,
      owner_id: actor.ownerId,
      owner_nickname: actor.nickname,
      created_at: iso(),
      updated_at: iso()
    }));
  } catch (error) {
    try { await bucket().remove([objectKey]); } catch (_) {}
    throw error;
  }
  return { id: photo.id };
}

exports.main = async event => {
  try {
    const action = typeof event?.action === 'string' ? event.action : '';
    const payload = event?.payload && typeof event.payload === 'object' && !Array.isArray(event.payload) ? event.payload : {};

    if (action === 'login') {
      if (!ACCESS_KEY || !SESSION_SECRET) return fail('你的镜头尚未完成服务端配置', 503);
      const nickname = normalizeNickname(payload.nickname);
      const loginActor = crypto.createHash('sha256').update(`login:${nickname.toLocaleLowerCase('zh-CN')}`).digest('hex');
      await takeSlot(`login:${loginActor}`, 10, 10 * 60);
      if (!constantTimeEqual(payload.key, ACCESS_KEY)) return fail('共享密钥不正确', 401);
      const session = signSession(nickname, SESSION_SECRET, ACCESS_KEY);
      return ok({ token: session.token, nickname: session.identity.nickname, expiresAt: session.identity.exp * 1000, role: 'visitor' });
    }

    const actor = await actorFor(event, action === 'getSession');
    if (action === 'getSession') {
      if (!actor) return ok({ authenticated: false });
      return ok({ authenticated: true, nickname: actor.nickname, role: actor.role, canManage: actor.canManage });
    }
    if (!actor) return fail('请先输入昵称和共享密钥', 401);
    if (action === 'list') return ok({ access: { nickname: actor.nickname, role: actor.role, canManage: actor.canManage }, photos: await listPhotos(actor) });
    if (action === 'add') return ok(await addPhoto(payload, actor));

    const id = validateId(payload.id);
    const row = await photoById(id);
    requireOwnership(row, actor);
    await takeSlot(actor.ownerId);
    if (action === 'update') {
      const note = typeof payload.note === 'string' ? payload.note.trim() : '';
      if (note.length > 160) return fail('照片说明不能超过 160 个字符');
      await query(db.from('lens_photos').update({ note, updated_at: iso() }).eq('id', id));
      return ok({ id });
    }
    if (action === 'remove') {
      await bucket().remove([row.object_key]);
      await query(db.from('lens_photos').delete().eq('id', id));
      return ok({ id });
    }
    return fail('未知操作', 404);
  } catch (error) {
    console.error('lensApi failed', error);
    return fail(error.message || '服务暂时不可用', error.status || 500);
  }
};
