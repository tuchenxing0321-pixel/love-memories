'use strict';

const cloudbase = require('@cloudbase/node-sdk');
const {
  WRITE_LIMIT,
  WRITE_WINDOW_SECONDS,
  objectKeyFor,
  validateId,
  validateMemory,
  validateObjectKey,
  validatePayload,
  validatePhoto
} = require('./core');
const { runTrackedRemoval, runTrackedUpload, unfinishedUploadExpired } = require('./lifecycle');

const app = cloudbase.init({
  env: cloudbase.SYMBOL_CURRENT_ENV,
  accessKey: process.env.CLOUDBASE_APIKEY
});
const auth = app.auth();
const db = app.rdb({ database: 'public' });
const ok = data => ({ ok: true, data });
const fail = (error, code = 400) => ({ ok: false, code, error });
const iso = () => new Date().toISOString();
const asDate = value => value ? String(value).slice(0, 10) : '';
const DELETE_GRACE_MS = 7000;
const STORAGE_BUCKET = 'memory-photos';

function storageApp() {
  return app;
}

function storageBucket() {
  return storageApp().storage.from(STORAGE_BUCKET).throwOnError();
}

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
  return access;
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

async function one(table, id) {
  return (await query(db.from(table).select('*').eq('id', id).limit(1)))[0] || null;
}

