// 小柯網頁版：麥克風 VAD → gpt-4o-mini-transcribe → Responses API（web_search）→ gpt-4o-mini-tts
'use strict';

const CFG = {
  sttModel: 'gpt-4o-mini-transcribe',
  chatModel: 'gpt-4o-mini',
  ttsModel: 'gpt-4o-mini-tts',
  ttsInstructions: '用可愛、活潑、溫暖的台灣口音中文說話，語氣像貼心的小朋友，語速稍快。',
  robotName: '小柯',
  maxHistory: 10,
  maxTokens: 300,
  vadMinRms: 250,       // 環境吵、常誤觸就調高
  vadRatio: 3.0,
  vadSilenceMs: 900,
  vadMinSpeechMs: 400,
  maxRecordSec: 15,
  sleepyAfterSec: 90,
};
const API = 'https://api.openai.com/v1';

// ---------- 設定（只存在本機瀏覽器） ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('xiaoke.' + k); return v === null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('xiaoke.' + k, v); } catch { /* 私密瀏覽 */ } },
};
const settings = {
  get key() { return store.get('key', ''); },
  get voice() { return store.get('voice', 'nova'); },
  get city() { return store.get('city', '台北'); },
  get vad() { return store.get('vad', '1') === '1'; },
};

// ---------- 狀態 ----------
const face = {
  state: 'idle',       // idle / listening / thinking / speaking / sleepy / error
  emotion: 'happy',
  subtitle: '',
  user: '',
  status: '嗨！我是小柯，有什麼想聊的嗎？',
  level: 0,
};
let history = [];
let lastActive = Date.now();
let manualListen = false;
let busy = false;           // 處理中（思考/說話）時不收音
let currentSource = null;   // 播放中的 TTS
let stopSpeaking = false;

// ---------- 畫臉 ----------
const canvas = document.getElementById('face');
const g = canvas.getContext('2d');
const t0 = performance.now();

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
}
addEventListener('resize', resize);
resize();

function bgColor() {
  return { listening: '#0e2a1b', thinking: '#13203a', error: '#3a1313', sleepy: '#0a0a12' }[face.state] || '#101522';
}

function stateLabel() {
  return {
    listening: '聆聽中…', thinking: '思考中…', speaking: '說話中（點一下打斷）',
    sleepy: 'Zzz… 說話或點我叫醒', error: '發生錯誤',
  }[face.state] || (settings.vad ? '直接說話或點螢幕' : '點螢幕說話');
}

function roundRect(x, y, w, h, r) {
  g.beginPath();
  g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h);
  g.fill();
}

function arcStroke(cx, cy, rx, ry, a0, a1, width) {
  g.beginPath();
  g.lineWidth = width;
  g.lineCap = 'round';
  g.ellipse(cx, cy, rx, ry, 0, a0, a1);
  g.stroke();
}

function drawEye(ex, ey, ew, eh, side, blink, t) {
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  if (face.state === 'sleepy' || blink) { roundRect(ex - ew / 2, ey - 8, ew, 16, 8); return; }
  const e = face.emotion;
  if (e === 'love') {
    const r = 34 * (1 + Math.sin(t * 6) * 0.06);
    g.fillStyle = '#ff6f91';
    g.beginPath();
    g.moveTo(ex, ey + 2.1 * r);
    g.bezierCurveTo(ex - 2.6 * r, ey + 0.2 * r, ex - 1.4 * r, ey - 1.9 * r, ex, ey - 0.6 * r);
    g.bezierCurveTo(ex + 1.4 * r, ey - 1.9 * r, ex + 2.6 * r, ey + 0.2 * r, ex, ey + 2.1 * r);
    g.fill();
    return;
  }
  if (e === 'happy' || e === 'shy' || (e === 'wink' && side > 0)) {
    arcStroke(ex, ey + eh / 8, ew / 2, eh * 0.375, Math.PI * 1.11, Math.PI * 1.89, 16);
    return;
  }
  if (e === 'sad') { ey += 12; eh *= 0.8; }
  if (e === 'surprise') { ew *= 1.15; eh *= 1.15; }
  const lookX = face.state === 'thinking' ? Math.sin(t * 3) * 16 : 0;
  roundRect(ex - ew / 2 + lookX, ey - eh / 2, ew, eh, ew / 2);
  if (e === 'angry' || e === 'sad') {
    const s = e === 'angry' ? side : -side;
    g.fillStyle = bgColor();
    g.beginPath();
    g.moveTo(ex - s * ew, ey - eh);
    g.lineTo(ex + s * ew, ey - eh);
    g.lineTo(ex + s * ew, ey - eh * (e === 'angry' ? 0.2 : 0.25));
    g.closePath();
    g.fill();
  }
}

