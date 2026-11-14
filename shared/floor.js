// The Floor: the heart of DeskHive. Runs anywhere (Node server or browser demo).
// It owns the crew, the task ledger, the mail router and the boss orchestration.
// A pluggable runtime does the actual thinking and work.

import { STATUS, ACT, EVT, MAX_HOPS, makeMessage, uid, shortStatus, normalizeAgent, WORKER_SEATS, MAX_WORKERS, slug, providerById, XP, DAILY_GOAL, levelFor, dayKey, freshProgress } from './protocol.js';

class Emitter {
  constructor() { this.handlers = new Set(); }
  on(fn) { this.handlers.add(fn); return () => this.handlers.delete(fn); }
  emit(evt) { for (const h of this.handlers) { try { h(evt); } catch (e) { console.error(e); } } }
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  if (signal) signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('stopped')); }, { once: true });
});

export class Floor extends Emitter {
  /**
   * @param {object} opts
   * @param {object} opts.runtime  { name, plan(), run() }
   * @param {Array}  opts.crew     crew definitions
   * @param {object} [opts.store]  optional persistence hooks (server)
   * @param {Array}  [opts.backlog] starter task titles for the tray
   */
  constructor({ runtime, crew, store = null, backlog = [], progress = null }) {
    super();
    this.runtime = runtime;
    this.store = store;
    this.agents = new Map();
    this.tasks = [];
    this.chat = [];
    this.inbox = new Map(); // agentId -> messages
    this.queue = new Map(); // agentId -> taskIds
    this.running = new Map(); // agentId -> AbortController
    this.questions = new Map(); // agentId -> { question, resolve }
    this.memory = new Map(); // agentId -> facts
    this.terms = new Map(); // agentId -> recent lines
    this.convo = new Map(); // agentId -> [{ role: 'human' | 'agent', text, ts }] direct conversation
    this.steer = new Map(); // agentId -> human messages waiting to reach a running task
    this.steerWaiters = new Map(); // agentId -> Set(fn) runtimes that want to be poked
    this.sessions = new Map(); // agentId -> CLI session id (Claude Code resume)
    this.progress = { ...freshProgress(), ...(progress || {}) };
    for (const c of crew) this.addAgent(normalizeAgent(c));
    for (const title of backlog) this.newTask(title, { silent: true });
  }

  get boss() { return [...this.agents.values()].find(a => a.isBoss); }
  get workers() { return [...this.agents.values()].filter(a => !a.isBoss); }

  addAgent(def) {
    const agent = {
      ...def,
      status: STATUS.IDLE,
      activity: '',
      progress: 0,
      taskId: null,
      question: null,
      doneCount: 0,
      runtime: def.provider || 'demo',
    };
    this.agents.set(agent.id, agent);
    this.inbox.set(agent.id, []);
    this.queue.set(agent.id, []);
    this.memory.set(agent.id, []);
    this.terms.set(agent.id, []);
    this.convo.set(agent.id, []);
    this.steer.set(agent.id, []);
    this.steerWaiters.set(agent.id, new Set());
    return agent;
  }

  // ---------- crew management ----------
  crewDefs() {
    return [...this.agents.values()].map(a => normalizeAgent(a));
  }

  saveCrew() { this.store?.onCrew?.(this.crewDefs()); }

  freeSeat() {
    const used = new Set([...this.agents.values()].map(a => a.seat));
    return WORKER_SEATS.find(s => !used.has(s)) || null;
  }

  hire(def = {}) {
    if (this.workers.length >= MAX_WORKERS) { this.say(this.boss.id, `The floor is full (${MAX_WORKERS} desks). Fire someone first.`); return null; }
    const used = new Set([...this.agents.values()].map(a => a.seat));
    const seat = def.seat && WORKER_SEATS.includes(def.seat) && !used.has(def.seat) ? def.seat : this.freeSeat();
    let id = slug(def.name);
    while (this.agents.has(id) || id === 'human' || id === 'you') id = `${slug(def.name)}-${Math.random().toString(36).slice(2, 5)}`;
    const agent = this.addAgent(normalizeAgent({ ...def, id, seat, isBoss: false }));
    this.emit({ type: EVT.AGENT, agent: this.publicAgent(agent) });
    this.say(this.boss.id, `Welcome ${agent.name}, our new ${agent.role}. Brain: ${providerById(agent.provider).label}${agent.model ? ` (${agent.model})` : ''}.`);
    this.saveCrew();
    return agent;
  }

