(function () {
  'use strict';

  const SESSION_KEY = 'nono-lens-cloud-session-v1';
  const MAX_INPUT_BYTES = 20 * 1024 * 1024;
  const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

  function storedSession() {
    try {
      const value = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
      if (!value?.nickname || !value?.token || Number(value.expiresAt) <= Date.now()) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return value;
    } catch (_) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
  }

  function session() { return storedSession(); }

  function cloud() {
    const status = window.CloudBaseClient?.status?.();
    if (!status?.ready) throw new Error(status?.reason || 'CloudBase 尚未连接');
    return window.CloudBaseClient;
  }

  async function call(action, payload, activeSession) {
    const token = activeSession?.token || storedSession()?.token || '';
    return cloud().callFunction('lensApi', action, payload || {}, token ? { token } : {});
  }

  async function bootstrap() {
    const cached = storedSession();
    try {
      const access = await call('getSession', {}, cached);
      if (!access?.authenticated) {
        if (cached) localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return {
        ...cached,
        nickname: access.nickname,
        role: access.role,
        canManage: Boolean(access.canManage),
        formalAccount: Boolean(access.canManage && !cached?.token)
      };
    } catch (error) {
      if (cached && /失效|过期|密钥/.test(error.message || '')) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      throw error;
    }
  }

  async function login(nickname, key) {
    const result = await call('login', { nickname, key }, null);
    const value = {
      nickname: result.nickname,
      token: result.token,
      expiresAt: result.expiresAt,
      role: result.role || 'visitor',
      canManage: false,
      formalAccount: false
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(value));
    return value;
  }

  async function logout(activeSession) {
    localStorage.removeItem(SESSION_KEY);
    if (activeSession?.formalAccount) await cloud().signOut();
  }

  async function list(activeSession) {
    const result = await call('list', {}, activeSession);
    return { access: result.access, photos: Array.isArray(result.photos) ? result.photos : [] };
  }

  function uuid() {
    if (crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, character => {
      const random = crypto.getRandomValues(new Uint8Array(1))[0] & 15;
      return (character === 'x' ? random : (random & 3) | 8).toString(16);
    });
  }

  function loadImage(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`${file.name} 无法读取`)); };
      image.src = url;
    });
  }

  function canvasBlob(canvas, mimeType, quality) {
    return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('照片压缩失败')), mimeType, quality));
  }

  async function compress(file) {
    if (!file?.type?.startsWith('image/')) throw new Error('只能添加图片文件');
    if (file.size > MAX_INPUT_BYTES) throw new Error(`${file.name} 超过 20 MB`);
    const image = await loadImage(file);
    let scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    let quality = 0.86;
    let blob;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext('2d', { alpha: true }).drawImage(image, 0, 0, canvas.width, canvas.height);
      blob = await canvasBlob(canvas, 'image/webp', quality);
      if (blob.size <= MAX_UPLOAD_BYTES) break;
      scale *= 0.82;
      quality = Math.max(0.58, quality - 0.07);
    }
    if (!blob || blob.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} 压缩后仍超过 2 MB`);
    return { blob, mimeType: 'image/webp', filename: file.name.replace(/\.[^.]+$/, '') + '.webp' };
  }

  function base64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(new Error('照片读取失败'));
      reader.readAsDataURL(blob);
    });
  }

  async function add(files, note, activeSession, onProgress) {
    const images = Array.from(files || []);
    if (!activeSession) throw new Error('请先输入昵称和共享密钥');
    if (!images.length) throw new Error('请选择照片');
    if (images.length > 12) throw new Error('一次最多添加 12 张照片');
    const created = [];
    for (let index = 0; index < images.length; index += 1) {
      onProgress?.(index + 1, images.length);
      const image = await compress(images[index]);
      const result = await call('add', {
        id: uuid(),
        filename: image.filename,
        mimeType: image.mimeType,
        base64: await base64(image.blob),
        note: String(note || '').trim()
      }, activeSession);
      created.push(result);
    }
    return created;
  }

  async function update(id, note, activeSession) {
    return call('update', { id, note: String(note || '').trim() }, activeSession);
  }

  async function remove(id, activeSession) {
    return call('remove', { id }, activeSession);
  }

  window.LensLibrary = Object.freeze({ session, bootstrap, login, logout, list, add, update, remove });
})();