async function takeWriteSlot(uid) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const rows = await query(db.from('memory_write_rate_limits').select('*').eq('actor_uid', uid).limit(1));
    const current = rows[0];
    const now = iso();

    if (!current) {
      try {
        await query(db.from('memory_write_rate_limits').insert({
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
      const updated = await query(db.from('memory_write_rate_limits').update({
        window_started_at: now,
        write_count: 1
      }).eq('actor_uid', uid).eq('window_started_at', current.window_started_at).select('actor_uid'));
      if (updated.length) return;
      continue;
    }

    if (Number(current.write_count) >= WRITE_LIMIT) break;
    const updated = await query(db.from('memory_write_rate_limits').update({
      write_count: Number(current.write_count) + 1
    }).eq('actor_uid', uid).eq('write_count', current.write_count).select('actor_uid'));
    if (updated.length) return;
  }

  const problem = new Error('操作太频繁，请一分钟后再试');
  problem.status = 429;
  throw problem;
}

function memoryRow(id, memory, uid, createdAt = iso()) {
  return {
    id,
    kind: memory.kind,
    title: memory.title,
    date: memory.date,
    event_type: memory.eventType,
    place: memory.place,
    story: memory.story,
    sort_order: memory.sortOrder,
    created_by_uid: uid,
    updated_by_uid: uid,
    created_at: createdAt,
    updated_at: iso()
  };
}

async function uploadPhoto(objectKey, photo) {
  const { data } = await storageBucket().upload(objectKey, photo.buffer, {
    contentType: photo.mimeType,
    upsert: false
  });
  const fileId = String(data?.id || '');
  if (!fileId || fileId.length > 512) throw new Error('云存储未返回有效文件 ID');
  return { objectKey, fileId };
}

async function removeStoredFile(photo) {
  const objectKey = validateObjectKey(photo?.object_key, photo?.memory_id, photo?.id, photo?.mime_type);
  if (photo.storage_deleted_at) return;
  await runTrackedRemoval({
    remove: async () => {
      try { await storageBucket().remove([objectKey]); }
      catch (error) { if (!/NOT.?FOUND|NONEXIST/i.test(error.message || '')) throw error; }
    },
    markDeleted: async () => query(db.from('shared_memory_photos').update({
      storage_deleted_at: iso(), delete_error: null
    }).eq('id', photo.id)),
    markError: async error => query(db.from('shared_memory_photos').update({
      delete_error: String(error.message || '云存储删除失败').slice(0, 500)
    }).eq('id', photo.id))
  });
}

function deletionReady(row) {
  return row?.deleted_at && Date.now() - Date.parse(row.deleted_at) >= DELETE_GRACE_MS;
}

async function finalizePhoto(id) {
  const photo = await one('shared_memory_photos', id);
  if (!photo || !photo.deleted_at) return { id, state: 'restored' };
  if (!deletionReady(photo)) return { id, state: 'pending' };
  await removeStoredFile(photo);
  await query(db.from('shared_memory_photos').delete().eq('id', id));
  return { id, state: 'deleted' };
}

async function finalizeMemory(id) {
  const memory = await one('shared_memory_items', id);
  if (!memory || !memory.deleted_at) return { id, state: 'restored' };
  if (!deletionReady(memory)) return { id, state: 'pending' };
  const photos = await query(db.from('shared_memory_photos').select('*').eq('memory_id', id));
  for (const photo of photos) await removeStoredFile(photo);
  await query(db.from('shared_memory_items').delete().eq('id', id));
  return { id, state: 'deleted' };
}

async function cleanupExpired() {
  const [memories, photos] = await Promise.all([
    query(db.from('shared_memory_items').select('*')),
    query(db.from('shared_memory_photos').select('*'))
  ]);
  for (const photo of photos.filter(photo => unfinishedUploadExpired(photo))) {
    try {
      await removeStoredFile(photo);
      await query(db.from('shared_memory_photos').delete().eq('id', photo.id));
      const parent = await one('shared_memory_items', photo.memory_id);
      if (parent?.kind === 'photo') {
        const remaining = await query(db.from('shared_memory_photos').select('id').eq('memory_id', parent.id).limit(1));
        if (!remaining.length) await query(db.from('shared_memory_items').delete().eq('id', parent.id));
      }
    } catch (error) {
      console.error('unfinished upload cleanup failed', photo.id, error);
    }
  }
  for (const photo of photos.filter(photo => (photo.upload_state || 'active') === 'active' && deletionReady(photo))) {
    try { await finalizePhoto(photo.id); } catch (error) { console.error('photo cleanup failed', photo.id, error); }
  }
  for (const memory of memories.filter(deletionReady)) {
    try { await finalizeMemory(memory.id); } catch (error) { console.error('memory cleanup failed', memory.id, error); }
  }
}

async function photoUrls(photos) {
  const urls = new Map();
  for (let index = 0; index < photos.length; index += 50) {
    const batch = photos.slice(index, index + 50);
    const objectKeys = batch.map(photo => validateObjectKey(
      photo?.object_key, photo?.memory_id, photo?.id, photo?.mime_type
    ));
    const { data } = await storageBucket().createSignedUrls(objectKeys, 3600);
    for (const item of data || []) {
      if (!item.error) urls.set(item.path, item.fullSignedURL || '');
    }
  }
  return urls;
}

async function listMemories() {
  await cleanupExpired();
  const [allMemories, allPhotos] = await Promise.all([
    query(db.from('shared_memory_items').select('*').order('date', { ascending: true })
      .order('sort_order', { ascending: true }).order('created_at', { ascending: true })),
    query(db.from('shared_memory_photos').select('*').order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }))
  ]);
  const memories = allMemories.filter(item => !item.deleted_at);
  const activeIds = new Set(memories.map(memory => memory.id));
  const photos = allPhotos.filter(photo => (photo.upload_state || 'active') === 'active'
    && !photo.deleted_at && !photo.storage_deleted_at && activeIds.has(photo.memory_id));
  const urls = await photoUrls(photos);
  const byMemory = new Map();
  for (const photo of photos) {
    const image = {
      id: photo.id,
      data: urls.get(photo.object_key) || '',
      caption: photo.caption || '',
      uploadedAt: asDate(photo.uploaded_at),
      sortOrder: Number(photo.sort_order || 0),
      remote: true
    };
    if (!byMemory.has(photo.memory_id)) byMemory.set(photo.memory_id, []);
    byMemory.get(photo.memory_id).push(image);
  }
  return memories.map(row => ({
    id: row.id,
    kind: row.kind,
    title: row.title,
    date: asDate(row.date),
    eventType: row.event_type,
    place: row.place || '',
    story: row.story || '',
    sortOrder: Number(row.sort_order || 0),
    images: byMemory.get(row.id) || []
  })).filter(item => item.kind !== 'photo' || item.images.length);
}

