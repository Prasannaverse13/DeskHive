// DeskHive server. Runs the floor, the hive on disk, and serves the 3D app.
//
//   npm run dev     Vite dev mode with live reload of the web app
//   npm start       serve the built app from dist/
//
// Env:
//   DESKHIVE_RUNTIME   legacy: claude | api sets every agent's brain on first run
//   Keys: set them in the app (Connections) or with env vars like OPENAI_API_KEY, XAI_API_KEY
//   DESKHIVE_WORKSPACE folder the agents work in   (default ./workspace)
//   DESKHIVE_HIVE      hive folder                 (default ./hive)
//   DESKHIVE_CREW      crew file                   (default ./crew.json)
//   DESKHIVE_STT       auto | openai | local | off  (speech to text)
//   PORT / HTTPS_PORT  default 8080 / 8443

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Floor } from '../shared/floor.js';
import { DEFAULT_CREW, CMD, EVT, makeMessage, normalizeAgent } from '../shared/protocol.js';
import { STARTER_BACKLOG } from '../shared/mockRuntime.js';
import { Hive } from './hive.js';
import { createBrains } from './brains/index.js';
import { BrainConfig } from './brains/config.js';
import { createVoice } from './voice.js';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEV = process.argv.includes('--dev');
const PORT = Number(process.env.PORT || 8080);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const LEGACY = (process.env.DESKHIVE_RUNTIME || '').toLowerCase();
const WORKSPACE = path.resolve(ROOT, process.env.DESKHIVE_WORKSPACE || 'workspace');
const HIVE_DIR = path.resolve(ROOT, process.env.DESKHIVE_HIVE || 'hive');

fs.mkdirSync(WORKSPACE, { recursive: true });

// ---------- crew ----------
let crew = DEFAULT_CREW;
const crewFile = path.resolve(ROOT, process.env.DESKHIVE_CREW || 'crew.json');
if (fs.existsSync(crewFile)) {
  try { crew = JSON.parse(fs.readFileSync(crewFile, 'utf8')); console.log(`  crew:     ${crew.length} agents from crew.json`); } catch (e) { console.warn('crew.json is invalid, using default crew:', e.message); }
} else if (LEGACY === 'claude' || LEGACY === 'api') {
  crew = DEFAULT_CREW.map(a => ({ ...a, provider: LEGACY === 'claude' ? 'claude-cli' : 'anthropic' }));
}
crew = crew.map(normalizeAgent);
if (!crew.some(a => a.isBoss)) crew.unshift(normalizeAgent(DEFAULT_CREW[0]));

// ---------- hive + runtime ----------
const hive = new Hive(HIVE_DIR);
crew.forEach(a => hive.ensureAgent(a));
hive.writeRegistry(crew);

const config = new BrainConfig(ROOT);
// Claude Code permission prompts come back to us on this local URL with this token.
const APPROVE_TOKEN = crypto.randomBytes(16).toString('hex');
const runtime = createBrains({ hive, workspace: WORKSPACE, config, approval: { url: `http://127.0.0.1:${PORT}`, token: APPROVE_TOKEN } });
const voice = createVoice({ config, root: ROOT });
const LAN_IPS = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);

