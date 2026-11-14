// Connects the 3D app to a floor. Live server over WebSocket when one is running,
// otherwise a demo floor that runs right in the browser (for the hosted link).

import { EVT } from '@shared/protocol.js';

export class HiveClient {
  constructor() {
    this.agents = new Map();
    this.tasks = new Map();
    this.chat = [];
    this.terms = new Map();
    this.mode = 'connecting';
    this.listeners = new Set();
    this.ws = null;
    this.local = null;
    this.providers = [];
    this.testResults = new Map();
    this.voice = null; // speech status from the laptop
    this.info = null; // /api/info: headset links etc
    this.progress = null; // xp, level, streak, daily goal
  }

  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(evt) { for (const fn of this.listeners) fn(evt); }

  async connect() {
    const params = new URLSearchParams(location.search);
    const forceDemo = params.has('demo') || import.meta.env.MODE === 'demo';
    if (!forceDemo) {
      const ok = await this.tryWs();
      if (ok) { this.send({ type: 'hello', at: Date.now() }); return; }
    }
    await this.startLocal();
    this.send({ type: 'hello', at: Date.now() });
  }

  tryWs() {
    return new Promise(resolve => {
      const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
      let settled = false;
      let ws;
      try { ws = new WebSocket(url); } catch { return resolve(false); }
      const timer = setTimeout(() => { if (!settled) { settled = true; try { ws.close(); } catch { /* */ } resolve(false); } }, 8000);
      ws.onmessage = e => {
        const evt = JSON.parse(e.data);
        if (!settled && evt.type === EVT.SNAPSHOT) { settled = true; clearTimeout(timer); this.ws = ws; resolve(true); this.refreshInfo(); }
        this.ingest(evt);
      };
      ws.onerror = () => { if (!settled) { settled = true; clearTimeout(timer); resolve(false); } };
      ws.onclose = () => {
        if (this.ws === ws) {
          this.mode = 'offline';
          this.emit({ type: 'mode' });
          setTimeout(() => this.reconnect(), 2000);
        }
      };
    });
  }

  async reconnect() {
    const ok = await this.tryWs();
    if (!ok) setTimeout(() => this.reconnect(), 3000);
  }

  async startLocal() {
    const [{ Floor }, { DEFAULT_CREW, PROVIDERS }, { createMockRuntime, STARTER_BACKLOG }] = await Promise.all([
      import('@shared/floor.js'), import('@shared/protocol.js'), import('@shared/mockRuntime.js'),
    ]);
    let crew = DEFAULT_CREW;
    let progress = null;
    try { progress = JSON.parse(localStorage.getItem('deskhive.progress') || 'null'); } catch { /* */ }
    try { const saved = JSON.parse(localStorage.getItem('deskhive.crew') || 'null'); if (Array.isArray(saved) && saved.length) crew = saved; } catch { /* private mode */ }
    const runtime = createMockRuntime();
    // In the browser demo every brain runs on the scripted demo brain.
    runtime.providerStatus = () => PROVIDERS.map(p => ({ id: p.id, ready: p.id === 'demo', reason: p.id === 'demo' ? 'built in' : 'run the local server (npm start) to use this brain' }));
    this.local = new Floor({
      runtime, crew, backlog: STARTER_BACKLOG, progress,
      store: {
        onCrew: defs => { try { localStorage.setItem('deskhive.crew', JSON.stringify(defs)); } catch { /* */ } },
        onProgress: p => { try { localStorage.setItem('deskhive.progress', JSON.stringify(p)); } catch { /* */ } },
      },
    });
    this.local.on(evt => this.ingest(JSON.parse(JSON.stringify(evt))));
    this.ingest(JSON.parse(JSON.stringify(this.local.snapshot())));
  }

  send(cmd) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(cmd));
    else if (this.local) this.local.command(cmd);
  }

  ingest(evt) {
    switch (evt.type) {
      case EVT.SNAPSHOT:
        this.mode = evt.mode;
        this.agents = new Map(evt.agents.map(a => [a.id, a]));
        this.tasks = new Map(evt.tasks.map(t => [t.id, t]));
        this.chat = evt.chat;
        this.terms = new Map(Object.entries(evt.terms || {}));
        this.providers = evt.providers || [];
        this.progress = evt.progress || this.progress;
        break;
      case EVT.PROGRESS: this.progress = evt.progress; break;
      case EVT.AGENT_REMOVED: this.agents.delete(evt.id); break;
      case EVT.PROVIDERS: this.providers = evt.providers || []; if (evt.voice) { this.voice = evt.voice; this.emit({ type: 'voice' }); } break;
      case EVT.TEST_RESULT: this.testResults.set(evt.provider, { ok: evt.ok, text: evt.text, at: Date.now() }); break;
      case EVT.AGENT: this.agents.set(evt.agent.id, evt.agent); break;
      case EVT.TASK: this.tasks.set(evt.task.id, evt.task); break;
      case EVT.TASK_REMOVED: this.tasks.delete(evt.id); break;
      case EVT.CHAT: this.chat.push(evt.line); if (this.chat.length > 100) this.chat.shift(); break;
      case EVT.TERM: {
        const lines = this.terms.get(evt.agentId) || [];
        lines.push(...String(evt.text).split('\n'));
        if (lines.length > 200) lines.splice(0, lines.length - 200);
        this.terms.set(evt.agentId, lines);
        break;
      }
      default: break;
    }
    this.emit(evt);
  }

  // Laptop info: speech engines, headset links. Polls while local Whisper is still being detected.
  async refreshInfo() {
    try {
      const j = await (await fetch('/api/info')).json();
      this.info = j;
      this.voice = j.voice;
      this.emit({ type: 'voice' });
      if (j.voice?.local === 'checking') setTimeout(() => this.refreshInfo(), 1500);
    } catch { /* offline */ }
  }

  // Helpers
  say(text, to = null) { this.send({ type: 'say', text, to }); }
  assign(taskId, agentId) { this.send({ type: 'assign', taskId, agentId }); }
  answer(agentId, text) { this.send({ type: 'answer', agentId, text }); }
  stop(agentId) { this.send({ type: 'stop', agentId }); }
  status(agentId = null) { this.send({ type: 'status', agentId }); }
  hire(agent) { this.send({ type: 'hire', agent }); }
  updateAgent(id, patch) { this.send({ type: 'update_agent', id, patch }); }
  fire(id) { this.send({ type: 'fire', id }); }
  setKeys(keys, baseUrls = {}) { this.send({ type: 'set_keys', keys, baseUrls }); }
  testProvider(provider, model) {
    if (this.local) { this.ingest({ type: EVT.TEST_RESULT, provider, ok: provider === 'demo', text: provider === 'demo' ? 'Demo brain is built in.' : 'Start the local server (npm start) to connect real brains.' }); return; }
    this.testResults.delete(provider);
    this.send({ type: 'test_provider', provider, model });
  }
  get isLive() { return !!this.ws; }
  providerReady(id) { return this.providers.find(p => p.id === id)?.ready ?? id === 'demo'; }
  backlog() { return [...this.tasks.values()].filter(t => t.status === 'backlog' && t.kind === 'work'); }
}