  updateAgent(id, patch = {}) {
    const a = this.agents.get(id);
    if (!a) return null;
    const allowed = ['name', 'role', 'instructions', 'skills', 'provider', 'model', 'autonomy', 'look', 'voice'];
    const next = { ...a };
    for (const k of allowed) if (patch[k] !== undefined) next[k] = patch[k];
    if (patch.seat && !a.isBoss && WORKER_SEATS.includes(patch.seat) && ![...this.agents.values()].some(o => o.id !== id && o.seat === patch.seat)) next.seat = patch.seat;
    const clean = normalizeAgent(next);
    if (clean.provider !== a.provider) { this.sessions.delete(id); this.store?.onSession?.(id, null); }
    Object.assign(a, clean, { id: a.id, isBoss: a.isBoss, seat: clean.seat || a.seat, runtime: clean.provider });
    this.emit({ type: EVT.AGENT, agent: this.publicAgent(a) });
    this.saveCrew();
    return a;
  }

  fire(id) {
    const a = this.agents.get(id);
    if (!a || a.isBoss) return false;
    this.stop(id);
    for (const t of this.tasks) {
      if (t.assignee === id && t.status !== 'done' && t.kind === 'work') { t.assignee = null; t.status = 'backlog'; this.saveTask(t); }
    }
    for (const m of [this.agents, this.inbox, this.queue, this.memory, this.terms, this.questions, this.running, this.convo, this.steer, this.steerWaiters, this.sessions]) m.delete(id);
    this.emit({ type: EVT.AGENT_REMOVED, id });
    this.say(this.boss.id, `${a.name} has left the floor. Their open tasks are back on the tray.`);
    this.saveCrew();
    return true;
  }

  snapshot() {
    return {
      type: EVT.SNAPSHOT,
      mode: this.runtime.name,
      providers: this.runtime.providerStatus?.() || [],
      agents: [...this.agents.values()].map(a => this.publicAgent(a)),
      tasks: this.tasks,
      chat: this.chat.slice(-40),
      progress: this.progressView(),
      terms: Object.fromEntries([...this.terms.entries()].map(([k, v]) => [k, v.slice(-60)])),
    };
  }

  publicAgent(a) {
    return { ...a, inbox: this.inbox.get(a.id)?.length || 0, queued: this.queue.get(a.id)?.length || 0, memory: (this.memory.get(a.id) || []).slice(-5) };
  }

  // ---------- emit helpers ----------
  patchAgent(id, patch) {
    const a = this.agents.get(id);
    if (!a) return;
    Object.assign(a, patch);
    this.emit({ type: EVT.AGENT, agent: this.publicAgent(a) });
    this.store?.onAgent?.(a);
  }

  term(id, text) {
    const lines = this.terms.get(id);
    if (!lines) return;
    for (const l of String(text).split('\n')) lines.push(l);
    if (lines.length > 300) lines.splice(0, lines.length - 300);
    this.emit({ type: EVT.TERM, agentId: id, text: String(text) });
    this.store?.onTerm?.(id, String(text));
  }

  say(from, text) {
    const line = { from, text, ts: Date.now() };
    this.chat.push(line);
    if (this.chat.length > 200) this.chat.shift();
    this.emit({ type: EVT.CHAT, line });
    this.store?.onLog?.({ kind: 'chat', ...line });
  }

  // Remember the direct conversation between the human and one agent.
  talk(agentId, role, text) {
    const list = this.convo.get(agentId);
    if (!list || !text) return;
    const turn = { role, text: String(text).slice(0, 2000), ts: Date.now() };
    list.push(turn);
    if (list.length > 30) list.splice(0, list.length - 30);
    this.store?.onConvo?.(agentId, turn);
  }