const saved = hive.readTasks();
const progressFile = path.join(HIVE_DIR, 'progress.json');
let savedProgress = null;
try { savedProgress = JSON.parse(fs.readFileSync(progressFile, 'utf8')); } catch { /* first run */ }
const floor = new Floor({
  runtime,
  crew,
  progress: savedProgress,
  backlog: saved.length ? [] : STARTER_BACKLOG,
  store: {
    onTask: (_t, all) => hive.writeTasks(all),
    onMail: msg => { hive.deliver(msg); hive.appendLog({ kind: 'mail', from: msg.from, to: msg.to, act: msg.act, subject: msg.subject }); },
    onMemory: (id, fact) => hive.appendMemory(id, fact),
    onLog: entry => hive.appendLog(entry),
    onConvo: (id, turn) => hive.appendConvo(id, turn),
    onSession: (id, sessionId) => hive.writeSession(id, sessionId),
    onProgress: p => { try { fs.writeFileSync(progressFile, JSON.stringify(p, null, 2)); } catch { /* */ } },
    onCrew: defs => {
      defs.forEach(a => hive.ensureAgent(a));
      hive.writeRegistry(defs);
      const tmp = `${crewFile}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(defs, null, 2));
      fs.renameSync(tmp, crewFile);
    },
  },
});
// Restore memory and open tasks from disk.
for (const a of crew) {
  floor.memory.set(a.id, hive.readMemory(a.id));
  floor.convo.set(a.id, hive.readConvo(a.id));
  const sid = hive.readSession(a.id);
  if (sid) floor.sessions.set(a.id, sid);
}
for (const t of saved) {
  if (t.status === 'done') { floor.tasks.push(t); continue; }
  floor.tasks.push({ ...t, status: 'backlog', assignee: null });
}

// Default brain: Meta Muse Spark with a key, otherwise free Llama on this laptop (Ollama).
// Agents still on the demo brain move over once per brain. If you move one back, it stays.
function adoptDefault(announce = true) {
  const d = runtime.defaultBrain();
  if (!d) return 0;
  const done = config.data.adopted || {};
  if (done[d.provider]) return 0;
  const moved = [...floor.agents.values()].filter(a => a.provider === 'demo');
  for (const a of moved) floor.updateAgent(a.id, { provider: d.provider, model: d.model });
  config.data.adopted = { ...done, [d.provider]: Date.now() };
  config.save();
  if (moved.length) {
    console.log(`  brain:    ${d.label} is now the default brain`);
    const who = moved.length === floor.agents.size ? 'The whole team now runs on it' : `${moved.length} of us now run on it`;
    if (announce) floor.say(floor.boss.id, d.provider === 'meta' ? `Meta Muse Spark is connected. ${who}.` : `Free Llama is running on this laptop (${d.model}). ${who}.`);
  }
  return moved.length;
}
adoptDefault(false);
runtime.onStatusChange(() => adoptDefault(true));

// Router for real CLI agents: they drop JSON files in their outbox.
setInterval(() => {
  for (const raw of hive.drainOutboxes([...floor.agents.keys()])) {
    const msg = makeMessage({
      from: raw.from,
      to: raw.to || 'human',
      act: raw.act || 'inform',
      subject: String(raw.subject || '').slice(0, 200),
      body: String(raw.body || ''),
      inReplyTo: raw.in_reply_to || null,
      hops: Number(raw.hops || 0) + 1,
    });
    floor.route(msg);
  }
}, 1000);

// ---------- web ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.wasm': 'application/wasm' };

let vite = null;
if (DEV) {
  const { createServer } = await import('vite');
  vite = await createServer({ configFile: path.join(ROOT, 'vite.config.js'), server: { middlewareMode: true, hmr: false }, appType: 'spa' });
}

function serveStatic(req, res) {
  const dist = path.join(ROOT, 'dist');
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(dist, p));
  if (!file.startsWith(dist) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    if (!fs.existsSync(path.join(dist, 'index.html'))) { res.writeHead(500); return res.end('Run npm run build first, or use npm run dev.'); }
    res.writeHead(200, { 'content-type': 'text/html' });
    return fs.createReadStream(path.join(dist, 'index.html')).pipe(res);
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

function readBody(req, limit = 12 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let n = 0;
    req.on('data', d => { n += d.length; if (n > limit) { reject(Object.assign(new Error('too large'), { code: 413 })); req.destroy(); } else chunks.push(d); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
}

// Only the laptop itself (the MCP helper) may call /api/approve.
const isLocal = req => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress);

async function api(req, res) {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/info') {
      return sendJson(res, 200, {
        mode: runtime.name, workspace: WORKSPACE, hive: HIVE_DIR, providers: runtime.providerStatus(), voice: voice.status(), metavr: runtime.metaVr?.() || null,
        headset: LAN_IPS.map(ip => `https://${ip}:${HTTPS_PORT}`), laptop: `http://localhost:${PORT}`,
      });
    }
    if (url.pathname === '/api/voice') return sendJson(res, 200, voice.status());
    if (url.pathname === '/api/stt' && req.method === 'POST') {
      const wav = await readBody(req);
      return sendJson(res, 200, await voice.transcribe(wav));
    }
    if (url.pathname === '/api/tts' && req.method === 'POST') {
      const { text, voice: v, style } = JSON.parse((await readBody(req, 64 * 1024)).toString() || '{}');
      const mp3 = await voice.speak(text, v, style);
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' });
      return res.end(mp3);
    }
    if (url.pathname === '/api/approve' && req.method === 'POST') {
      if (!isLocal(req)) return sendJson(res, 403, { behavior: 'deny', message: 'local only' });
      const body = JSON.parse((await readBody(req, 256 * 1024)).toString() || '{}');
      if (body.token !== APPROVE_TOKEN) return sendJson(res, 403, { behavior: 'deny', message: 'bad token' });
      return sendJson(res, 200, await runtime.approve({ agentId: body.agent, tool: body.tool, input: body.input }));
    }
    return sendJson(res, 404, { error: 'not found' });
  } catch (e) {
    return sendJson(res, e.code === 503 || e.code === 413 ? e.code : 500, { error: e.message });
  }
}

