import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { routeUtterance, speakable, findAgent } from '../shared/voiceRoute.js';
import { decodeWav, createVoice } from '../server/voice.js';
import { Floor } from '../shared/floor.js';
import { DEFAULT_CREW, normalizeAgent, VOICES } from '../shared/protocol.js';
import { createMockRuntime } from '../shared/mockRuntime.js';

const crew = DEFAULT_CREW.map(normalizeAgent);

test('voice routing: names, tell X to, team, focus, fuzzy', () => {
  const r = (t, o) => routeUtterance(t, crew, o);
  assert.deepEqual([r('Kai, fix the header').to, r('Kai, fix the header').text], ['kai', 'Fix the header']);
  assert.equal(r('hey Mira can you check auth').to, 'mira');
  assert.deepEqual([r('tell Leo to run the tests').to, r('tell Leo to run the tests').text], ['leo', 'Run the tests']);
  assert.equal(r('ask zara whether staging is up').to, 'zara');
  assert.equal(r('everyone, standup please').to, null);
  assert.equal(r('Nova, what is the status').to, null);
  assert.equal(r('ship the docs').to, null, 'no name, no focus: boss');
  assert.equal(r('ship the docs', { focusId: 'theo' }).to, 'theo', 'looked at Theo');
  assert.equal(r('Then build the page', { focusId: 'kai' }).to, 'kai', '"Then" is not Theo');
  assert.equal(r('Kye, fix it').to, 'kai', 'fuzzy name with a comma');
  assert.equal(r('Kye fix it').to, null, 'no fuzzy without a comma');
  assert.ok(r('Ravi').pickOnly, 'just a name picks the agent');
  assert.equal(r('  '), null);
  assert.equal(findAgent('leo', crew).id, 'leo');
});

test('speakable trims markdown and length', () => {
  assert.equal(speakable('**Done.** See `app.js` at https://x.y/z'), 'Done. See app.js at a link');
  const long = 'First sentence is here. '.repeat(30);
  assert.ok(speakable(long).length <= 281);
  assert.ok(speakable(long).endsWith('.'));
});

function wav(samples, rate = 16000) {
  const b = Buffer.alloc(44 + samples.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + samples.length * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => b.writeInt16LE(Math.round(s * 32767), 44 + i * 2));
  return b;
}

test('WAV decode', () => {
  const s = Array.from({ length: 1600 }, (_, i) => Math.sin(i / 10) * 0.5);
  const { samples, rate } = decodeWav(wav(s));
  assert.equal(rate, 16000);
  assert.equal(samples.length, 1600);
  assert.ok(Math.abs(samples[100] - s[100]) < 0.001);
  assert.throws(() => decodeWav(Buffer.from('nope')));
});

test('server STT and TTS through an OpenAI style endpoint', async () => {
  const got = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      got.push({ url: req.url, auth: req.headers.authorization, size: body.length, type: req.headers['content-type'] });
      if (req.url.endsWith('/audio/transcriptions')) { res.setHeader('content-type', 'application/json'); return res.end(JSON.stringify({ text: 'Kai, what are you working on?' })); }
      if (req.url.endsWith('/audio/speech')) { res.setHeader('content-type', 'audio/mpeg'); return res.end(Buffer.from([0xff, 0xfb, 0x90, 0x00])); }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => srv.listen(0, r));
  const config = { key: id => (id === 'openai' ? 'sk-test' : ''), baseUrl: () => `http://localhost:${srv.address().port}/v1` };
  const v = createVoice({ config, root: '/tmp' });
  assert.equal(v.status().stt, 'openai');
  assert.equal(v.status().tts, 'openai');
  const out = await v.transcribe(wav(new Array(8000).fill(0.1)));
  assert.equal(out.text, 'Kai, what are you working on?');
  assert.equal(out.engine, 'openai');
  assert.match(got[0].type, /multipart\/form-data/);
  assert.equal(got[0].auth, 'Bearer sk-test');
  const mp3 = await v.speak('Hello there', 'coral', 'Bright');
  assert.equal(mp3.length, 4);
  srv.close();
});

test('direct chat: the agent answers you, remembers, and takes steering', async () => {
  const f = new Floor({ runtime: createMockRuntime({ speed: 40, askHumanRate: 0, askPeerRate: 0 }), crew: DEFAULT_CREW });
  const lines = [];
  f.on(e => { if (e.type === 'chat') lines.push(e.line); });
  await f.humanSay('hello there?', 'kai');
  await new Promise(r => setTimeout(r, 300));
  const reply = lines.find(l => l.from === 'kai');
  assert.ok(reply, 'Kai answered in chat');
  assert.equal(f.convo.get('kai').length, 2, 'conversation saved: human + agent');
  assert.equal(f.convo.get('kai')[1].role, 'agent');
  // No card on the tray for a chat.
  assert.ok(!f.tasks.some(t => t.kind === 'work' && t.title === 'hello there?'));
  // Work by voice, then steer it while it runs.
  await f.humanSay('build the settings page', 'mira');
  await new Promise(r => setTimeout(r, 40));
  assert.ok(f.running.has('mira'));
  await f.humanSay('make it dark themed', 'mira');
  assert.ok(lines.some(l => l.from === 'mira' && /Adjusting|Folding|Changing/.test(l.text)), 'ack while working');
  await new Promise(r => setTimeout(r, 600));
  assert.ok(f.terms.get('mira').some(t => t.includes('noted: make it dark themed')), 'running task heard it');
  // Voice commands.
  await f.humanSay('status', 'leo');
  assert.ok(lines.at(-1).from === 'leo');
  // Boss answers a question without making tasks.
  const before = f.tasks.length;
  await f.humanSay('how is everyone doing?');
  assert.equal(f.tasks.length, before);
  assert.ok(lines.at(-1).from === 'nova');
});

test('every agent gets a voice', () => {
  for (const a of crew) assert.ok(VOICES.some(v => v.id === a.voice));
  assert.equal(crew.find(a => a.isBoss).voice, 'nova');
  assert.equal(normalizeAgent({ id: 'x', voice: 'onyx' }).voice, 'onyx');
});

test('Meta speech to text through /asr/transcribe', async () => {
  const seen = [];
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', d => chunks.push(d));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('latin1');
      seen.push({ url: req.url, auth: req.headers.authorization, model: /muse-voice-transcribe-1\.0/.test(body), wav: body.includes('RIFF') });
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ text: 'Mira, deploy staging' }));
    });
  });
  await new Promise(r => srv.listen(0, r));
  const config = { key: id => (id === 'meta' ? 'mk' : ''), baseUrl: id => (id === 'meta' ? `http://localhost:${srv.address().port}/v1` : '') };
  const v = createVoice({ config, root: '/tmp' });
  assert.equal(v.status().stt, 'meta');
  assert.equal(v.status().sttLabel, 'Meta Muse Voice Transcribe');
  const out = await v.transcribe(wav(new Array(8000).fill(0.1)));
  assert.equal(out.text, 'Mira, deploy staging');
  assert.deepEqual(seen[0], { url: '/v1/asr/transcribe', auth: 'Bearer mk', model: true, wav: true });
  srv.close();
});
