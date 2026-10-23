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

// ---- 頭盔機器人（與 LX04 / P4 版同一造型）----
const GLOW = '#40e8ff', GLOW_DIM = '#1e6e87', RED2 = '#ff4664', PINK = '#ff6f91', VISOR = '#162a42';

function rrPath(x, y, w, h, r) {
  g.beginPath();
  g.roundRect ? g.roundRect(x, y, w, h, r) : g.rect(x, y, w, h);
}
function rr(x, y, w, h, r, c) { g.fillStyle = c; rrPath(x, y, w, h, r); g.fill(); }
function rrGrad(x, y, w, h, r, c1, c2) {
  const gr = g.createLinearGradient(0, y, 0, y + h);
  gr.addColorStop(0, c1); gr.addColorStop(1, c2);
  g.fillStyle = gr; rrPath(x, y, w, h, r); g.fill();
}
function ell(cx, cy, rx, ry, c) { g.fillStyle = c; g.beginPath(); g.ellipse(cx, cy, Math.max(rx, 0.5), Math.max(ry, 0.5), 0, 0, Math.PI * 2); g.fill(); }
function glowOn(c, b) { g.shadowColor = c; g.shadowBlur = b; }
function glowOff() { g.shadowBlur = 0; }
function gArc(cx, cy, r, a0, a1, th, c) {   // 角度：度，順時針（0 = 右）
  glowOn(c, 12); g.strokeStyle = c; g.lineWidth = th; g.lineCap = 'round';
  g.beginPath(); g.arc(cx, cy, r, a0 * Math.PI / 180, a1 * Math.PI / 180); g.stroke(); glowOff();
}
function gLine(x0, y0, x1, y1, th, c) {
  glowOn(c, 12); g.strokeStyle = c; g.lineWidth = th; g.lineCap = 'round';
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); glowOff();
}
function gPill(cx, cy, w, h, c) { glowOn(c, 14); rr(cx - w / 2, cy - h / 2, w, h, w / 2, c); glowOff(); }
function gHeart(cx, cy, r, c) {
  glowOn(c, 12); g.fillStyle = c; g.beginPath();
  g.moveTo(cx, cy + r * 0.9);
  g.bezierCurveTo(cx - r * 1.3, cy - r * 0.1, cx - r * 0.7, cy - r, cx, cy - r * 0.3);
  g.bezierCurveTo(cx + r * 0.7, cy - r, cx + r * 1.3, cy - r * 0.1, cx, cy + r * 0.9);
  g.fill(); glowOff();
}

function expression() {
  if (face.state === 'sleepy') return 'sleepy';
  if (face.state === 'listening') return 'listen';
  if (face.state === 'thinking') return 'think';
  if (face.state === 'error') return 'sad';
  return ['love', 'surprise', 'sad', 'angry', 'wink', 'shy', 'happy'].includes(face.emotion) ? face.emotion : 'normal';
}