function handler(req, res) {
  if (req.url.startsWith('/api/')) return api(req, res);
  if (vite) return vite.middlewares(req, res, () => { res.writeHead(404); res.end(); });
  serveStatic(req, res);
}

// ---------- websocket hub ----------
const clients = new Set();
floor.on(evt => {
  const data = JSON.stringify(evt);
  for (const ws of clients) if (ws.readyState === 1) ws.send(data);
});

const VALID = new Set(Object.values(CMD));
function broadcast(evt) {
  const data = JSON.stringify(evt);
  for (const ws of clients) if (ws.readyState === 1) ws.send(data);
}
runtime.onStatusChange(() => broadcast({ type: EVT.PROVIDERS, providers: runtime.providerStatus(), voice: voice.status() }));
function attachWs(server) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', ws => {
    clients.add(ws);
    ws.send(JSON.stringify(floor.snapshot()));
    ws.on('message', raw => {
      let cmd;
      try { cmd = JSON.parse(raw); } catch { return; }
      if (!cmd || !VALID.has(cmd.type)) return;
      if (cmd.type === CMD.SET_KEYS) {
        config.setKeys(cmd);
        adoptDefault(true);
        return broadcast({ type: EVT.PROVIDERS, providers: runtime.providerStatus(), voice: voice.status() });
      }
      if (cmd.type === CMD.TEST_PROVIDER) {
        return runtime.test(cmd.provider, cmd.model).then(r => ws.send(JSON.stringify({ type: EVT.TEST_RESULT, provider: cmd.provider, ...r })));
      }
      Promise.resolve(floor.command(cmd)).catch(e => console.error('command failed', e));
    });
    ws.on('close', () => clients.delete(ws));
  });
}

const httpServer = http.createServer(handler);
attachWs(httpServer);
httpServer.listen(PORT, () => {
  const ready = runtime.providerStatus().filter(p => p.ready && p.id !== 'demo').map(p => p.id);
  console.log(`\n  DeskHive  brains ready: demo${ready.length ? ', ' + ready.join(', ') : ''}`);
  setTimeout(() => { const v = voice.status(); console.log(`  Voice:    ${v.sttLabel || 'browser only. ' + v.hint}`); }, 1500);
  console.log(`  Laptop:   http://localhost:${PORT}`);
});

// HTTPS so a Quest or VR glasses on your Wi-Fi can open it (WebXR needs a secure page).
try {
  const certDir = path.join(ROOT, '.cert');
  const keyFile = path.join(certDir, 'key.pem');
  const certFile = path.join(certDir, 'cert.pem');
  const ips = LAN_IPS;
  if (!fs.existsSync(keyFile)) {
    const selfsigned = (await import('selfsigned')).default;
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'deskhive.local' }], {
      days: 365, keySize: 2048,
      extensions: [{ name: 'subjectAltName', altNames: [{ type: 2, value: 'localhost' }, ...ips.map(ip => ({ type: 7, ip }))] }],
    });
    fs.mkdirSync(certDir, { recursive: true });
    fs.writeFileSync(keyFile, pems.private);
    fs.writeFileSync(certFile, pems.cert);
  }
  const httpsServer = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, handler);
  attachWs(httpsServer);
  httpsServer.listen(HTTPS_PORT, () => {
    for (const ip of ips) console.log(`  Headset:  https://${ip}:${HTTPS_PORT}   (accept the cert warning once)`);
    console.log('');
  });
} catch (e) {
  console.warn('HTTPS disabled:', e.message);
}
