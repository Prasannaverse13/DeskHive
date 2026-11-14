// Voice on the server, so it works on any headset browser.
//
// Speech to text, first that works:
//   1. Meta (if a Meta Model API key is set)  muse-voice-transcribe-1.0
//   2. OpenAI (if an OpenAI key is set)       gpt-4o-mini-transcribe, falls back to whisper-1
//   3. Local Whisper on this laptop (free)    @huggingface/transformers, model downloads once
// Text to speech:
//   OpenAI voices (if an OpenAI key is set), otherwise the browser speaks.
//
// Env: DESKHIVE_STT = auto | meta | openai | local | off,  DESKHIVE_WHISPER_MODEL (default Xenova/whisper-base.en)

import path from 'node:path';

const STT_MODELS = ['gpt-4o-mini-transcribe', 'whisper-1'];
const TTS_MODELS = ['gpt-4o-mini-tts', 'tts-1'];

// Parse a 16 bit PCM WAV into mono Float32 samples.
export function decodeWav(buf) {
  if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV file');
  let off = 12;
  let fmt = null;
  let data = null;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    else if (id === 'data') { data = buf.subarray(body, Math.min(buf.length, body + size)); break; }
    off = body + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('bad WAV');
  if (fmt.format !== 1 || fmt.bits !== 16) throw new Error('WAV must be 16 bit PCM');
  const frames = Math.floor(data.length / 2 / fmt.channels);
  const out = new Float32Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) sum += data.readInt16LE((i * fmt.channels + c) * 2);
    out[i] = sum / fmt.channels / 32768;
  }
  return { samples: out, rate: fmt.rate };
}

function resample(samples, from, to) {
  if (from === to) return samples;
  const ratio = from / to;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const x = i * ratio;
    const j = Math.floor(x);
    const f = x - j;
    out[i] = (samples[j] || 0) * (1 - f) + (samples[j + 1] || 0) * f;
  }
  return out;
}