function drawRobot(X, Y, s, ex, lx, ly, blink, mouth, t) {
  const S = (v) => v * s;
  const c = ex === 'angry' ? RED2 : GLOW;

  // 耳罩
  for (const side of [-1, 1]) {
    const cx = X + side * S(121);
    rrGrad(cx - S(19), Y - S(44), S(38), S(92), S(16), '#b0bed2', '#687892');
    rr(cx - S(5) + side * S(6), Y - S(30), S(9), S(56), S(5), '#ced8e8');
  }
  // 頭盔：陰影 + 白色漸層 + 反光
  rr(X - S(125), Y - S(96), S(250), S(198), S(90), '#808a9a');
  rrGrad(X - S(124), Y - S(99), S(248), S(194), S(88), '#fcfdff', '#c4cbd6');
  ell(X - S(62), Y - S(80), S(34), S(9), '#ffffff');
  // 面罩
  rr(X - S(102), Y - S(71), S(204), S(142), S(56), '#344660');
  rrGrad(X - S(98), Y - S(67), S(196), S(134), S(52), '#1e3450', '#091220');
  ell(X - S(50), Y - S(52), S(32), S(7), '#2c4666');

  const ey = Y - S(10), dx = S(44), my = Y + S(34), th = Math.max(2, S(5));
  const talking = mouth > 0.05;
  const smiley = ['normal', 'happy', 'wink', 'love', 'shy'].includes(ex);

  if (ex === 'shy' || ex === 'love')
    for (const side of [-1, 1]) ell(X + side * S(68), Y + S(20), S(15), S(6), 'rgba(255,111,145,.55)');

  // 嘴巴
  if (talking) {
    const rx = S(15), ry = Math.max(S(4), S(4 + 13 * mouth));
    glowOn(c, 12); ell(X, my - S(4), rx, ry, c); glowOff();
    if (ry > S(7)) ell(X, my - S(4), rx - S(5), ry - S(5), '#0e3c52');
  } else if (smiley) {
    gArc(X, my - S(18), S(18), 35, 145, th, c);                 // 微笑 ︶
  } else if (ex === 'surprise' || ex === 'listen') {
    const r = S(ex === 'surprise' ? 9 : 7) + (ex === 'listen' ? Math.min(S(6), face.level * S(10)) : 0);
    glowOn(c, 12); ell(X, my - S(2), r, r, c); glowOff();
    if (ex === 'listen') ell(X, my - S(2), Math.max(1, r - th), Math.max(1, r - th), VISOR);
  } else if (ex === 'sad' || ex === 'angry') {
    gArc(X, my + S(12), S(16), 215, 325, th, c);                // 嘴角下垂 ︵
  } else if (ex === 'think') {
    for (let i = 0; i < 3; i++) {
      const on = Math.floor(t * 4) % 3 === i;
      glowOn(c, on ? 10 : 0); ell(X + (i - 1) * S(14), my - S(2), S(4), S(4), on ? c : GLOW_DIM); glowOff();
    }
  } else if (ex === 'sleepy') {
    gArc(X, my + S(4), S(8), 200, 340, th, c);
  } else {
    gLine(X - S(13), my - S(2), X + S(13), my - S(2), th, c);
  }

  // 眼睛
  const ew = S(22), eh = S(32);
  for (const side of [-1, 1]) {
    const cx = X + side * dx, x = cx + lx, y = ey + ly;
    switch (ex) {
      case 'happy': case 'shy': gArc(cx, ey + S(8), S(12), 200, 340, th + 1, c); break;      // 瞇眼笑 ∩
      case 'wink': if (side < 0) gLine(cx - S(11), ey, cx + S(11), ey, th + 1, c); else gPill(x, y, ew, eh, c); break;
      case 'love': gHeart(cx, ey - S(2), S(15) + S(2) * Math.sin(t * 6.7), PINK); break;
      case 'surprise': glowOn(c, 14); ell(cx, ey, S(10), S(10), c); glowOff(); break;
      case 'sleepy': gArc(cx, ey - S(6), S(11), 20, 160, th, c); break;                      // 想睡 ∪
      case 'think': gPill(cx + S(6), ey - S(8), ew, S(20), c); break;
      default: {
        const w = ex === 'listen' ? S(25) : ew;
        const hh = ex === 'listen' ? S(36) : ex === 'angry' ? S(24) : ex === 'sad' ? S(26) : eh;
        if (blink && ex !== 'listen') gLine(x - w / 2, y, x + w / 2, y, th + 1, c);
        else gPill(x, y, w, hh, c);
        if (ex === 'sad') gLine(x - S(13), y - hh / 2 - S(7) + S(5) * side, x + S(13), y - hh / 2 - S(7) - S(5) * side, th, c);
        if (ex === 'angry') gLine(x - S(13), y - hh / 2 - S(9) - S(6) * side, x + S(13), y - hh / 2 - S(9) + S(6) * side, th, c);
      }
    }
  }

  // 想睡 Zzz（頭盔外右上）
  if (ex === 'sleepy') {
    const kz = Math.floor(t * 2) % 3;
    glowOn(GLOW, 8); g.fillStyle = GLOW; g.textBaseline = 'alphabetic';
    g.font = `bold ${14 * s + 8}px sans-serif`; g.fillText('z', X + 100 * s, Y - 78 * s - kz * 3);
    g.font = `bold ${20 * s + 10}px sans-serif`; g.fillText('Z', X + 114 * s, Y - 96 * s - kz * 3);
    glowOff();
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
  const k = Math.min(w / 440, faceH / 300);   // 頭盔機器人約 400 寬，以 440x300 為設計框
  const ui = Math.max(0.8, Math.min(1.6, Math.min(w, h) / 420));

  // 臉：頭盔機器人（以 800x300 設計後縮放）
  g.save();
  g.translate((w - 440 * k) / 2, (faceH - 300 * k) / 2 + (portrait ? 20 : 0));
  g.scale(k, k);
  const ex = expression();
  const blink = ex !== 'sleepy' && ex !== 'listen' && (t % 4.2) < 0.13;
  const lx = ex === 'think' ? Math.sin(t * 3) * 8 : 0, ly = ex === 'think' ? Math.cos(t * 2.1) * 4 : 0;
  const mouth = face.state === 'speaking' ? 0.3 + Math.abs(Math.sin(t * 13)) * 0.7 : 0;
  const bob = face.state === 'speaking' ? Math.sin(t * 9) * 3 : Math.sin(t * 2.2) * 4;
  drawRobot(220, 158 + bob, 1.35, ex, lx, ly, blink, mouth, t);
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
