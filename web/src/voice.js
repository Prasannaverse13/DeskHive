// Voice in and out for DeskHive.
//
// Hearing you (speech to text), best engine first:
//   server   the laptop transcribes (OpenAI key, or free local Whisper). Works in any headset browser.
//   browser  the browser's own speech recognition (desktop Chrome and Edge).
//   wasm     Whisper running inside this page (free, private). For the hosted link and Quest Browser,
//            which has no speech recognition. Downloads a 40 MB model once, then works offline.
// Modes:
//   push to talk   tap Talk (or hold Space). It stops by itself when you stop speaking.
//   hands free     always listening. Each sentence goes to whoever you name, look at or selected.
//
// Speaking (text to speech): each agent has its own voice. OpenAI voices when the laptop has a key,
// otherwise the browser voice with the agent's pitch and rate. Agents queue, they never talk over each other.

import { voiceById } from '@shared/protocol.js';
import { speakable } from '@shared/voiceRoute.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const WASM_OK = typeof WebAssembly === 'object' && !!(window.AudioContext || window.webkitAudioContext) && !!navigator.mediaDevices?.getUserMedia;
const WASM_MODEL = 'Xenova/whisper-tiny.en';
const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.2';

// Whisper in the page. Loaded on first use, then cached by the browser.
let wasmPipe = null;
function loadWasmWhisper(onProgress) {
  if (!wasmPipe) {
    wasmPipe = import(/* @vite-ignore */ TRANSFORMERS_URL)
      .then(t => t.pipeline('automatic-speech-recognition', WASM_MODEL, {
        dtype: 'q8',
        device: 'wasm',
        progress_callback: p => { if (p.status === 'progress' && p.total) onProgress?.(Math.round((p.loaded / p.total) * 100)); },
      }))
      .catch(e => { wasmPipe = null; throw e; });
  }
  return wasmPipe;
}
export const canSpeak = 'speechSynthesis' in window;

// ---------------------------------------------------------------- audio helpers
function downsample(chunks, from, to = 16000) {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const input = new Float32Array(total);
  let o = 0;
  for (const c of chunks) { input.set(c, o); o += c.length; }
  if (from === to) return input;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(total / ratio));
  for (let i = 0; i < out.length; i++) {
    // Average the window: a cheap low pass so it does not alias.
    const a = Math.floor(i * ratio);
    const b = Math.min(total, Math.floor((i + 1) * ratio));
    let s = 0;
    for (let j = a; j < b; j++) s += input[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

export function encodeWav(samples, rate = 16000) {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, samples.length * 2, true);
  // Normalize quiet speech a little, then write 16 bit samples.
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  const gain = peak > 0 && peak < 0.5 ? Math.min(4, 0.7 / peak) : 1;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i] * gain));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// Whisper says these on silence. Drop them.
export function cleanHeard(text) {
  const t = text.trim();
  if (/^\s*[([]?(blank_audio|silence|music|inaudible|no speech)[)\]]?\s*$/i.test(t) || /^(thanks for watching|thank you\.?|you)$/i.test(t)) return '';
  return t;
}

// ---------------------------------------------------------------- the voice controller
export class Voice {
  constructor({ onTranscript, onState }) {
    this.onTranscript = onTranscript; // (text, meta) => void
    this.onState = onState; // ({ state, level, text, engine }) => void
    this.state = 'off'; // off | idle | listening | hearing | transcribing
    this.mode = 'ptt'; // ptt | handsfree
    this.handsFree = false;
    this.level = 0;
    this.serverStt = null; // engine name from the laptop, or null
    this.serverTts = false;
    this.live = false;
    this.speakOn = true;
    this.queue = [];
    this.speaking = false;
    this.mutedUntil = 0;
    this.stream = null;
    this.ctx = null;
    this.rec = null; // browser recognition
    this.err = '';
    this.forceWasm = new URLSearchParams(location.search).has('wasm');
  }

  // ---------- engines ----------
  configure({ live, status }) {
    this.live = !!live;
    this.serverStt = live ? status?.stt || null : null;
    this.serverTts = !!(live && status?.tts);
    this.serverHint = status?.hint || '';
    this.emit();
  }