export function createVoice({ config, root }) {
  const pref = (process.env.DESKHIVE_STT || 'auto').toLowerCase();
  const whisperModel = process.env.DESKHIVE_WHISPER_MODEL || 'Xenova/whisper-base.en';
  let localLib = null; // the transformers module, if installed
  let localPipe = null; // a loaded pipeline promise
  let localState = 'checking'; // checking | ready | loading | missing | error
  let localError = '';
  const ttsCache = new Map();

  // Is local Whisper installed? (optional dependency)
  import('@huggingface/transformers').then(m => {
    localLib = m;
    localState = 'ready';
    try { m.env.cacheDir = path.join(root, '.models'); } catch { /* */ }
  }).catch(() => { localState = 'missing'; });

  const metaKey = () => config.key('meta');
  const metaBase = () => config.baseUrl('meta') || 'https://api.meta.ai/v1';
  const openaiKey = () => config.key('openai');
  const openaiBase = () => config.baseUrl('openai') || 'https://api.openai.com/v1';

  function sttEngine() {
    if (pref === 'off') return null;
    if ((pref === 'auto' || pref === 'meta') && metaKey()) return 'meta';
    if ((pref === 'auto' || pref === 'openai') && openaiKey()) return 'openai';
    if ((pref === 'auto' || pref === 'local') && localLib) return 'local';
    return null;
  }

  function status() {
    const stt = sttEngine();
    return {
      stt,
      sttLabel: stt === 'meta' ? 'Meta Muse Voice Transcribe' : stt === 'openai' ? 'OpenAI transcription' : stt === 'local' ? `Whisper on this laptop (${whisperModel.split('/').pop()})` : null,
      local: localState,
      localError,
      tts: openaiKey() ? 'openai' : null,
      hint: stt ? '' : localState === 'checking' ? 'Checking for local Whisper…' : 'Add a Meta or OpenAI key in Connections, or run npm install to get free local Whisper.',
    };
  }

  async function openaiTranscribe(wav) {
    let lastErr;
    for (const model of STT_MODELS) {
      const form = new FormData();
      form.append('file', new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
      form.append('model', model);
      form.append('response_format', 'json');
      const res = await fetch(`${openaiBase()}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${openaiKey()}` }, body: form });
      if (res.ok) return String((await res.json()).text || '').trim();
      lastErr = new Error(`OpenAI transcription ${res.status}: ${(await res.text()).slice(0, 160)}`);
      if (res.status !== 400 && res.status !== 404) break;
    }
    throw lastErr;
  }

  // Meta Model API speech to text: multipart WAV (mono 16 bit, 16 kHz) to /asr/transcribe.
  async function metaTranscribe(wav) {
    let lastErr;
    for (const field of ['file', 'audio']) {
      const form = new FormData();
      form.append(field, new Blob([wav], { type: 'audio/wav' }), 'speech.wav');
      form.append('model', 'muse-voice-transcribe-1.0');
      form.append('response_format', 'json');
      const res = await fetch(`${metaBase()}/asr/transcribe`, { method: 'POST', headers: { authorization: `Bearer ${metaKey()}`, accept: 'application/json' }, body: form });
      const raw = await res.text();
      if (res.ok) {
        let j;
        try { j = JSON.parse(raw); } catch { return raw.trim(); } // plain text answer
        const segs = j.segments || j.results || j.utterances;
        return String(j.text ?? j.transcript ?? j.transcription ?? (Array.isArray(segs) ? segs.map(x => x.text || x.transcript || '').join(' ') : '')).trim();
      }
      lastErr = new Error(`Meta transcription ${res.status}: ${raw.slice(0, 160)}`);
      if (res.status !== 400 && res.status !== 422) break;
    }
    throw lastErr;
  }

  async function localTranscribe(wav) {
    if (!localLib) throw new Error('Local Whisper is not installed. Run npm install.');
    if (!localPipe) {
      localState = 'loading';
      localPipe = localLib.pipeline('automatic-speech-recognition', whisperModel, { dtype: 'q8' })
        .then(p => { localState = 'ready'; return p; })
        .catch(e => { localState = 'error'; localError = e.message; localPipe = null; throw e; });
    }
    const asr = await localPipe;
    const { samples, rate } = decodeWav(wav);
    const audio = resample(samples, rate, 16000);
    const out = await asr(audio, { chunk_length_s: 30 });
    return String(out?.text || '').trim();
  }

  async function transcribe(wav) {
    const engine = sttEngine();
    if (!engine) throw Object.assign(new Error(status().hint), { code: 503 });
    const t0 = Date.now();
    let text;
    try {
      text = engine === 'meta' ? await metaTranscribe(wav) : engine === 'openai' ? await openaiTranscribe(wav) : await localTranscribe(wav);
    } catch (e) {
      // A cloud engine failed: fall back to the next one we have.
      if (pref !== 'auto') throw e;
      if (engine === 'meta' && openaiKey()) text = await openaiTranscribe(wav);
      else if (engine !== 'local' && localLib) text = await localTranscribe(wav);
      else throw e;
    }
    // Whisper says these on silence. Drop them.
    if (/^\s*[([]?(blank_audio|silence|music|inaudible|no speech)[)\]]?\s*$/i.test(text) || /^(thanks for watching|thank you\.?)$/i.test(text.trim())) text = '';
    return { text, engine, ms: Date.now() - t0 };
  }

  async function speak(text, voice = 'alloy', style = '') {
    if (!openaiKey()) throw Object.assign(new Error('No OpenAI key for voices. The browser will speak.'), { code: 503 });
    const input = String(text || '').slice(0, 600);
    const key = `${voice}|${style}|${input}`;
    if (ttsCache.has(key)) return ttsCache.get(key);
    let lastErr;
    for (const model of TTS_MODELS) {
      const body = { model, voice, input, response_format: 'mp3' };
      if (model === 'gpt-4o-mini-tts' && style) body.instructions = style;
      const res = await fetch(`${openaiBase()}/audio/speech`, { method: 'POST', headers: { authorization: `Bearer ${openaiKey()}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        ttsCache.set(key, buf);
        if (ttsCache.size > 80) ttsCache.delete(ttsCache.keys().next().value);
        return buf;
      }
      lastErr = new Error(`OpenAI speech ${res.status}: ${(await res.text()).slice(0, 160)}`);
      if (res.status !== 400 && res.status !== 404) break;
    }
    throw lastErr;
  }

  return { status, transcribe, speak };
}
