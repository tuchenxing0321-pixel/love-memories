(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const MAX = 12;
  let records = [], photos = [], selected = [], busy = false, current = null, timer;
  const today = () => MemoryLibrary.today();
  const errorText = error => String(error?.message || '操作失败，请稍后重试');
  const key = file => [file.name, file.size, file.lastModified].join(':');
  const escapeHtml = text => String(text || '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  function notice(text, undo) {
    $('toastText').textContent = text;
    $('undo').hidden = !undo;
    $('undo').onclick = undo || null;
    $('toast').classList.add('visible');
    clearTimeout(timer);
    timer = setTimeout(() => $('toast').classList.remove('visible'), undo ? 7000 : 4500);
  }
  function setStatus(text, error = false) {
    $('uploadStatus').textContent = text;
    $('uploadStatus').classList.toggle('error', error);
  }
  function cardList() {
    photos = records.flatMap(record => (record.images || []).map(image => ({ record, image })))
      .sort((a, b) => String(b.image.uploadedAt || b.record.date).localeCompare(String(a.image.uploadedAt || a.record.date)) || a.image.id.localeCompare(b.image.id));
    $('count').textContent = `${photos.length} 张照片`;
    $('grid').innerHTML = photos.length ? photos.map(({ record, image }, index) =>
      `<button class="photo" data-photo="${index}" type="button" aria-label="查看${escapeHtml(image.caption || record.title || '照片')}"><img src="${image.data}" alt="" loading="lazy" decoding="async"><span>${escapeHtml(image.caption || (record.kind === 'event' ? record.title : '一张照片'))}</span></button>`
    ).join('') : '<p class="empty">这里还没有照片。选几张喜欢的照片，先放进来吧。</p>';
    $('grid').querySelectorAll('[data-photo]').forEach(button => button.onclick = () => openEditor(photos[Number(button.dataset.photo)]));
  }
  async function refresh() {
    records = await MemoryLibrary.all();
    cardList();
  }
  function renderQueue() {
    $('queue').hidden = !selected.length;
    $('queue').innerHTML = selected.map((item, index) => `<div class="queued"><img src="${item.url}" alt=""><button type="button" data-remove="${index}" aria-label="移除${escapeHtml(item.file.name)}">×</button></div>`).join('');
    $('queue').querySelectorAll('[data-remove]').forEach(button => button.onclick = () => {
      URL.revokeObjectURL(selected[Number(button.dataset.remove)].url);
      selected.splice(Number(button.dataset.remove), 1);
      renderQueue();
    });
    $('uploadButton').disabled = busy || !selected.length;
    $('uploadButton').textContent = selected.length ? `上传 ${selected.length} 张照片` : '上传照片';
    document.querySelector('.pick').firstChild.textContent = selected.length ? '继续选择' : '选择照片';
  }
  $('photoFiles').onchange = event => {
    const files = Array.from(event.target.files || []);
    for (const file of files) {
      if (!file.type.startsWith('image/')) { setStatus(`${file.name} 不是图片`, true); continue; }
      if (selected.some(item => key(item.file) === key(file))) continue;
      if (selected.length >= MAX) { setStatus('一次最多选择 12 张，请先上传这一批。', true); break; }
      selected.push({ file, url: URL.createObjectURL(file) });
    }
    event.target.value = '';
    renderQueue();
    if (selected.length) setStatus(`已选 ${selected.length} 张。确认后点上传；不需要先填写日期或标题。`);
  };
  $('uploadButton').onclick = async () => {
    if (busy || !selected.length) return;
    busy = true;
    $('uploadButton').disabled = true;
    $('photoFiles').disabled = true;
    const batch = selected.slice();
    let next = 0, done = 0;
    const results = new Array(batch.length);
    const worker = async () => {
      while (next < batch.length) {
        const index = next++;
        const item = batch[index];
        try {
          const image = await MemoryLibrary.imageFromFile(item.file);
          item.imageId = image.id;
          await MemoryLibrary.put({ id: crypto.randomUUID(), kind: 'photo', title: '一张照片', date: today(), story: '', place: '', images: [image] });
          results[index] = 'saved';
        } catch (error) {
          results[index] = errorText(error);
        }
        done++;
        setStatus(`正在上传 ${done}/${batch.length} 张…`);
      }
    };
    await Promise.all([worker(), worker()]);
    try {
      await refresh();
      const savedIds = new Set(photos.map(photo => photo.image.id));
      const failed = batch.filter((item, index) => results[index] !== 'saved' && !savedIds.has(item.imageId));
      batch.filter(item => !failed.includes(item)).forEach(item => URL.revokeObjectURL(item.url));
      selected = failed;
      renderQueue();
      const completed = batch.length - failed.length;
      setStatus(failed.length ? `已上传 ${completed} 张，${failed.length} 张未成功；留在待上传区，可重试。` : `已上传 ${completed} 张照片。`, Boolean(failed.length));
    } catch (error) {
      setStatus(`上传状态暂时无法核对：${errorText(error)}。请刷新照片库后再重试，避免重复。`, true);
      $('uploadButton').disabled = true;
    } finally {
      busy = false;
      $('photoFiles').disabled = false;
      if (!$('uploadStatus').textContent.includes('无法核对')) renderQueue();
    }
  };
  function openEditor(photo) {
    current = photo;
    $('editImage').src = photo.image.data;
    $('editImage').alt = photo.image.caption || photo.record.title || '回忆照片';
    $('caption').value = photo.image.caption || '';
    $('date').value = photo.image.uploadedAt || photo.record.date || today();
    $('story').value = photo.record.kind === 'photo' ? photo.record.story || '' : '';
    $('storyField').hidden = photo.record.kind !== 'photo';
    $('eventLink').hidden = photo.record.kind !== 'event';
    $('eventLink').href = `memories.html?event=${encodeURIComponent(photo.record.id)}`;
    $('editor').showModal();
  }
  $('closeEditor').onclick = () => $('editor').close();
  $('editForm').onsubmit = async event => {
    event.preventDefault();
    if (!current || busy) return;
    busy = true;
    $('saveButton').disabled = true;
    try {
      if (current.record.kind === 'photo') await MemoryLibrary.put({ ...current.record, date: $('date').value, story: $('story').value.trim() });
      await MemoryLibrary.updatePhotoDetails(current.image.id, $('caption').value.trim(), $('date').value);
      await refresh();
      $('editor').close();
      notice('照片信息已保存');
    } catch (error) { notice(errorText(error)); }
    finally { busy = false; $('saveButton').disabled = false; }
  };
  $('deleteButton').onclick = async () => {
    if (!current || busy || !confirm('确定删除这张照片吗？删除后 7 秒内可撤回。')) return;
    busy = true;
    const { record, image } = current;
    try {
      if (record.kind === 'photo') await MemoryLibrary.remove(record.id);
      else await MemoryLibrary.removePhoto(image.id);
      $('editor').close();
      await refresh();
      notice('照片已删除', async () => {
        try {
          if (record.kind === 'photo') await MemoryLibrary.restore(record.id);
          else await MemoryLibrary.restorePhoto(image.id);
          await refresh();
          notice('照片已恢复');
        } catch (error) { notice(errorText(error)); }
      });
    } catch (error) { notice(errorText(error)); }
    finally { busy = false; }
  };
  (async () => {
    try {
      const access = await CloudBaseClient.access();
      if (!access.canWrite) { location.replace('auth.html?next=photo-manager.html'); return; }
      await refresh();
    } catch (error) {
      $('grid').innerHTML = '<p class="empty">照片加载失败，请刷新重试。</p>';
      setStatus(errorText(error), true);
    }
  })();
})();