  pushSteer(agentId, text) {
    this.steer.get(agentId)?.push(text);
    for (const fn of this.steerWaiters.get(agentId) || []) { try { fn(text); } catch (e) { console.error(e); } }
  }

  log(text) {
    const line = { text, ts: Date.now() };
    this.emit({ type: EVT.LOG, line });
    this.store?.onLog?.({ kind: 'log', ...line });
  }

  saveTask(task) {
    this.emit({ type: EVT.TASK, task });
    this.store?.onTask?.(task, this.tasks);
  }

  // ---------- tasks ----------
  newTask(title, { detail = '', assignee = null, kind = 'work', message = null, silent = false } = {}) {
    const task = { id: uid('task'), key: `DH-${100 + this.tasks.length}`, title, detail, kind, message, assignee: null, status: 'backlog', result: '', createdAt: Date.now() };
    this.tasks.push(task);
    if (!silent) this.log(`New task ${task.key}: ${title}`);
    this.saveTask(task);
    if (assignee) this.assign(task.id, assignee, { from: this.boss?.id });
    return task;
  }

  assign(taskId, agentId, { from = 'human' } = {}) {
    const task = this.tasks.find(t => t.id === taskId);
    const agent = this.agents.get(agentId);
    if (!task || !agent) return false;
    if (task.status === 'active') return false;
    if (task.assignee) {
      const q = this.queue.get(task.assignee);
      const i = q.indexOf(task.id);
      if (i >= 0) q.splice(i, 1);
    }
    task.assignee = agentId;
    task.status = 'queued';
    this.saveTask(task);
    this.queue.get(agentId).push(task.id);
    if (task.kind === 'work') {
      const msg = makeMessage({ from: from || 'human', to: agentId, act: ACT.REQUEST, subject: task.title, body: task.detail });
      this.emit({ type: EVT.MAIL, message: msg });
      this.store?.onMail?.(msg);
    }
    this.patchAgent(agentId, {});
    this.pump(agentId);
    return true;
  }