async function addPhoto(memory, photo, uid) {
  const objectKey = objectKeyFor(memory.id, photo.id, photo.mimeType);
  const pendingRow = {
      id: photo.id,
      memory_id: memory.id,
      object_key: objectKey,
      file_id: null,
      filename: photo.filename,
      mime_type: photo.mimeType,
      size_bytes: photo.buffer.length,
      caption: photo.caption,
      uploaded_at: photo.uploadedAt || memory.date,
      sort_order: photo.sortOrder,
      created_by_uid: uid,
      created_at: iso(),
      upload_state: 'pending'
  };
  await runTrackedUpload({
    createPending: async () => query(db.from('shared_memory_photos').insert(pendingRow)),
    upload: async () => uploadPhoto(objectKey, photo),
    activate: async stored => {
      const updated = await query(db.from('shared_memory_photos').update({
        file_id: stored.fileId,
        upload_state: 'active',
        delete_error: null
      }).eq('id', photo.id).eq('upload_state', 'pending').select('id'));
      if (!updated.length) throw new Error('照片上传记录激活失败');
    },
    markCleanup: async error => {
      await query(db.from('shared_memory_photos').update({
        upload_state: 'cleanup',
        delete_error: String(error.message || '照片上传失败').slice(0, 500)
      }).eq('id', photo.id));
    }
  });
}

exports.main = async event => {
  try {
    const uid = uidFrom();
    const action = typeof event?.action === 'string' ? event.action : '';
    const payload = event?.payload === undefined ? {} : validatePayload(event.payload);

    if (action === 'listMemories') return ok(await listMemories());
    if (action === 'getAccess') return ok(await accessFor(uid));

    await requireWriter(uid);

    if (action === 'createMemory') {
      const memory = validateMemory(payload);
      if (memory.kind !== 'event') return fail('独立照片请使用照片上传接口');
      const id = validateId(payload.id);
      await takeWriteSlot(uid);
      await query(db.from('shared_memory_items').insert(memoryRow(id, memory, uid)));
      return ok({ id });
    }

    if (action === 'createStandalonePhoto') {
      const memory = validateMemory(payload.memory);
      if (memory.kind !== 'photo') return fail('照片记录类型无效');
      const id = validateId(payload.memory.id);
      const photo = validatePhoto(payload.photo);
      await takeWriteSlot(uid);
      const row = memoryRow(id, memory, uid);
      await query(db.from('shared_memory_items').insert(row));
      await addPhoto(row, photo, uid);
      return ok({ id, photoId: photo.id });
    }

    if (action === 'updateMemory') {
      const id = validateId(payload.id);
      const existing = await one('shared_memory_items', id);
      if (!existing || existing.deleted_at) return fail('回忆不存在', 404);
      const memory = validateMemory(payload);
      if (memory.kind !== existing.kind) return fail('不能修改回忆类型');
      await takeWriteSlot(uid);
      await query(db.from('shared_memory_items').update({
        title: memory.title,
        date: memory.date,
        event_type: memory.eventType,
        place: memory.place,
        story: memory.story,
        sort_order: memory.sortOrder,
        updated_by_uid: uid,
        updated_at: iso()
      }).eq('id', id));
      return ok({ id });
    }

    if (action === 'addPhoto') {
      const memoryId = validateId(payload.memoryId, '回忆');
      const memory = await one('shared_memory_items', memoryId);
      if (!memory || memory.deleted_at) return fail('回忆不存在', 404);
      const photo = validatePhoto(payload.photo);
      await takeWriteSlot(uid);
      await addPhoto(memory, photo, uid);
      return ok({ memoryId, photoId: photo.id });
    }

    if (action === 'softDeletePhoto' || action === 'restorePhoto') {
      const id = validateId(payload.id, '照片');
      const photo = await one('shared_memory_photos', id);
      if (!photo) return fail('照片不存在', 404);
      await takeWriteSlot(uid);
      await query(db.from('shared_memory_photos').update({
        deleted_at: action === 'softDeletePhoto' ? iso() : null,
        delete_error: null
      }).eq('id', id));
      return ok({ id });
    }

    if (action === 'softDeleteMemory' || action === 'restoreMemory') {
      const id = validateId(payload.id);
      const memory = await one('shared_memory_items', id);
      if (!memory) return fail('回忆不存在', 404);
      await takeWriteSlot(uid);
      await query(db.from('shared_memory_items').update({
        deleted_at: action === 'softDeleteMemory' ? iso() : null,
        updated_by_uid: uid,
        updated_at: iso()
      }).eq('id', id));
      return ok({ id });
    }

    if (action === 'finalizePhotoDelete') {
      return ok(await finalizePhoto(validateId(payload.id, '照片')));
    }

    if (action === 'finalizeMemoryDelete') {
      return ok(await finalizeMemory(validateId(payload.id)));
    }

    return fail('未知操作', 404);
  } catch (error) {
    console.error('memoryApi failed', error);
    return fail(error.message || '服务暂时不可用', error.status || 500);
  }
};