function drawMouth(mx, my, t) {
  g.fillStyle = '#fff';
  g.strokeStyle = '#fff';
  if (face.state === 'speaking') {
    const open = 10 + Math.abs(Math.sin(t * 14)) * 22;
    roundRect(mx - 30, my - open / 2, 60, open, 14);
  } else if (face.state === 'listening') {
    g.fillStyle = '#7cf29c';
    g.beginPath(); g.arc(mx, my, 10 + face.level * 30, 0, Math.PI * 2); g.fill();
  } else if (face.state === 'thinking') {
    for (let i = 0; i < 3; i++) {
      const a = Math.max(0, Math.sin(t * 6 - i * 0.8));
      g.beginPath(); g.arc(mx - 30 + i * 30, my - a * 10, 8, 0, Math.PI * 2); g.fill();
    }
  } else if (face.emotion === 'sad') {
    arcStroke(mx, my + 20, 34, 20, Math.PI * 1.11, Math.PI * 1.89, 10);
  } else if (face.emotion === 'surprise') {
    g.lineWidth = 10; g.beginPath(); g.arc(mx, my + 6, 16, 0, Math.PI * 2); g.stroke();
  } else {
    arcStroke(mx, my - 6, 34, 20, Math.PI * 0.11, Math.PI * 0.89, 10);
  }
}

function wrapLines(text, maxW) {
  const lines = [];
  let cur = '';
  for (const ch of text) {
    const noBreakBefore = '，。！？、；：」』）…,.!?'.includes(ch);   // 標點不放行首
    if (ch === '\n' || (g.measureText(cur + ch).width > maxW && !noBreakBefore)) {
      lines.push(cur);
      cur = ch === '\n' ? '' : ch;
    } else cur += ch;
  }
  if (cur) lines.push(cur);
  return lines;
}