  // ---------- human entry points ----------
  async humanSay(text, to = null) {
    text = String(text || '').trim();
    if (!text) return;
    const target = to && this.agents.get(to);
    this.say('you', target && !target.isBoss ? `@${target.name} ${text}` : text);

    // Answer a waiting agent.
    const blocked = [...this.questions.keys()];
    if (target && this.questions.has(target.id)) return this.answer(target.id, text);
    if (!target && blocked.length === 1 && /^(yes|no|ok|okay|sure|go|ship|approve|approved|deny|stop|wait|nope|yep|y|n)\b/i.test(text)) {
      return this.answer(blocked[0], text);
    }

    if (!target && /^(status|team status|what('?s| is) (everyone|the team) (doing|up to)|standup)\??$/i.test(text)) {
      return this.say(this.boss.id, this.statusReport());
    }

    // Talking straight to a worker skips the boss. It is a conversation: the agent answers
    // in its own words, and does the work first if you asked for something.
    if (target && !target.isBoss) return this.directTalk(target, text);
    return this.bossPlan(text);
  }

  directTalk(agent, text) {
    if (/^(stop|cancel|halt|abort)( it| that| now| please)?[.!]*$/i.test(text)) {
      this.stop(agent.id);
      return this.say(agent.id, 'Stopped. Tell me what you want next.');
    }
    if (/^(status|progress|update|what are you (doing|working on)|how('?s| is) it going)\??$/i.test(text)) {
      return this.say(agent.id, this.statusReport(agent.id));
    }
    this.talk(agent.id, 'human', text);
    if (this.running.has(agent.id)) {
      const current = this.tasks.find(t => t.id === agent.taskId);
      if (this.runtime.canSteer?.(agent)) {
        this.pushSteer(agent.id, text);
        this.term(agent.id, `human: ${text}`);
        this.say(agent.id, pick(['Got it. Adjusting now.', 'On it. Folding that in.', 'Heard you. Changing course.']));
        return;
      }
      this.newTask(text, { kind: 'chat', assignee: agent.id, silent: true });
      this.say(agent.id, `Got it. I will do that right after ${current ? `"${current.title}"` : 'this'}.`);
      return;
    }
    this.newTask(text, { kind: 'chat', assignee: agent.id, silent: true });
  }

  async bossPlan(text) {
    const boss = this.boss;
    this.patchAgent(boss.id, { status: STATUS.THINKING, activity: 'planning' });
    this.term(boss.id, `> ${text}`);
    this.talk(boss.id, 'human', text);
    let plan;
    try {
      plan = await this.runtime.plan({ text, crew: [...this.agents.values()], boss, floor: this, context: this.teamContext(), conversation: [...this.convo.get(boss.id)].slice(0, -1) });
    } catch (e) {
      this.term(boss.id, `plan failed: ${e.message}`);
      plan = { reply: `I could not plan that (${e.message}). I put it on the tray.`, tasks: [{ agentId: null, title: text }] };
    }
    const lines = [];
    for (const t of plan.tasks || []) {
      const agent = t.agentId && this.agents.get(t.agentId);
      if (agent && !agent.isBoss) {
        this.newTask(t.title, { detail: t.detail || '', assignee: agent.id });
        lines.push(`${agent.name}: ${t.title}`);
      } else {
        this.newTask(t.title, { detail: t.detail || '' });
        lines.push(`tray: ${t.title}`);
      }
    }
    if (lines.length) this.term(boss.id, lines.map(l => `  routed ${l}`).join('\n'));
    this.say(boss.id, plan.reply || 'On it.');
    this.talk(boss.id, 'agent', plan.reply || 'On it.');
    this.patchAgent(boss.id, { status: STATUS.IDLE, activity: '' });
  }

  // What the boss knows when it answers: who is doing what, and what got done lately.
  teamContext() {
    const now = this.workers.map(a => {
      const task = a.taskId && this.tasks.find(t => t.id === a.taskId);
      if (a.status === STATUS.BLOCKED) return `- ${a.name}: waiting for the human: ${a.question}`;
      if (task) return `- ${a.name}: ${a.status} on "${task.title}" (${Math.round((a.progress || 0) * 100)}%)`;
      return `- ${a.name}: ${a.status}`;
    }).join('\n');
    const done = this.tasks.filter(t => t.status === 'done' && t.kind === 'work').slice(-6)
      .map(t => `- ${this.name(t.assignee)} finished "${t.title}": ${t.result}`).join('\n');
    const tray = this.tasks.filter(t => t.status === 'backlog' && t.kind === 'work').map(t => `- ${t.title}`).slice(0, 8).join('\n');
    return `Right now:\n${now || '(nobody)'}\n\nRecently done:\n${done || '(nothing yet)'}\n\nOn the tray:\n${tray || '(empty)'}`;
  }

  answer(agentId, text) {
    const q = this.questions.get(agentId);
    if (!q) return false;
    this.questions.delete(agentId);
    const agent = this.agents.get(agentId);
    this.term(agentId, `human: ${text}`);
    this.patchAgent(agentId, { status: STATUS.WORKING, question: null, activity: 'got your answer' });
    this.say(this.boss.id, `Passed your answer to ${agent.name}.`);
    q.resolve(text);
    this.gain(XP.answer);
    return true;
  }

  stop(agentId) {
    const ctrl = this.running.get(agentId);
    if (ctrl) ctrl.abort();
    const q = this.questions.get(agentId);
    if (q) { this.questions.delete(agentId); q.resolve('stop'); }
    this.patchAgent(agentId, { status: STATUS.IDLE, activity: 'stopped by you', question: null, progress: 0 });
  }

  statusReport(agentId = null) {
    const list = agentId ? [this.agents.get(agentId)].filter(Boolean) : this.workers;
    const busy = list.filter(a => a.status === STATUS.WORKING || a.status === STATUS.THINKING).length;
    const blocked = list.filter(a => a.status === STATUS.BLOCKED);
    const head = agentId ? '' : `${busy} working, ${blocked.length} need you, ${this.tasks.filter(t => t.status === 'backlog').length} on the tray.\n`;
    return head + list.map(a => {
      const task = a.taskId && this.tasks.find(t => t.id === a.taskId);
      if (a.status === STATUS.BLOCKED) return `${a.name}: needs you. ${a.question}`;
      if (task) return `${a.name}: ${task.title} (${Math.round(a.progress * 100)}%)`;
      return `${a.name}: ${shortStatus(a)}${a.doneCount ? `, ${a.doneCount} done` : ''}`;
    }).join('\n');
  }

  // ---------- mail router ----------
  route(msg) {
    if (msg.hops > MAX_HOPS) {
      this.say(this.boss.id, `${this.name(msg.from)} and ${this.name(msg.to)} are looping on "${msg.subject}". I stopped it.`);
      return;
    }
    this.emit({ type: EVT.MAIL, message: msg });
    this.store?.onMail?.(msg);
    if (msg.to === 'human') {
      this.say(msg.from, msg.subject + (msg.body ? `\n${msg.body}` : ''));
      return;
    }
    const box = this.inbox.get(msg.to);
    if (!box) return;
    box.push(msg);
    this.term(msg.to, `[mail from ${this.name(msg.from)}] ${msg.act}: ${msg.subject}`);
    this.patchAgent(msg.to, {});
    this.pump(msg.to);
  }

  name(id) { return this.agents.get(id)?.name || id; }

  // ---------- agent loop ----------
  pump(agentId) {
    const agent = this.agents.get(agentId);
    if (!agent || agent.isBoss || this.running.has(agentId) || this.questions.has(agentId)) return;
    let task = null;
    const q = this.queue.get(agentId);
    const box = this.inbox.get(agentId);
    // Replies first so teammates are not left waiting.
    const msg = box.find(m => m.requires_reply);
    if (msg) {
      box.splice(box.indexOf(msg), 1);
      task = this.newTask(`Reply to ${this.name(msg.from)}: ${msg.subject}`, { kind: 'reply', message: msg, silent: true });
      task.assignee = agentId;
      task.status = 'queued';
    } else if (q.length) {
      const nextId = q.shift();
      task = this.tasks.find(t => t.id === nextId);
    }
    // Plain informs are absorbed into memory.
    for (const m of box.splice(0)) this.remember(agentId, `${this.name(m.from)} said: ${m.subject}`);
    if (!task) return;
    this.runTask(agent, task);
  }

  remember(agentId, fact) {
    const mem = this.memory.get(agentId);
    if (!mem) return;
    mem.push(fact);
    if (mem.length > 50) mem.shift();
    this.store?.onMemory?.(agentId, fact);
  }

  async runTask(agent, task) {
    const ctrl = new AbortController();
    this.running.set(agent.id, ctrl);
    task.status = 'active';
    this.saveTask(task);
    this.patchAgent(agent.id, { status: STATUS.THINKING, activity: 'reading the task', progress: 0, taskId: task.id });
    this.term(agent.id, task.kind === 'chat' ? `\n💬 you: ${task.title}` : `\n▶ ${task.key} ${task.title}`);

    const floor = this;
    const ctx = {
      signal: ctrl.signal,
      memory: () => [...floor.memory.get(agent.id)],
      crew: () => [...floor.agents.values()],
      update(patch) { if (!ctrl.signal.aborted) floor.patchAgent(agent.id, patch); },
      term(text) { floor.term(agent.id, text); },
      remember(fact) { floor.remember(agent.id, fact); },
      conversation() { return [...(floor.convo.get(agent.id) || [])]; },
      takeSteer() { return floor.steer.get(agent.id)?.splice(0) || []; },
      onSteer(fn) { const set = floor.steerWaiters.get(agent.id); set?.add(fn); return () => set?.delete(fn); },
      session: {
        get() { return floor.sessions.get(agent.id) || null; },
        set(id) {
          if (id) floor.sessions.set(agent.id, id); else floor.sessions.delete(agent.id);
          floor.store?.onSession?.(agent.id, id || null);
        },
      },
      sleep(ms) { return sleep(ms, ctrl.signal); },
      send(to, act, subject, body = '', extra = {}) {
        const msg = makeMessage({ from: agent.id, to, act, subject, body, ...extra });
        floor.route(msg);
        return msg;
      },
      ask(question) {
        return new Promise(resolve => {
          floor.questions.set(agent.id, { question, resolve });
          floor.patchAgent(agent.id, { status: STATUS.BLOCKED, question, activity: 'waiting for you' });
          floor.term(agent.id, `? ${question}`);
          floor.say(agent.id, question);
        });
      },
    };

    try {
      const out = await this.runtime.run({ agent, task, ctx, floor: this });
      if (ctrl.signal.aborted) throw new Error('stopped');
      task.status = 'done';
      task.result = out?.result || 'done';
      this.saveTask(task);
      if (task.kind === 'chat') {
        this.gain(XP.chat);
        // The agent answers you directly, in its own voice.
        this.term(agent.id, `💬 ${task.result}`);
        this.say(agent.id, task.result);
        this.talk(agent.id, 'agent', task.result);
        this.patchAgent(agent.id, { status: STATUS.IDLE, activity: '', progress: 0, taskId: null });
      } else {
        this.term(agent.id, `✔ ${task.key} done. ${task.result}`);
        if (task.kind === 'work') { agent.doneCount += 1; this.talk(agent.id, 'agent', `(finished "${task.title}": ${task.result})`); }
        if (task.kind === 'work') { task.doneAt = Date.now(); this.saveTask(task); this.gain(XP.work, { shipped: true }); }
        this.patchAgent(agent.id, { status: STATUS.DONE, activity: `finished ${task.title}`, progress: 1 });
      }
      if (task.kind === 'work') {
        const msg = makeMessage({ from: agent.id, to: this.boss.id, act: ACT.DONE, subject: task.title, body: task.result });
        this.emit({ type: EVT.MAIL, message: msg });
        this.store?.onMail?.(msg);
        this.say(this.boss.id, `${agent.name} finished ${task.key}: ${task.title}. ${task.result}`);
      }
    } catch (e) {
      const stopped = e.message === 'stopped' || ctrl.signal.aborted;
      task.status = stopped ? 'backlog' : 'failed';
      if (stopped) task.assignee = null;
      task.result = stopped ? '' : e.message;
      this.saveTask(task);
      this.term(agent.id, stopped ? '■ stopped' : `✖ ${e.message}`);
      this.patchAgent(agent.id, stopped
        ? { status: STATUS.IDLE, activity: 'stopped by you', progress: 0, taskId: null }
        : { status: STATUS.ERROR, activity: e.message.slice(0, 80), taskId: null });
      if (!stopped && task.kind === 'chat') this.say(agent.id, `Sorry, I hit an error: ${e.message.slice(0, 140)}`);
      else if (!stopped) this.say(this.boss.id, `${agent.name} hit an error on ${task.key}: ${e.message.slice(0, 120)}`);
    } finally {
      this.running.delete(agent.id);
      // Anything you said that the task did not pick up becomes the next thing to answer.
      const left = this.steer.get(agent.id)?.splice(0) || [];
      if (left.length && this.agents.has(agent.id)) this.newTask(left.join(' '), { kind: 'chat', assignee: agent.id, silent: true });
    }

    await sleep(task.kind === 'chat' ? 300 : 2500);
    if (!this.agents.has(agent.id)) return;
    if (!this.running.has(agent.id) && !this.questions.has(agent.id)) {
      const a = this.agents.get(agent.id);
      if (a.status === STATUS.DONE || a.status === STATUS.ERROR) this.patchAgent(agent.id, { status: STATUS.IDLE, activity: '', taskId: null, progress: 0 });
      this.pump(agent.id);
    }
  }

  // ---------- progression ----------
  progressView() {
    const p = this.progress;
    const lv = levelFor(p.xp);
    const today = p.today?.day === dayKey() ? p.today.done : 0;
    return { ...p, level: lv.level, unlock: lv.unlock, next: lv.next, into: lv.into, span: lv.span, todayDone: today, goal: DAILY_GOAL };
  }

  gain(xp, { shipped = false } = {}) {
    const p = this.progress;
    const before = levelFor(p.xp).level;
    p.xp += xp;
    if (shipped) {
      p.shipped = (p.shipped || 0) + 1;
      const day = dayKey();
      if (p.today?.day !== day) p.today = { day, done: 0 };
      p.today.done += 1;
      if (p.today.done === DAILY_GOAL && this.boss) this.say(this.boss.id, `Daily goal done: ${DAILY_GOAL} tasks shipped today. Nice work.`);
    }
    const lv = levelFor(p.xp);
    p.level = lv.level;
    const levelUp = lv.level > before;
    if (levelUp && this.boss) this.say(this.boss.id, `Office level ${lv.level}! Unlocked: ${lv.unlock}.`);
    this.store?.onProgress?.(p);
    this.emit({ type: EVT.PROGRESS, progress: this.progressView(), levelUp });
  }

  // You came back. Count the streak and tell you what happened while you were away.
  hello(at = Date.now()) {
    const p = this.progress;
    const day = dayKey(at);
    const yesterday = dayKey(at - 86400000);
    const firstToday = p.lastDay !== day;
    if (firstToday) {
      p.streak = p.lastDay === yesterday ? (p.streak || 0) + 1 : 1;
      p.bestStreak = Math.max(p.bestStreak || 0, p.streak);
      p.lastDay = day;
    }
    const away = p.lastSeen ? at - p.lastSeen : 0;
    const since = p.lastSeen;
    p.lastSeen = at;
    if (firstToday && p.streak > 1) this.gain(XP.streak);
    else { this.store?.onProgress?.(p); this.emit({ type: EVT.PROGRESS, progress: this.progressView(), levelUp: false }); }
    if (!this.boss || !since || away < 20 * 60 * 1000) return null;
    const done = this.tasks.filter(t => t.kind === 'work' && t.status === 'done' && (t.doneAt || 0) > since);
    const waiting = [...this.agents.values()].filter(a => a.status === STATUS.BLOCKED);
    const parts = [];
    parts.push(p.streak > 1 ? `Welcome back. Day ${p.streak} in a row.` : 'Welcome back.');
    if (done.length) parts.push(`While you were away the team shipped ${done.length}: ${done.slice(0, 3).map(t => t.title).join(', ')}.`);
    else parts.push('Quiet while you were away.');
    if (waiting.length) parts.push(`${waiting.map(a => a.name).join(' and ')} ${waiting.length > 1 ? 'have' : 'has'} a hand up for you.`);
    const left = DAILY_GOAL - (p.today?.day === day ? p.today.done : 0);
    if (left > 0) parts.push(`Ship ${left} more today to hit the daily goal.`);
    const text = parts.join(' ');
    this.say(this.boss.id, text);
    return text;
  }

  // ---------- command dispatcher (from ws or local UI) ----------
  async command(cmd) {
    switch (cmd.type) {
      case 'say': return this.humanSay(cmd.text, cmd.to);
      case 'assign': return this.assign(cmd.taskId, cmd.agentId);
      case 'new_task': return this.newTask(cmd.title);
      case 'answer': return this.answer(cmd.agentId, cmd.text);
      case 'stop': return this.stop(cmd.agentId);
      case 'hire': return this.hire(cmd.agent || {});
      case 'update_agent': return this.updateAgent(cmd.id, cmd.patch || {});
      case 'fire': return this.fire(cmd.id);
      case 'chat_history': return [...(this.convo.get(cmd.agentId) || [])];
      case 'hello': return this.hello(cmd.at || Date.now());
      case 'status': {
        const text = this.statusReport(cmd.agentId || null);
        this.say(cmd.agentId || this.boss.id, text);
        return text;
      }
      default: return null;
    }
  }
}
