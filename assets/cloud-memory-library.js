(function () {
  'use strict';

  const MAX_FILES = 12;
  const MAX_BYTES = 2 * 1024 * 1024;
  const DELETE_DELAY = 7600;
  let cache = [];

  const call = (action, payload = {}) => window.CloudBaseClient.call(action, payload);
  const today = () => new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());

  function bytes(base64) {
    return Math.floor(base64.length * 3 / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0);
  }

  function photoPayload(image, sortOrder = 0) {
    const base64 = String(image.data || '').split(',')[1] || '';
    return {
      id: image.id,
      base64,
      mimeType: image.mimeType || 'image/jpeg',
      filename: image.filename || '回忆照片.jpg',
      caption: image.caption || '',
      uploadedAt: image.uploadedAt || today(),
      sortOrder
    };
  }

  function memoryPayload(item) {
    return {
      id: item.id,
      kind: item.kind,
      title: item.title,
      date: item.date,
      eventType: item.eventType || 'minor',
      place: item.place || '',
      story: item.story || '',
      sortOrder: Number.isSafeInteger(item.sortOrder) ? item.sortOrder : 0
    };
  }

  function schedule(action, id) {
    setTimeout(() => call(action, { id }).catch(() => {}), DELETE_DELAY);
  }

  async function all() {
    cache = await call('listMemories');
    return cache;
  }

  async function put(item) {
    const existing = cache.find(record => record.id === item.id);
    const pending = (item.images || []).filter(image => !image.remote);
    if (item.kind === 'photo') {
      if (existing) {
        await call('updateMemory', memoryPayload(item));
        return item;
      }
      if (pending.length !== 1) throw new Error('每条独立照片记录必须包含一张照片');
      await call('createStandalonePhoto', {
        memory: memoryPayload(item),
        photo: photoPayload(pending[0])
      });
      return item;
    }

    if (existing) await call('updateMemory', memoryPayload(item));
    else await call('createMemory', memoryPayload(item));
    for (let index = 0; index < pending.length; index += 1) {
      await call('addPhoto', {
        memoryId: item.id,
        photo: photoPayload(pending[index], (existing?.images?.length || 0) + index)
      });
    }
    return item;
  }

  async function remove(id) {
    await call('softDeleteMemory', { id });
    schedule('finalizeMemoryDelete', id);
  }

  async function restore(id) {
    await call('restoreMemory', { id });
  }

  async function removePhoto(id) {
    await call('softDeletePhoto', { id });
    schedule('finalizePhotoDelete', id);
  }

  async function restorePhoto(id) {
    await call('restorePhoto', { id });
  }

  async function updatePhotoDetails(id, caption, date) {
    await call('updatePhotoDetails', { id, caption, date });
  }

  function imageFromFile(file) {
    if (!file) return Promise.reject(new Error('请选择图片'));
    if (!file.type.startsWith('image/')) return Promise.reject(new Error(`${file.name || '所选文件'}不是图片`));
    if (file.size > 20 * 1024 * 1024) return Promise.reject(new Error(`${file.name || '图片'}超过 20 MB`));
    return new Promise((resolve, reject) => {
      const image = new Image();
      const reader = new FileReader();
      reader.onerror = () => reject(new Error(`无法读取 ${file.name || '图片'}`));
      reader.onload = () => { image.src = reader.result; };
      image.onerror = () => reject(new Error(`${file.name || '图片'}无法打开`));
      image.onload = () => {
        try {
          let maxSide = 1600;
          let quality = 0.82;
          let data = '';
          for (let attempt = 0; attempt < 3; attempt += 1) {
            const scale = Math.min(1, maxSide / Math.max(image.width, image.height));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            data = canvas.toDataURL('image/jpeg', quality);
            if (bytes(data.split(',')[1] || '') <= MAX_BYTES) break;
            maxSide = Math.round(maxSide * 0.75);
            quality -= 0.08;
          }
          if (bytes(data.split(',')[1] || '') > MAX_BYTES) throw new Error('压缩后仍超过 2 MB');
          resolve({
            id: crypto.randomUUID(),
            data,
            caption: '',
            uploadedAt: today(),
            filename: `${String(file.name || '回忆照片').replace(/\.[^.]+$/, '').slice(0, 170)}.jpg`,
            mimeType: 'image/jpeg',
            size: bytes(data.split(',')[1] || ''),
            remote: false
          });
        } catch (error) {
          reject(new Error(`${file.name || '图片'}处理失败：${error.message}`));
        }
      };
      reader.readAsDataURL(file);
    });
  }

  async function imagesFromFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return [];
    if (files.length > MAX_FILES) throw new Error(`一次最多添加 ${MAX_FILES} 张图片`);
    const images = [];
    for (const file of files) images.push(await imageFromFile(file));
    return images;
  }

  window.MemoryLibrary = Object.freeze({
    all,
    put,
    remove,
    restore,
    removePhoto,
    restorePhoto,
    updatePhotoDetails,
    imageFromFile,
    imagesFromFiles,
    today,
    status: () => window.CloudBaseClient.status()
  });
})();
