(function () {
  const FORMAT = 'nono-txx-backup';
  const VERSION = 1;
  const VIDEO_KEY = 'nono-video-links-v2';
  const DATES_KEY = 'nono-important-dates-v1';
  const MAX_BACKUP_BYTES = 100 * 1024 * 1024;

  function database(name, store) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(store, { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('无法打开本地资料库'));
    });
  }

  async function readStore(name, store) {
    const db = await database(name, store);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readonly');
      const request = tx.objectStore(store).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error('无法读取本地资料'));
      tx.oncomplete = () => db.close();
      tx.onerror = () => { db.close(); reject(tx.error || new Error('读取本地资料失败')); };
    });
  }

  async function replaceStore(name, store, items) {
    const db = await database(name, store);
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const table = tx.objectStore(store);
      table.clear();
      items.forEach(item => table.put(item));
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error || new Error('写入本地资料失败')); };
      tx.onabort = () => { db.close(); reject(tx.error || new Error('恢复已中断')); };
    });
  }

  function readJson(key, fallback) {
    try {
      const value = JSON.parse(localStorage.getItem(key));
      return value == null ? fallback : value;
    } catch (_) {
      return fallback;
    }
  }

  function validArray(value, label) {
    if (!Array.isArray(value) || value.some(item => !item || typeof item !== 'object' || typeof item.id !== 'string')) {
      throw new Error(`${label}数据格式不正确`);
    }
    const ids = new Set();
    for (const item of value) {
      if (!item.id.trim()) throw new Error(`${label}包含空的 ID`);
      if (ids.has(item.id)) throw new Error(`${label}包含重复 ID：${item.id}`);
      ids.add(item.id);
    }
    return value;
  }

  function validVideos(value, label) {
    return validArray(value, label).map(item => {
      const url = window.VideoLibrary?.safeUrl ? window.VideoLibrary.safeUrl(item.url) : (() => {
        try { const parsed = new URL(String(item.url || '')); return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : ''; }
        catch (_) { return ''; }
      })();
      if (!url) throw new Error(`${label}包含不安全的视频链接`);
      return { ...item, url };
    });
  }

  function validate(input) {
    if (!input || input.format !== FORMAT || input.version !== VERSION || !input.data) throw new Error('这不是有效的 nono & txx 备份文件');
    const memories = validArray(input.data.memories, '回忆');
    const profiles = validArray(input.data.profiles, '个人主页');
    const dates = validArray(input.data.dates, '重要日期');
    const sourceVideos = input.data.videos;
    if (!sourceVideos || !Array.isArray(sourceVideos.vlog) || !Array.isArray(sourceVideos.dancee)) throw new Error('视频数据格式不正确');
    const videos = { vlog: validVideos(sourceVideos.vlog, 'VLOG'), dancee: validVideos(sourceVideos.dancee, 'dancee') };
    return { memories, profiles, dates, videos };
  }

  async function snapshot() {
    const [memories, profiles] = await Promise.all([
      readStore('nono-memory-archive', 'memories'),
      readStore('nono-profile-gallery', 'photos')
    ]);
    const videos = readJson(VIDEO_KEY, { vlog: [], dancee: [] });
    const dates = readJson(DATES_KEY, []);
    return {
      format: FORMAT,
      version: VERSION,
      createdAt: new Date().toISOString(),
      data: validate({ format: FORMAT, version: VERSION, data: { memories, profiles, videos, dates } })
    };
  }

  async function writeSnapshot(data) {
    await replaceStore('nono-memory-archive', 'memories', data.memories);
    await replaceStore('nono-profile-gallery', 'photos', data.profiles);
    localStorage.setItem(VIDEO_KEY, JSON.stringify(data.videos));
    localStorage.setItem(DATES_KEY, JSON.stringify(data.dates));
    localStorage.setItem('nono-memory-examples-seeded-v1', '1');
  }

  async function restore(input) {
    const next = validate(input);
    const previous = await snapshot();
    try {
      await writeSnapshot(next);
    } catch (error) {
      try { await writeSnapshot(previous.data); } catch (_) {}
      throw error;
    }
  }

  function validateFile(file) {
    if (!file || !/\.json$/i.test(file.name)) throw new Error('请选择 JSON 备份文件');
    if (file.size > MAX_BACKUP_BYTES) throw new Error('备份文件超过 100 MB，无法安全导入');
  }

  async function fromFile(file) {
    validateFile(file);
    let parsed;
    try { parsed = JSON.parse(await file.text()); } catch (_) { throw new Error('备份文件无法解析'); }
    validate(parsed);
    return parsed;
  }

  function counts(input) {
    const data = validate(input);
    return {
      memories: data.memories.length,
      profiles: data.profiles.length,
      videos: data.videos.vlog.length + data.videos.dancee.length,
      dates: data.dates.length
    };
  }

  function download(input) {
    validate(input);
    const day = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Shanghai' });
    const url = URL.createObjectURL(new Blob([JSON.stringify(input)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `nono-txx-backup-${day}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const emptyBackup = { format: FORMAT, version: VERSION, data: { memories: [], profiles: [], videos: { vlog: [], dancee: [] }, dates: [] } };
  let duplicateRejected = false, oversizedRejected = false;
  try { validate({ ...emptyBackup, data: { ...emptyBackup.data, memories: [{ id: 'same' }, { id: 'same' }] } }); } catch (error) { duplicateRejected = /重复 ID/.test(error.message); }
  try { validateFile({ name: 'backup.json', size: MAX_BACKUP_BYTES + 1 }); } catch (error) { oversizedRejected = /100 MB/.test(error.message); }
  console.assert(counts(emptyBackup).videos === 0 && duplicateRejected && oversizedRejected, '备份格式自检失败');
  window.BackupLibrary = { snapshot, restore, fromFile, counts, download, validate };
})();