  get engine() {
    if (this.serverStt) return 'server';
    if (this.forceWasm && WASM_OK) return 'wasm';
    if (SR) return 'browser';
    if (WASM_OK) return 'wasm';
    return null;
  }

  // Load the in-page Whisper ahead of time so the first sentence is fast.
  warmUp() {
    if (this.engine !== 'wasm') return;
    loadWasmWhisper(pct => { this.loadPct = pct; this.emit({ interim: pct < 100 ? `Loading speech model ${pct}%` : '' }); })
      .then(() => { this.loadPct = 100; this.emit({ interim: '' }); })
      .catch(e => { this.err = `Speech model failed to load: ${e.message}`; this.emit(); });
  }

  get engineLabel() {
    if (this.serverStt === 'meta') return 'Meta Muse Voice Transcribe (laptop)';
    if (this.serverStt === 'openai') return 'OpenAI transcription (laptop)';
    if (this.serverStt === 'local') return 'Whisper on your laptop (free, private)';
    if (this.engine === 'wasm') return 'Whisper in this browser (free, private, 40 MB once)';
    if (SR) return 'Browser speech recognition';
    return 'No speech engine';
  }

  get canListen() { return !!this.engine; }

  emit(extra = {}) {
    this.onState?.({ state: this.state, level: this.level, engine: this.engine, handsFree: this.handsFree, speaking: this.speaking, error: this.err, ...extra });
  }

  // Ask for the mic once (call from a click so the browser allows it).
  async prepare() {
    if ((this.engine !== 'server' && this.engine !== 'wasm') || this.stream) return true;
    if (this.engine === 'wasm') this.warmUp();
    try {
      const audio = this.deviceId ? { deviceId: { exact: this.deviceId } } : true;
      this.stream = await navigator.mediaDevices.getUserMedia({ audio });
      this.micLabel = this.stream.getAudioTracks()[0]?.label || 'default mic';
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const src = this.ctx.createMediaStreamSource(this.stream);
      const proc = this.ctx.createScriptProcessor(2048, 1, 1);
      proc.onaudioprocess = e => this.onAudio(e.inputBuffer.getChannelData(0));
      src.connect(proc);
      // Some browsers only run the processor when it reaches the output. Send silence there.
      const mute = this.ctx.createGain();
      mute.gain.value = 0;
      proc.connect(mute).connect(this.ctx.destination);
      this.state = 'idle';
      this.err = '';
      this.emit();
      return true;
    } catch (e) {
      this.err = e.name === 'NotAllowedError' ? 'Mic blocked. Allow the microphone for this site.' : `Mic error: ${e.message}`;
      this.emit();
      return false;
    }
  }

