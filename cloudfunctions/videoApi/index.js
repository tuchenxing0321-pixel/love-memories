'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const { payload, id, cover, video, shape } = require('./core');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV, accessKey: process.env.CLOUDBASE_APIKEY });
const auth = app.auth();
const db = app.rdb({ database: 'public' });
const ok = data => ({ ok: true, data });
const fail = (error, code = 400) => ({ ok: false, code, error });

async function query(builder) {
  const { data, error } = await builder;
  if (error) {
    const problem = new Error(error.message || '数据库操作失败');
    problem.status = error.status || 500;
    throw problem;
  }
  return data || [];
}

function uidFrom() {
  const uid = auth.getUserInfo()?.uid;
  if (!uid) {
    const error = new Error('请刷新页面后重试');
    error.status = 401;
    throw error;
  }
  return uid;
}

async function accessFor(uid) {
  const rows = await query(db.from('archive_members').select('role').eq('uid', uid).eq('active', true).limit(1));
  const role = ['owner', 'editor'].includes(rows[0]?.role) ? rows[0].role : 'viewer';
  return { role, canWrite: role !== 'viewer' };
}

async function requireWriter(uid) {
  const access = await accessFor(uid);
  if (!access.canWrite) {
    const error = new Error('仅主人和已授权管理员可以修改视频');
    error.status = 403;
    throw error;
  }
}

async function one(videoId) {
  return (await query(db.from('video_links').select('*').eq('id', videoId).limit(1)))[0] || null;
}

exports.main = async event => {
  try {
    const uid = uidFrom();
    const action = typeof event?.action === 'string' ? event.action : '';
    const data = payload(event?.payload);

    if (action === 'getVideoAccess') return ok(await accessFor(uid));
    if (action === 'listVideos') {
      const rows = await query(db.from('video_links').select('*')
        .order('sort_order', { ascending: true }).order('created_at', { ascending: false }));
      const result = { vlog: [], dancee: [] };
      for (const row of rows) if (!row.deleted_at && result[row.category]) result[row.category].push(shape(row));
      return ok(result);
    }

    await requireWriter(uid);
    if (action === 'addVideo') {
      const item = video(data);
      await query(db.from('video_links').insert({ ...item, created_by_uid: uid, updated_by_uid: uid }));
      return ok(shape(item));
    }
    if (action === 'removeVideo') {
      const videoId = id(data.id);
      const existing = await one(videoId);
      if (!existing || existing.deleted_at) return fail('视频不存在', 404);
      await query(db.from('video_links').update({ deleted_at: new Date().toISOString(), updated_by_uid: uid, updated_at: new Date().toISOString() }).eq('id', videoId));
      return ok({ id: videoId });
    }
    if (action === 'setVideoCover') {
      const videoId = id(data.id);
      const nextCover = cover(data.cover);
      const existing = await one(videoId);
      if (!existing || existing.deleted_at) return fail('视频不存在', 404);
      await query(db.from('video_links').update({ cover: nextCover, updated_by_uid: uid, updated_at: new Date().toISOString() }).eq('id', videoId));
      return ok({ id: videoId, cover: nextCover });
    }
    return fail('未知操作', 404);
  } catch (error) {
    console.error('videoApi failed', error);
    return fail(error.message || '服务暂时不可用', error.status || 500);
  }
};
