(function () {
  'use strict';

  const STORAGE_KEY = 'nono-music-player-v1';
  const source = 'assets/music/love-can-be-more.mp3';
  const readSavedState = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch (_) { return {}; }
  };
  let saved = readSavedState();
  if (!saved.playing && !Number(saved.time)) return;

  const style = document.createElement('style');
  style.textContent = '.site-music-resume{position:fixed;z-index:70;left:18px;bottom:max(18px,env(safe-area-inset-bottom));display:grid;width:44px;height:44px;padding:0;place-items:center;color:#413c38;border:1px solid rgba(36,33,31,.16);border-radius:50%;background:rgba(250,250,250,.94);box-shadow:0 10px 30px rgba(36,33,31,.08);font:500 13px/1 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;backdrop-filter:blur(10px);cursor:pointer;transition:width .22s cubic-bezier(.22,1,.36,1),padding .22s cubic-bezier(.22,1,.36,1),opacity .18s,transform .22s cubic-bezier(.22,1,.36,1)}.site-music-resume[data-blocked="true"]{width:auto;min-width:44px;padding:0 15px;border-radius:999px;font-size:12px;letter-spacing:.04em}.site-music-resume[data-blocked="true"][data-compact="true"]{width:44px;min-width:44px;padding:0;border-radius:50%;font-size:13px;letter-spacing:0}.site-music-resume:hover{transform:translateY(-2px)}@media(prefers-reduced-motion:reduce){.site-music-resume{transition:none}}';
  document.head.append(style);

  const audio = document.createElement('audio');
  const initialWantsPlayback = Boolean(saved.playing);
  audio.preload = initialWantsPlayback ? 'auto' : 'none';
  if (initialWantsPlayback) audio.src = source;
  audio.volume = Math.max(0, Math.min(1, Number.isFinite(Number(saved.volume)) ? Number(saved.volume) : .82));
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'site-music-resume';
  button.textContent = '♫';
  button.title = '爱可以再更多一点点（原版）';
  button.setAttribute('aria-label', '继续播放音乐');
  document.body.append(audio, button);

  let wantsPlayback = Boolean(saved.playing);
  let saveTimer = 0;
  let collapseTimer = 0;
  let resumeTarget = Math.max(0, Number(saved.time) || 0);
  let lastKnownTime = resumeTarget;
  const ensureSource = () => {
    if (audio.getAttribute('src')) return;
    audio.src = source;
    audio.load();
  };
  const store = () => {
    lastKnownTime = Math.max(0, Number(resumeTarget || audio.currentTime || lastKnownTime) || 0);
    saved = {
      current: 0,
      time: lastKnownTime,
      volume: audio.volume,
      mode: saved.mode || 'list',
      playing: wantsPlayback
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  };
  const setButton = blocked => {
    clearTimeout(collapseTimer);
    button.dataset.blocked = String(blocked);
    button.dataset.compact = 'false';
    button.textContent = blocked ? '继续音乐' : audio.paused ? '♫' : 'Ⅱ';
    button.title = blocked ? '点击继续播放 · 爱可以再更多一点点（原版）' : '爱可以再更多一点点（原版）';
    button.setAttribute('aria-label', blocked || audio.paused ? '继续播放音乐' : '暂停音乐');
    if (blocked) collapseTimer = setTimeout(() => {
      if (button.dataset.blocked === 'true') {
        button.dataset.compact = 'true';
        button.textContent = '♫';
      }
    }, 4500);
  };
  const expandBlockedButton = () => {
    if (button.dataset.blocked !== 'true') return;
    button.dataset.compact = 'false';
    button.textContent = '继续音乐';
    clearTimeout(collapseTimer);
    collapseTimer = setTimeout(() => {
      if (button.dataset.blocked === 'true' && !button.matches(':hover,:focus-visible')) {
        button.dataset.compact = 'true';
        button.textContent = '♫';
      }
    }, 3000);
  };
  const play = async () => {
    wantsPlayback = true;
    ensureSource();
    if (resumeTarget && audio.readyState < audio.HAVE_METADATA) {
      store();
      return;
    }
    try {
      await audio.play();
      setButton(false);
      store();
    } catch (_) { setButton(true); }
  };

  audio.addEventListener('loadedmetadata', () => {
    const resumeAt = resumeTarget ? Math.min(resumeTarget, Math.max(0, audio.duration - .2)) : 0;
    resumeTarget = resumeAt;
    if (!resumeAt || Math.abs(audio.currentTime - resumeAt) < .1) {
      resumeTarget = 0;
      if (wantsPlayback) play();
      return;
    }
    audio.addEventListener('seeked', () => {
      resumeTarget = 0;
      if (wantsPlayback) play();
    }, { once: true });
    audio.currentTime = resumeAt;
  }, { once: true });
  audio.addEventListener('timeupdate', () => {
    if (!saveTimer) saveTimer = setTimeout(() => { saveTimer = 0; store(); }, 1200);
  });
  audio.addEventListener('ended', () => { resumeTarget = 0; lastKnownTime = 0; audio.currentTime = 0; play(); });
  button.onclick = () => {
    if (audio.paused) play();
    else { wantsPlayback = false; audio.pause(); setButton(false); store(); }
  };
  button.addEventListener('mouseenter', expandBlockedButton);
  button.addEventListener('focus', expandBlockedButton);
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href]');
    if (link && new URL(link.href, location.href).origin === location.origin) store();
  }, { capture: true });
  document.addEventListener('visibilitychange', () => { if (document.hidden) store(); });
  addEventListener('pagehide', store);
  addEventListener('pageshow', event => {
    if (!event.persisted) return;

    saved = readSavedState();
    wantsPlayback = Boolean(saved.playing);
    resumeTarget = Math.max(0, Number(saved.time) || 0);
    lastKnownTime = resumeTarget;
    audio.volume = Math.max(0, Math.min(1, Number.isFinite(Number(saved.volume)) ? Number(saved.volume) : .82));
    if (!wantsPlayback && !audio.paused) audio.pause();

    const restore = () => {
      const resumeAt = resumeTarget ? Math.min(resumeTarget, Math.max(0, audio.duration - .2)) : 0;
      resumeTarget = resumeAt;
      if (!resumeAt || Math.abs(audio.currentTime - resumeAt) < .1) {
        resumeTarget = 0;
        setButton(false);
        if (wantsPlayback) play();
        return;
      }
      audio.addEventListener('seeked', () => {
        resumeTarget = 0;
        setButton(false);
        if (wantsPlayback) play();
      }, { once: true });
      audio.currentTime = resumeAt;
    };
    if (wantsPlayback) ensureSource();
    if (audio.readyState < audio.HAVE_METADATA || !Number.isFinite(audio.duration)) {
      audio.addEventListener('loadedmetadata', restore, { once: true });
    } else restore();
  });
  setButton(wantsPlayback);
})();