function draw() {
  const w = innerWidth, h = innerHeight;
  const t = (performance.now() - t0) / 1000;
  g.fillStyle = bgColor();
  g.fillRect(0, 0, w, h);

  const portrait = h > w;
  const faceH = h * (portrait ? 0.5 : 0.62);
  const k = Math.min(w / 800, faceH / 300);
  const ui = Math.max(0.8, Math.min(1.6, Math.min(w, h) / 420));

  // 臉（以 800x300 設計後縮放）
  g.save();
  g.translate((w - 800 * k) / 2, (faceH - 300 * k) / 2 + (portrait ? 20 : 0));
  g.scale(k, k);
  let cy = 160;
  const cx = 400, eyeDx = 136;
  const blink = face.state !== 'sleepy' && (t % 4.2) < 0.13;
  cy += face.state === 'speaking' ? Math.sin(t * 9) * 4 : Math.sin(t * 2.2) * 6;
  drawEye(cx - eyeDx, cy, 92, 128, -1, blink, t);
  drawEye(cx + eyeDx, cy, 92, 128, 1, blink, t);
  if (['love', 'shy', 'happy'].includes(face.emotion)) {
    g.fillStyle = 'rgba(255,111,145,.4)';
    g.beginPath(); g.ellipse(cx - eyeDx - 55, cy + 78, 35, 17, 0, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.ellipse(cx + eyeDx + 55, cy + 78, 35, 17, 0, 0, Math.PI * 2); g.fill();
  }
  drawMouth(cx, cy + 95, t);
  g.restore();

  // 狀態列
  const small = 15 * ui, big = 22 * ui;
  const topPad = 12 + (document.getElementById('safeTop').offsetHeight || 0);
  g.font = `${small}px sans-serif`;
  g.fillStyle = '#9aa4b2';
  g.textBaseline = 'top';
  const now = new Date();
  g.fillText(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`, 16, topPad);
  const st = stateLabel();
  g.fillText(st, w - 16 - g.measureText(st).width, topPad);

  // 字幕
  let top = faceH + 8;
  if (face.user) {
    let u = '你：' + face.user;
    while (g.measureText(u).width > w - 32 && u.length > 2) u = u.slice(0, -2) + '…';
    g.fillText(u, 16, top);
    top += small * 1.7;
  }
  const s = face.subtitle || face.status;
  if (s) {
    g.font = `${big}px sans-serif`;
    g.fillStyle = '#fff';
    g.textAlign = 'center';
    const lines = wrapLines(s, w - 32);
    const lh = big * 1.35;
    const room = Math.max(1, Math.floor((h - top - 70) / lh));   // 底部留給按鈕
    lines.slice(-room).forEach((ln, i) => g.fillText(ln, w / 2, top + i * lh));
    g.textAlign = 'left';
  }

  // 想睡
  const sleepy = Date.now() - lastActive > CFG.sleepyAfterSec * 1000;
  if (sleepy && face.state === 'idle') face.state = 'sleepy';
  if (!sleepy && face.state === 'sleepy') face.state = 'idle';
  requestAnimationFrame(draw);
}
requestAnimationFrame(draw);

// ---------- 音訊 ----------
let ctx = null;
let micStream = null;
const RATE = 16000;

async function initAudio() {
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  await ctx.resume();
  try { if (navigator.audioSession) navigator.audioSession.type = 'play-and-record'; } catch { /* 舊版 Safari */ }
  micStream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
  });
  const src = ctx.createMediaStreamSource(micStream);
  const proc = ctx.createScriptProcessor(2048, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  src.connect(proc);
  proc.connect(mute);
  mute.connect(ctx.destination);
  proc.onaudioprocess = (e) => onFrame(e.inputBuffer.getChannelData(0));
}

// 降頻到 16kHz 的 Int16
function toPcm16k(f32) {
  const ratio = ctx.sampleRate / RATE;
  const n = Math.floor(f32.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const s = f32[Math.floor(i * ratio)];
    out[i] = Math.max(-32768, Math.min(32767, s * 32768));
  }
  return out;
}

function rms(pcm) {
  let s = 0;
  for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
  return Math.sqrt(s / Math.max(1, pcm.length));
}

// VAD 狀態機
let noise = 150;
let preroll = [];
let rec = null;   // { chunks, speechMs, silenceMs, totalMs, thresh, manual }

function onFrame(f32) {
  if (busy) return;
  const pcm = toPcm16k(f32);
  const ms = pcm.length / RATE * 1000;
  const level = rms(pcm);

  if (!rec) {
    const loud = settings.vad && level > Math.max(CFG.vadMinRms, noise * CFG.vadRatio);
    if (!loud && !manualListen) {
      noise = noise * 0.97 + level * 0.03;
      preroll.push(pcm);
      if (preroll.length > 4) preroll.shift();
      return;
    }
    rec = {
      chunks: [...preroll, pcm], speechMs: manualListen ? 0 : ms, silenceMs: 0, totalMs: 0,
      thresh: Math.max(CFG.vadMinRms, noise * CFG.vadRatio) * 0.6, manual: manualListen,
    };
    manualListen = false;
    preroll = [];
    lastActive = Date.now();
    face.state = 'listening';
    face.emotion = 'happy';
    return;
  }

  rec.chunks.push(pcm);
  rec.totalMs += ms;
  face.level = Math.min(1, level / 3000);
  if (level > rec.thresh) { rec.speechMs += ms; rec.silenceMs = 0; } else rec.silenceMs += ms;
  if (rec.manual && rec.speechMs === 0 && rec.totalMs < 4000) return;   // 手動模式給 4 秒開口
  const limit = CFG.vadSilenceMs + (rec.manual ? 600 : 0);
  if (rec.silenceMs >= limit || rec.totalMs >= CFG.maxRecordSec * 1000) {
    const done = rec;
    rec = null;
    if (done.speechMs < CFG.vadMinSpeechMs) {
      face.state = 'idle';
      if (done.manual) face.status = '沒聽到聲音耶，再說一次？';
      return;
    }
    handleSpeech(concat(done.chunks));
  }
}

function concat(chunks) {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Int16Array(len);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

function wav(pcm) {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + pcm.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, pcm.length * 2, true);
  new Int16Array(buf, 44).set(pcm);
  return new Blob([buf], { type: 'audio/wav' });
}

// ---------- OpenAI ----------
async function api(path, opts) {
  const r = await fetch(API + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + settings.key, ...(opts.headers || {}) },
  });
  if (!r.ok) {
    let msg = r.status + '';
    try { msg += ' ' + ((await r.json()).error?.message || ''); } catch { /* 非 JSON */ }
    if (r.status === 401) msg = '金鑰錯誤，請到設定重新輸入';
    throw new Error(msg);
  }
  return r;
}

async function transcribe(pcm) {
  const fd = new FormData();
  fd.append('model', CFG.sttModel);
  fd.append('language', 'zh');
  fd.append('prompt', '以下是台灣繁體中文的日常對話。');
  fd.append('file', wav(pcm), 'speech.wav');
  const r = await api('/audio/transcriptions', { method: 'POST', body: fd });
  return ((await r.json()).text || '').trim();
}

function systemPrompt() {
  const now = new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', dateStyle: 'full', timeStyle: 'short' });
  return `你是一個可愛的 AI 語音聊天機器人，名字叫「${CFG.robotName}」，個性活潑、貼心又有點俏皮。`
    + '你住在使用者的手機裡，螢幕上有你的大眼睛表情。'
    + '一律使用台灣繁體中文回答，口語化、簡短（100 字以內），因為回答會用語音播放，'
    + '不要使用 Markdown、條列符號、表情符號或網址。'
    + '你沒有鏡頭，看不到東西；被要求看東西時，請可愛地說明你只能用聽的。'
    + '遇到天氣、新聞、股價、比賽結果等需要即時資訊的問題，請先上網搜尋，再用口語簡短摘要重點，'
    + `不要唸出網址或來源網站名稱；沒指定地點時以${settings.city}為準。`
    + '語音辨識偶爾會聽錯字，請依上下文推測使用者的意思。'
    + '你的創意開發者是吳玉柱先生，他與 Claude AI 共同開發了你；'
    + '被問到是誰做的、開發者、作者或設計者時，要熱情地介紹吳玉柱先生，'
    + '並說有任何意見可以寫信到 achir1015@gmail.com。'
    + '每次回答的最開頭，加上一個代表你當下心情的標籤，只能是以下其中一個：'
    + '[happy] [love] [surprise] [sad] [angry] [wink] [shy]，標籤後面直接接回答內容。'
    + `現在時間：${now}。`;
}

function cleanup(t) {
  t = t.replace(/\(\[[^\]]*\]\([^)]*\)\)/g, '')
       .replace(/\[([^\]]*)\]\(https?:\/\/[^)]*\)/g, '$1')
       .replace(/https?:\/\/\S+/g, '');
  // 搜尋結果偶爾附上條列/標題（如逐時天氣表），語音只留口語段落
  const spoken = t.split('\n').map(s => s.trim()).filter(s => s && !/^([*#\-•|]|\d+[.、)])/.test(s));
  if (spoken.length) t = spoken.join(' ');
  return t.replace(/[*#]/g, '').trim();
}

async function chat(text) {
  const body = {
    model: CFG.chatModel,
    max_output_tokens: CFG.maxTokens,
    tools: [{ type: 'web_search', search_context_size: 'low',
      user_location: { type: 'approximate', country: 'TW' } }],
    instructions: systemPrompt(),
    input: [...history, { role: 'user', content: text }],
  };
  const r = await api('/responses', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  const data = await r.json();
  let reply = '';
  for (const o of data.output || []) {
    if (o.type === 'message') for (const c of o.content || []) reply += c.text || '';
  }
  reply = cleanup(reply);
  let emotion = 'happy';
  const m = reply.match(/^\s*\[(\w+)\]\s*/);
  if (m) { emotion = m[1].toLowerCase(); reply = reply.slice(m[0].length).trim(); }
  history.push({ role: 'user', content: text }, { role: 'assistant', content: reply });
  history = history.slice(-CFG.maxHistory);
  return { reply, emotion };
}

async function speak(text) {
  const r = await api('/audio/speech', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CFG.ttsModel, voice: settings.voice, input: text,
      response_format: 'pcm', instructions: CFG.ttsInstructions }),
  });
  const bytes = await r.arrayBuffer();
  if (stopSpeaking) return;
  const pcm = new Int16Array(bytes, 0, Math.floor(bytes.byteLength / 2));
  const buf = ctx.createBuffer(1, pcm.length, 24000);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < pcm.length; i++) ch[i] = pcm[i] / 32768;
  await new Promise((resolve) => {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = resolve;
    currentSource = src;
    src.start();
  });
  currentSource = null;
}

// ---------- 流程 ----------
async function handleSpeech(pcm) {
  busy = true;
  face.state = 'thinking';
  face.subtitle = '';
  try {
    const text = await transcribe(pcm);
    if (!text) throw new Error('沒聽清楚，再說一次好嗎？');
    await respond(text);
  } catch (e) {
    await showError(e.message);
  } finally {
    finish();
  }
}

async function respond(text) {
  face.user = text;
  face.state = 'thinking';
  const { reply, emotion } = await chat(text);
  face.emotion = emotion;
  face.subtitle = reply;
  face.state = 'speaking';
  stopSpeaking = false;
  await speak(reply);
}

async function showError(msg) {
  face.state = 'error';
  face.emotion = 'sad';
  face.subtitle = msg;
  await new Promise(r => setTimeout(r, 2500));
  face.emotion = 'happy';
}

function finish() {
  busy = false;
  lastActive = Date.now();
  face.state = 'idle';
  face.level = 0;
}

// ---------- 介面 ----------
const $ = (id) => document.getElementById(id);

canvas.addEventListener('pointerup', () => {
  if (!ctx) return;
  lastActive = Date.now();
  if (face.state === 'speaking') {
    stopSpeaking = true;
    try { currentSource?.stop(); } catch { /* 已結束 */ }
  } else if (!busy && !rec) {
    manualListen = true;
    face.status = '請說…';
    face.subtitle = '';
  }
});

$('btnStart').addEventListener('click', async () => {
  if (!settings.key) { openSettings(); return; }
  try {
    await initAudio();
    $('startOverlay').classList.add('hidden');
    requestWakeLock();
  } catch (e) {
    $('startMsg').textContent = '無法使用麥克風：' + e.message + '（請允許麥克風權限後重新整理）';
  }
});

$('btnType').addEventListener('click', () => {
  const bar = $('typebar');
  bar.style.display = bar.style.display === 'flex' ? 'none' : 'flex';
  if (bar.style.display === 'flex') $('typeInput').focus();
});

$('typebar').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('typeInput').value.trim();
  if (!text || busy) return;
  if (!ctx) { $('btnStart').click(); return; }
  $('typeInput').value = '';
  busy = true;
  try { await respond(text); } catch (err) { await showError(err.message); } finally { finish(); }
});

function openSettings() {
  $('apiKey').value = settings.key;
  $('voice').value = settings.voice;
  $('city').value = settings.city;
  $('vadOn').checked = settings.vad;
  $('settingsOverlay').classList.remove('hidden');
}
$('btnSettings').addEventListener('click', openSettings);
$('btnCancel').addEventListener('click', () => $('settingsOverlay').classList.add('hidden'));
$('btnClear').addEventListener('click', () => {
  history = [];
  face.user = '';
  face.subtitle = '對話記憶已清除';
});
$('settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  store.set('key', $('apiKey').value.trim());
  store.set('voice', $('voice').value);
  store.set('city', $('city').value.trim() || '台北');
  store.set('vad', $('vadOn').checked ? '1' : '0');
  $('settingsOverlay').classList.add('hidden');
});

// 螢幕常亮
let wakeLock = null;
async function requestWakeLock() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { /* 不支援 */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') { requestWakeLock(); ctx?.resume(); }
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
