(function () {
  'use strict';

  const STORAGE_KEY = 'nono-music-player-v1';
  const playlist = [
    { title: '爱可以再更多一点点（原版）', src: 'assets/music/love-can-be-more.mp3' }
  ];
  const $ = id => document.getElementById(id);
  const shell = $('musicShell');
  const button = $('musicToggle');
  const audio = $('musicAudio');
  const title = $('musicTitle');
  const panel = $('musicPanel');
  const modeButton = $('musicMode');
  const volume = $('musicVolume');
  if (!shell || !button || !audio) return;

  let hideTimer = 0;
  let saveTimer = 0;
  let current = 0;
  let mode = 'list';
  let state = 'idle';
  let restoredTime = 0;
  let resumeTarget = 0;
  let lastKnownTime = 0;
  let pendingPlayback = false;
  let restoreGeneration = 0;
  let direction = 1;
  let wantsPlayback = false;

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    current = Math.max(0, Math.min(playlist.length - 1, Number(saved.current) || 0));
    restoredTime = Math.max(0, Number(saved.time) || 0);
    lastKnownTime = restoredTime;
    mode = ['list', 'single', 'random'].includes(saved.mode) ? saved.mode : 'list';
    wantsPlayback = Boolean(saved.playing);
    audio.volume = Math.max(0, Math.min(1, Number.isFinite(Number(saved.volume)) ? Number(saved.volume) : .82));
  } catch (_) { audio.volume = .82; }

  function save() {
    const liveTime = Math.max(0, Number(audio.currentTime) || 0);
    const time = resumeTarget || restoredTime || Math.max(lastKnownTime, liveTime);
    lastKnownTime = time;
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ current, time, volume: audio.volume, mode, playing: wantsPlayback }));
  }

  function readSavedState() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch (_) { return {}; }
  }

  function openBriefly() {
    clearTimeout(hideTimer);
    shell.classList.add('is-open');
    hideTimer = setTimeout(() => { if (!panel?.classList.contains('is-open') && !shell.matches(':hover,:focus-within')) shell.classList.remove('is-open'); }, 3000);
  }

  function setState(next) {
    state = next;
    shell.classList.toggle('is-playing', next === 'playing');
    button.classList.toggle('is-playing', next === 'playing');
    button.setAttribute('aria-pressed', String(next === 'playing'));
    button.setAttribute('aria-label', next === 'playing' ? '暂停音乐' : '播放音乐');
  }

  function renderTitle() {
    title.classList.remove('slide-left', 'slide-right');
    void title.offsetWidth;
    title.textContent = playlist[current].title;
    title.classList.add(direction > 0 ? 'slide-right' : 'slide-left');
    button.title = playlist[current].title;
    document.querySelectorAll('[data-music-index]').forEach((item, index) => item.classList.toggle('is-current', index === current));
  }

  function ensureSource(reset = false) {
    const track = playlist[current];
    if (audio.getAttribute('src') !== track.src) {
      audio.src = track.src;
      audio.load();
      restoredTime = reset ? 0 : restoredTime;
    }
  }

  async function startPlayback() {
    try {
      pendingPlayback = false;
      await audio.play();
      save();
    } catch (_) {
      setState('idle');
      shell.dataset.message = '点击继续播放';
      save();
    }
  }

  function restorePosition(playAfter) {
    const generation = ++restoreGeneration;
    pendingPlayback = playAfter;
    const finish = () => {
      if (generation !== restoreGeneration) return;
      resumeTarget = 0;
      const shouldPlay = wantsPlayback && (playAfter || pendingPlayback);
      pendingPlayback = false;
      if (shouldPlay) startPlayback(); else setState('idle');
    };

    if (!restoredTime) {
      finish();
      return;
    }
    if (audio.readyState < audio.HAVE_METADATA || !Number.isFinite(audio.duration)) {
      audio.addEventListener('loadedmetadata', () => {
        if (generation === restoreGeneration) restorePosition(playAfter && wantsPlayback);
      }, { once: true });
      return;
    }

    resumeTarget = Math.min(restoredTime, Math.max(0, audio.duration - .2));
    restoredTime = 0;
    if (Math.abs(audio.currentTime - resumeTarget) < .1) {
      finish();
      return;
    }
    audio.addEventListener('seeked', finish, { once: true });
    audio.currentTime = resumeTarget;
  }

  function play() {
    ensureSource();
    wantsPlayback = true;
    if (resumeTarget) {
      pendingPlayback = true;
      return;
    }
    if (restoredTime) {
      restorePosition(true);
      return;
    }
    startPlayback();
  }

  function fadeTo(target, duration, done) {
    const start = audio.volume;
    const started = performance.now();
    const tick = now => {
      const progress = Math.min(1, (now - started) / duration);
      audio.volume = start + (target - start) * progress;
      if (progress < 1) requestAnimationFrame(tick); else done?.();
    };
    requestAnimationFrame(tick);
  }

  function change(step) {
    direction = step >= 0 ? 1 : -1;
    const wasPlaying = !audio.paused && !audio.ended;
    const rememberedVolume = Number(volume.value) / 100;
    const switchTrack = () => {
      current = playlist.length === 1 ? 0 : (current + step + playlist.length) % playlist.length;
      restoredTime = 0;
      resumeTarget = 0;
      lastKnownTime = 0;
      pendingPlayback = false;
      audio.src = playlist[current].src;
      audio.currentTime = 0;
      renderTitle();
      if (wasPlaying) {
        audio.volume = 0;
        audio.play().then(() => fadeTo(rememberedVolume, 250)).catch(() => setState('idle'));
      } else audio.volume = rememberedVolume;
      save();
      openBriefly();
    };
    if (wasPlaying) fadeTo(0, 250, switchTrack); else switchTrack();
  }

  function renderPanel() {
    $('musicQueue').innerHTML = playlist.map((track, index) => `<button type="button" data-music-index="${index}"><span>${String(index + 1).padStart(2, '0')}</span><b>${track.title}</b></button>`).join('');
    document.querySelectorAll('[data-music-index]').forEach(item => item.onclick = () => {
      const next = Number(item.dataset.musicIndex);
      if (next === current) { restoredTime = 0; resumeTarget = 0; lastKnownTime = 0; audio.currentTime = 0; if (state === 'playing') play(); }
      else change(next > current ? 1 : -1);
      setPanel(false);
    });
    renderTitle();
  }

  function setPanel(open) {
    panel.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', String(!open));
    $('musicList').setAttribute('aria-expanded', String(open));
    $('musicList').setAttribute('aria-label', open ? '关闭歌单' : '打开歌单');
  }

  button.onclick = () => {
    openBriefly();
    if (audio.paused) play(); else { wantsPlayback = false; audio.pause(); }
  };
  $('musicPrev').onclick = () => change(-1);
  $('musicNext').onclick = () => change(1);
  $('musicList').onclick = () => { setPanel(!panel.classList.contains('is-open')); shell.classList.add('is-open'); };
  $('musicPanelClose').onclick = () => setPanel(false);
  modeButton.onclick = () => {
    mode = mode === 'list' ? 'single' : mode === 'single' ? 'random' : 'list';
    modeButton.textContent = mode === 'list' ? '列表循环' : mode === 'single' ? '单曲循环' : '随机播放';
    save();
  };
  volume.value = String(Math.round(audio.volume * 100));
  volume.oninput = () => { audio.volume = Number(volume.value) / 100; save(); };
  audio.addEventListener('playing', () => { wantsPlayback = true; setState('playing'); });
  audio.addEventListener('pause', () => { if (!audio.ended) setState('idle'); save(); });
  audio.addEventListener('timeupdate', () => {
    lastKnownTime = Math.max(lastKnownTime, Math.max(0, Number(audio.currentTime) || 0));
    if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = 0; save(); }, 1200);
  });
  audio.addEventListener('ended', () => {
    if (mode === 'single') { audio.currentTime = 0; play(); return; }
    if (mode === 'random' && playlist.length > 1) change(Math.ceil(Math.random() * (playlist.length - 1)));
    else change(1);
  });
  audio.addEventListener('error', () => { wantsPlayback = false; setState('idle'); shell.dataset.message = '当前歌曲暂时无法播放'; openBriefly(); });
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (link && new URL(link.href, location.href).origin === location.origin) save();
  }, { capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
  addEventListener('pagehide', save);
  addEventListener('pageshow', event => {
    if (!event.persisted) return;

    const latest = readSavedState();
    current = Math.max(0, Math.min(playlist.length - 1, Number(latest.current) || 0));
    restoredTime = Math.max(0, Number(latest.time) || 0);
    lastKnownTime = restoredTime;
    resumeTarget = 0;
    mode = ['list', 'single', 'random'].includes(latest.mode) ? latest.mode : 'list';
    wantsPlayback = Boolean(latest.playing);
    pendingPlayback = wantsPlayback;
    audio.volume = Math.max(0, Math.min(1, Number.isFinite(Number(latest.volume)) ? Number(latest.volume) : .82));
    volume.value = String(Math.round(audio.volume * 100));
    modeButton.textContent = mode === 'list' ? '列表循环' : mode === 'single' ? '单曲循环' : '随机播放';
    renderTitle();

    if (!wantsPlayback && !audio.paused) audio.pause();
    ensureSource();
    restorePosition(wantsPlayback);
  });
  shell.addEventListener('mouseenter', openBriefly);
  shell.addEventListener('mouseleave', () => {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (!panel.classList.contains('is-open') && !shell.matches(':focus-within')) shell.classList.remove('is-open');
    }, 420);
  });
  modeButton.textContent = mode === 'list' ? '列表循环' : mode === 'single' ? '单曲循环' : '随机播放';
  renderPanel();
  setPanel(false);
  if (wantsPlayback) play();
})();