  // The current mic is silent. Close it and switch to the next input device.
  async nextMic() {
    const dead = this.micLabel || 'default mic';
    try {
      const devs = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'communications');
      this.tried = this.tried || new Set();
      this.tried.add(dead);
      const next = devs.find(d => !this.tried.has(d.label) && d.deviceId !== this.deviceId);
      this.stream?.getTracks().forEach(t => t.stop());
      try { await this.ctx?.close(); } catch { /* */ }
      this.stream = null; this.ctx = null;
      if (next) {
        this.deviceId = next.deviceId;
        this.err = `No sound from "${dead}". Switched to "${next.label}". Press the mic and talk again.`;
      } else {
        this.deviceId = null; this.tried = new Set();
        this.err = `No sound from "${dead}". Windows Settings, Privacy, Microphone: allow desktop apps and your browser. Then check Sound, Input, and pick a working mic.`;
      }
    } catch (e) { this.err = `Mic is silent (${e.message}).`; }
    this.emit();
  }

  // ---------- push to talk ----------
  async start(meta = {}) {
    if (!this.engine) { this.err = this.serverHint || 'No speech engine here. Type instead, or add an OpenAI key.'; this.emit(); return false; }
    this.unlockAudio();
    this.meta = meta;
    if (this.engine === 'browser') return this.startBrowser(false);
    if (!(await this.prepare())) return false;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    this.mode = 'ptt';
    this.beginListening();
    return true;
  }

  stop() {
    if (this.engine === 'browser') { try { this.rec?.stop(); } catch { /* */ } return; }
    if (this.state === 'hearing') this.finishUtterance();
    else if (this.state === 'listening' && !this.handsFree) { this.state = 'idle'; this.emit(); }
  }

  // ---------- hands free ----------
  async setHandsFree(on) {
    if (on && !this.engine) { this.err = this.serverHint || 'No speech engine here.'; this.emit(); return false; }
    this.handsFree = on;
    this.unlockAudio();
    if (this.engine === 'browser') {
      if (on) this.startBrowser(true); else { try { this.rec?.abort(); } catch { /* */ } this.state = 'idle'; }
      this.emit();
      return true;
    }
    if (on) {
      if (!(await this.prepare())) { this.handsFree = false; this.emit(); return false; }
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.mode = 'handsfree';
      this.meta = {};
      this.beginListening();
    } else if (this.state === 'listening') { this.state = 'idle'; }
    this.emit();
    return true;
  }

  beginListening() {
    this.state = 'listening';
    this.chunks = [];
    this.pre = [];
    this.loud = 0;
    this.quiet = 0;
    this.heardMs = 0;
    this.waitedMs = 0;
    this.peak = 0;
    this.err = '';
    this.emit();
  }

  // Simple voice activity detection on 2048 sample frames.
  onAudio(frame) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    const rms = Math.sqrt(sum / frame.length);
    this.level = Math.min(1, rms * 12);
    const ms = (frame.length / this.ctx.sampleRate) * 1000;
    // Our own agents talking: do not hear them.
    if (this.speaking || performance.now() < this.mutedUntil) { this.emitLevel(); return; }
    this.noise = this.noise === undefined ? rms : this.noise;
    if ((this.state === 'listening' || this.state === 'idle') && rms < Math.max(0.004, this.noise * 2.5)) this.noise = this.noise * 0.95 + rms * 0.05;
    const start = Math.max(0.004, this.noise * 2.5);
    this.peak = Math.max(this.peak || 0, rms);
    const copy = new Float32Array(frame);

    if (this.state === 'listening') {
      this.pre.push(copy);
      if (this.pre.length > (this.mode === 'ptt' ? 120 : 8)) this.pre.shift();
      this.loud = rms > start ? this.loud + 1 : 0;
      if (this.loud >= 2) {
        this.state = 'hearing';
        this.chunks = [...this.pre];
        this.heardMs = 0;
        this.quiet = 0;
        this.emit();
      } else if (this.mode === 'ptt') {
        this.waitedMs += ms;
        if (this.waitedMs > 7000) {
          // Quiet mic: the detector never fired, but send what we recorded anyway.
          if (this.peak > 0.002) { this.chunks = [...this.pre]; this.heardMs = this.waitedMs; this.finishUtterance(); return; }
          this.state = 'idle'; this.emit();
          this.nextMic(); // this mic gave no sound: try the next one
          return;
        }
      }
    } else if (this.state === 'hearing') {
      this.chunks.push(copy);
      this.heardMs += ms;
      this.quiet = rms < start * 0.75 ? this.quiet + ms : 0;
      if (this.quiet > (this.mode === 'ptt' ? 1100 : 850) || this.heardMs > 20000) this.finishUtterance();
    }
    this.emitLevel();
  }

  emitLevel() {
    const now = performance.now();
    if (now - (this.lastLevelEmit || 0) > 80) { this.lastLevelEmit = now; this.emit(); }
  }

  async finishUtterance() {
    const chunks = this.chunks;
    const rate = this.ctx.sampleRate;
    const speechMs = this.heardMs;
    this.chunks = [];
    if (this.handsFree) this.beginListening(); else { this.state = 'transcribing'; this.emit(); }
    if (speechMs < 350) { if (!this.handsFree) { this.state = 'idle'; this.emit(); } return; }
    const wav = this.engine === 'wasm' ? null : encodeWav(downsample(chunks, rate));
    const meta = this.meta || {};
    this.emit({ busy: true });
    try {
      let j;
      if (this.engine === 'wasm') {
        const t0 = performance.now();
        const asr = await loadWasmWhisper(pct => this.emit({ busy: true, interim: `Loading speech model ${pct}%` }));
        const out = await asr(downsample(chunks, rate), { chunk_length_s: 30 });
        j = { text: cleanHeard(String(out?.text || '')), engine: 'wasm', ms: Math.round(performance.now() - t0) };
      } else {
        const res = await fetch('/api/stt', { method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav });
        j = await res.json();
        if (!res.ok) throw new Error(j.error || `speech server ${res.status}`);
      }
      if (j.text) this.onTranscript?.(j.text, { ...meta, engine: j.engine, ms: j.ms });
      else if (!this.handsFree) this.err = 'I did not catch that.';
    } catch (e) {
      this.err = e.message;
    }
    if (!this.handsFree) this.state = 'idle';
    this.emit({ busy: false });
  }

  // ---------- browser speech recognition ----------
  startBrowser(continuous) {
    try { this.rec?.abort(); } catch { /* */ }
    const rec = new SR();
    this.rec = rec;
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    rec.continuous = continuous;
    rec.maxAlternatives = 1;
    rec.onstart = () => { this.state = 'listening'; this.err = ''; this.emit(); };
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) {
          if (this.speaking || performance.now() < this.mutedUntil) continue;
          const text = r[0].transcript.trim();
          if (text) this.onTranscript?.(text, { ...(this.meta || {}), engine: 'browser' });
        } else interim += r[0].transcript;
      }
      this.state = interim ? 'hearing' : 'listening';
      this.emit({ interim });
    };
    rec.onerror = e => { if (e.error !== 'no-speech' && e.error !== 'aborted') { this.err = `Speech: ${e.error}`; this.emit(); } };
    rec.onend = () => {
      if (this.rec !== rec) return;
      if (this.handsFree) { try { rec.start(); } catch { /* */ } return; }
      this.state = 'idle';
      this.emit();
    };
    try { rec.start(); } catch (e) { this.err = e.message; this.emit(); return false; }
    return true;
  }

  // ---------- speaking ----------
  unlockAudio() {
    if (this.unlocked) return;
    this.unlocked = true;
    try { const a = new Audio(); a.muted = true; a.play().catch(() => {}); } catch { /* */ }
    if (canSpeak) { try { speechSynthesis.getVoices(); } catch { /* */ } }
  }

  setSpeak(on) {
    this.speakOn = on;
    if (!on) { this.queue = []; if (canSpeak) speechSynthesis.cancel(); this.audio?.pause(); this.speaking = false; this.emit(); }
  }

  // agent: { id, voice, isBoss }. Lines queue up so agents never talk over each other.
  say(agent, text) {
    if (!this.speakOn) return;
    const line = speakable(text);
    if (!line) return;
    this.queue.push({ agent, line });
    if (this.queue.length > 4) this.queue.splice(0, this.queue.length - 4);
    if (!this.speaking) this.next();
  }

  async next() {
    const item = this.queue.shift();
    if (!item) { this.speaking = false; this.mutedUntil = performance.now() + 350; this.emit(); return; }
    this.speaking = true;
    this.speakingId = item.agent?.id || null;
    this.emit();
    const v = voiceById(item.agent?.voice);
    try {
      if (this.serverTts) await this.playServer(item.line, v);
      else await this.playBrowser(item.line, v);
    } catch {
      try { await this.playBrowser(item.line, v); } catch { /* */ }
    }
    this.speakingId = null;
    this.next();
  }

  async playServer(text, v) {
    const res = await fetch('/api/tts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice: v.id, style: v.style }) });
    if (!res.ok) throw new Error('tts failed');
    const url = URL.createObjectURL(await res.blob());
    await new Promise(resolve => {
      const a = new Audio(url);
      this.audio = a;
      a.onended = a.onerror = () => { URL.revokeObjectURL(url); resolve(); };
      a.play().catch(() => resolve());
    });
  }

  playBrowser(text, v) {
    if (!canSpeak) return Promise.resolve();
    return new Promise(resolve => {
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = v.pitch;
      u.rate = v.rate;
      const voices = speechSynthesis.getVoices().filter(x => /^en/i.test(x.lang));
      if (voices.length) {
        // A stable browser voice per agent voice id.
        let h = 0;
        for (const ch of v.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        u.voice = voices[h % voices.length];
      }
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(done, 15000);
      u.onend = u.onerror = done;
      speechSynthesis.speak(u);
    });
  }
}
