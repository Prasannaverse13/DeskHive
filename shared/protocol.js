// DeskHive shared protocol. Used by the server, the browser demo hive and the 3D client.

export const STATUS = {
  IDLE: 'idle',
  THINKING: 'thinking',
  WORKING: 'working',
  BLOCKED: 'blocked', // waiting on the human
  DONE: 'done',
  ERROR: 'error',
  OFFLINE: 'offline',
};

// Speech acts (FIPA lite) for agent to agent mail.
export const ACT = {
  REQUEST: 'request',
  INFORM: 'inform',
  QUERY: 'query',
  DONE: 'done',
  AGREE: 'agree',
  REFUSE: 'refuse',
};

export const MAX_HOPS = 6;

// ---------------------------------------------------------------- brains
// Every agent picks a brain. CLI brains run a real coding agent on your machine.
// API brains run DeskHive's own agent loop with tools (files, shell, mail, ask you, memory).
export const PROVIDERS = [
  { id: 'demo', label: 'Demo', kind: 'demo', badge: 'D', color: '#8a8f99', models: ['scripted'], blurb: 'Scripted crew. No keys. Great for trying things.' },
  { id: 'meta', label: 'Meta Muse', kind: 'api', badge: '∞', color: '#0866ff', keyName: 'MODEL_API_KEY', keyAliases: ['META_API_KEY'], baseUrl: 'https://api.meta.ai/v1', models: ['muse-spark-1.3', 'muse-wonder-1.0', 'muse-spark-1.2'], blurb: "Meta's Muse Spark on the Meta Model API. Paid per use. With a key it becomes the default brain." },
  { id: 'claude-cli', label: 'Claude Code', kind: 'cli', badge: 'C', color: '#d97757', models: ['', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], blurb: 'Runs the claude CLI on your machine. Uses your Claude plan.' },
  { id: 'codex-cli', label: 'Codex', kind: 'cli', badge: 'X', color: '#10a37f', models: ['', 'gpt-6-astra', 'gpt-6.1-sol'], blurb: 'Runs the OpenAI codex CLI on your machine. Uses your ChatGPT plan or key.' },
  { id: 'anthropic', label: 'Claude API', kind: 'api', badge: 'A', color: '#d97757', keyName: 'ANTHROPIC_API_KEY', models: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-haiku-5-5'], blurb: 'Anthropic API with the DeskHive tool loop.' },
  { id: 'openai', label: 'OpenAI', kind: 'api', badge: 'O', color: '#10a37f', keyName: 'OPENAI_API_KEY', baseUrl: 'https://api.openai.com/v1', models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna'], blurb: 'OpenAI chat API with the DeskHive tool loop.' },
  { id: 'xai', label: 'Grok', kind: 'api', badge: 'G', color: '#e5e5e5', keyName: 'XAI_API_KEY', baseUrl: 'https://api.x.ai/v1', models: ['grok-4.7', 'grok-4.20'], blurb: 'xAI Grok with the DeskHive tool loop.' },
  { id: 'gemini', label: 'Gemini', kind: 'api', badge: 'Ge', color: '#4f8cff', keyName: 'GEMINI_API_KEY', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-3.8-flash'], blurb: 'Google Gemini through its OpenAI compatible endpoint.' },
  { id: 'openrouter', label: 'OpenRouter', kind: 'api', badge: 'R', color: '#7c5cff', keyName: 'OPENROUTER_API_KEY', baseUrl: 'https://openrouter.ai/api/v1', models: ['meta-llama/llama-4-maverick', 'anthropic/claude-sonnet-5-5', 'x-ai/grok-4.7', 'openai/gpt-6.1-sol'], blurb: 'Hundreds of models with one key.' },
  { id: 'ollama', label: 'Llama (free, local)', kind: 'api', badge: '🦙', color: '#06d6a0', keyName: null, baseUrl: 'http://localhost:11434/v1', models: ['llama3.2:3b', 'llama3.1:8b', 'llama3.3', 'llama4:scout'], blurb: "Meta's open Llama on your own machine with Ollama. Free, no key, works offline. The default brain when no Meta key is set." },
  { id: 'custom', label: 'Custom endpoint', kind: 'api', badge: '★', color: '#f2b134', keyName: 'CUSTOM_API_KEY', baseUrl: '', models: [''], blurb: 'Any OpenAI compatible endpoint (Groq, DeepSeek, Together, LM Studio, vLLM).' },
];
export const providerById = id => PROVIDERS.find(p => p.id === id) || PROVIDERS[0];

export const AUTONOMY = [
  { id: 'cautious', label: 'Cautious', blurb: 'Asks you before any shell command or risky step.' },
  { id: 'balanced', label: 'Balanced', blurb: 'Works on its own. Asks before deploys, deletes, pushes or spend.' },
  { id: 'autonomous', label: 'Autonomous', blurb: 'Never waits. Only for sandboxes you trust.' },
];

// ---------------------------------------------------------------- voices
// Each agent speaks with its own voice. OpenAI voices when a key is set,
// otherwise the browser voice with this pitch and rate.
export const VOICES = [
  { id: 'nova', label: 'Nova', pitch: 1.05, rate: 1.05, style: 'Warm, upbeat, confident chief of staff.' },
  { id: 'alloy', label: 'Alloy', pitch: 1, rate: 1.05, style: 'Neutral and clear.' },
  { id: 'ash', label: 'Ash', pitch: 0.85, rate: 1.0, style: 'Calm engineer, low and steady.' },
  { id: 'ballad', label: 'Ballad', pitch: 1.1, rate: 0.98, style: 'Gentle storyteller.' },
  { id: 'coral', label: 'Coral', pitch: 1.2, rate: 1.08, style: 'Bright and friendly.' },
  { id: 'echo', label: 'Echo', pitch: 0.9, rate: 1.05, style: 'Crisp and focused.' },
  { id: 'fable', label: 'Fable', pitch: 1.0, rate: 1.0, style: 'Playful and expressive.' },
  { id: 'onyx', label: 'Onyx', pitch: 0.75, rate: 0.98, style: 'Deep and serious.' },
  { id: 'sage', label: 'Sage', pitch: 1.1, rate: 1.0, style: 'Thoughtful and kind.' },
  { id: 'shimmer', label: 'Shimmer', pitch: 1.3, rate: 1.1, style: 'Energetic and quick.' },
  { id: 'verse', label: 'Verse', pitch: 0.95, rate: 1.04, style: 'Smooth and articulate.' },
];
export const voiceById = id => VOICES.find(v => v.id === id) || VOICES[1];
function defaultVoice(a) {
  if (a.isBoss) return 'nova';
  let h = 0;
  for (const ch of String(a.id || a.name || '')) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return VOICES[1 + (h % (VOICES.length - 1))].id;
}

// ---------------------------------------------------------------- looks
export const LOOK_OPTIONS = {
  species: ['human', 'robot', 'cat'],
  hairStyle: ['short', 'long', 'bun', 'spiky', 'mohawk', 'bald'],
  accessory: ['none', 'glasses', 'shades', 'headphones', 'cap', 'crown', 'antenna', 'halo'],
  outfit: ['tee', 'hoodie', 'suit', 'labcoat'],
  aura: ['none', 'glow', 'sparkle'],
};
export const SKIN_SWATCHES = ['#ffe0bd', '#ffdbac', '#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#5c3a1e', '#b8c4d6', '#9ad1ff'];
export const HAIR_SWATCHES = ['#111111', '#3b2f2f', '#5a2d0c', '#7a1f1f', '#d4a017', '#e8e8e8', '#ff6fb5', '#5ce1e6', '#7c5cff'];
export const SHIRT_SWATCHES = ['#3a86ff', '#8338ec', '#06d6a0', '#ef476f', '#ff7f11', '#118ab2', '#f2b134', '#2b2d42', '#e5e5e5', '#d97757', '#10a37f'];

export function defaultLook(over = {}) {
  return { species: 'human', skin: '#e0ac69', hair: '#111111', hairStyle: 'short', shirt: '#3a86ff', pants: '#2b2d42', outfit: 'tee', accessory: 'none', eyes: '#111111', aura: 'none', ...over };
}

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
export function randomLook() {
  const species = Math.random() < 0.7 ? 'human' : pick(['robot', 'cat']);
  return defaultLook({
    species,
    skin: species === 'robot' ? pick(['#b8c4d6', '#9ad1ff', '#e5e5e5']) : species === 'cat' ? pick(['#f2b134', '#3b2f2f', '#e8e8e8', '#ff7f11']) : pick(SKIN_SWATCHES.slice(0, 7)),
    hair: pick(HAIR_SWATCHES),
    hairStyle: pick(LOOK_OPTIONS.hairStyle),
    shirt: pick(SHIRT_SWATCHES),
    outfit: pick(LOOK_OPTIONS.outfit),
    accessory: pick(LOOK_OPTIONS.accessory),
    eyes: species === 'robot' ? pick(['#5ce1e6', '#ff3b3b', '#06d6a0']) : '#111111',
    aura: Math.random() < 0.2 ? pick(['glow', 'sparkle']) : 'none',
  });
}

// ---------------------------------------------------------------- desks
export const BOSS_SEAT = 'boss';
export const WORKER_SEATS = ['d0', 'd1', 'd2', 'd3', 'd4', 'd5', 'd6', 'd7', 'd8'];
export const MAX_WORKERS = WORKER_SEATS.length;

// ---------------------------------------------------------------- templates (quick hire)
export const TEMPLATES = [
  { key: 'frontend', name: 'Pixel', role: 'Frontend engineer', instructions: 'You build clean, accessible UI. Prefer small components. Always run the linter before you finish.', skills: ['ui', 'frontend', 'css', 'react', 'design', 'page', 'button', 'screen'], look: { shirt: '#3a86ff', accessory: 'headphones', outfit: 'hoodie' } },
  { key: 'backend', name: 'Forge', role: 'Backend engineer', instructions: 'You own APIs, databases and auth. Write migrations that can roll back. Never drop data without asking.', skills: ['api', 'backend', 'database', 'db', 'auth', 'server', 'endpoint', 'sql'], look: { shirt: '#8338ec', accessory: 'glasses' } },
  { key: 'qa', name: 'Probe', role: 'QA engineer', instructions: 'You break things on purpose. Write a failing test first, then make it pass. Report flaky tests.', skills: ['test', 'qa', 'bug', 'fix', 'regression', 'e2e', 'check'], look: { shirt: '#06d6a0', species: 'robot', skin: '#b8c4d6', eyes: '#06d6a0', accessory: 'antenna' } },
  { key: 'research', name: 'Scout', role: 'Researcher', instructions: 'You read sources, compare options and write short briefs with links. Say when you are unsure.', skills: ['research', 'compare', 'docs', 'find', 'market', 'read', 'summary', 'brief', 'trend'], look: { shirt: '#ef476f', accessory: 'glasses', outfit: 'labcoat' } },
  { key: 'devops', name: 'Bolt', role: 'DevOps engineer', instructions: 'You own CI, deploys and monitoring. Always ask the human before a production deploy.', skills: ['deploy', 'ci', 'infra', 'docker', 'vercel', 'build', 'pipeline', 'monitor', 'ship'], look: { shirt: '#ff7f11', accessory: 'cap' } },
  { key: 'writer', name: 'Quill', role: 'Writer', instructions: 'You write docs, release notes and posts. Short sentences. Plain words. No hype.', skills: ['write', 'copy', 'docs', 'readme', 'blog', 'pitch', 'notes', 'post'], look: { shirt: '#118ab2', species: 'cat', skin: '#f2b134', accessory: 'none' } },
  { key: 'trends', name: 'Echo', role: 'Trend scout', instructions: 'You watch what people say online and report signals, not noise. Cite posts.', skills: ['trend', 'social', 'twitter', 'x', 'news', 'sentiment', 'market'], look: { shirt: '#111111', accessory: 'shades', aura: 'glow' }, provider: 'xai' },
  { key: 'security', name: 'Warden', role: 'Security reviewer', instructions: 'You review code for security issues. Explain each finding with a fix. Never run untrusted code.', skills: ['security', 'audit', 'review', 'vuln', 'auth', 'secret'], look: { shirt: '#2b2d42', outfit: 'suit', species: 'robot', skin: '#9ad1ff', eyes: '#ff3b3b' } },
  { key: 'quest', name: 'Nexa', role: 'Quest XR engineer', instructions: 'You build and test WebXR and Meta Quest apps. If the metavr tools are available, use them: search Meta docs before guessing, install builds on the headset, take a screenshot to check your work, and read the performance trace. Keep 72 fps. Design hands first and seated.', skills: ['xr', 'vr', 'webxr', 'quest', 'headset', 'hands', 'passthrough', 'metavr', '3d', 'three'], look: { shirt: '#0081fb', accessory: 'headphones', outfit: 'hoodie' } },
];

// The default crew. Original characters.
export const DEFAULT_CREW = [
  { id: 'nova', name: 'Nova', role: 'Chief of staff', instructions: 'You plan work, route it to the best teammate, keep the board tidy and only escalate what truly needs the human.', skills: ['plan', 'route', 'summary'], seat: 'boss', isBoss: true, provider: 'demo', model: '', autonomy: 'balanced', look: defaultLook({ shirt: '#f2b134', hair: '#2b1d14', skin: '#e0ac69', hairStyle: 'bun', outfit: 'suit', accessory: 'crown' }) },
  { id: 'kai', name: 'Kai', role: 'Frontend engineer', instructions: TEMPLATES[0].instructions, skills: TEMPLATES[0].skills, seat: 'd0', provider: 'demo', model: '', autonomy: 'balanced', look: defaultLook({ shirt: '#3a86ff', hair: '#111111', skin: '#c68642', accessory: 'headphones', outfit: 'hoodie' }) },
  { id: 'mira', name: 'Mira', role: 'Backend engineer', instructions: TEMPLATES[1].instructions, skills: TEMPLATES[1].skills, seat: 'd1', provider: 'demo', model: '', autonomy: 'balanced', look: defaultLook({ shirt: '#8338ec', hair: '#5a2d0c', skin: '#f1c27d', hairStyle: 'long', accessory: 'glasses' }) },
  { id: 'leo', name: 'Leo', role: 'QA engineer', instructions: TEMPLATES[2].instructions, skills: TEMPLATES[2].skills, seat: 'd2', provider: 'demo', model: '', autonomy: 'balanced', look: defaultLook({ species: 'robot', shirt: '#06d6a0', skin: '#b8c4d6', eyes: '#06d6a0', accessory: 'antenna' }) },
  { id: 'ravi', name: 'Ravi', role: 'Researcher', instructions: TEMPLATES[3].instructions, skills: TEMPLATES[3].skills, seat: 'd3', provider: 'demo', model: '', autonomy: 'balanced', look: defaultLook({ shirt: '#ef476f', hair: '#1b1b1b', skin: '#8d5524', outfit: 'labcoat', accessory: 'glasses' }) },
  { id: 'zara', name: 'Zara', role: 'DevOps engineer', instructions: TEMPLATES[4].instructions, skills: TEMPLATES[4].skills, seat: 'd4', provider: 'demo', model: '', autonomy: 'balanced', look: defaultLook({ shirt: '#ff7f11', hair: '#7a1f1f', skin: '#e0ac69', hairStyle: 'spiky', accessory: 'cap' }) },
  { id: 'theo', name: 'Theo', role: 'Writer', instructions: TEMPLATES[5].instructions, skills: TEMPLATES[5].skills, seat: 'd5', provider: 'demo', model: '', autonomy: 'balanced', look: defaultLook({ species: 'cat', shirt: '#118ab2', skin: '#f2b134', hair: '#3b2f2f' }) },
];

// Fill in anything an older crew.json is missing.
export function normalizeAgent(a) {
  const look = defaultLook({ ...(a.look || {}) });
  if (!a.look && a.color) Object.assign(look, { shirt: a.color, hair: a.hair || look.hair, skin: a.skin || look.skin });
  return {
    id: a.id,
    name: String(a.name || 'Agent').slice(0, 24),
    role: String(a.role || 'Generalist').slice(0, 80),
    instructions: String(a.instructions || '').slice(0, 4000),
    skills: Array.isArray(a.skills) ? a.skills.map(s => String(s).toLowerCase().trim()).filter(Boolean).slice(0, 24) : [],
    seat: a.seat,
    isBoss: !!a.isBoss,
    provider: PROVIDERS.some(p => p.id === a.provider) ? a.provider : 'demo',
    model: String(a.model || ''),
    autonomy: AUTONOMY.some(x => x.id === a.autonomy) ? a.autonomy : 'balanced',
    voice: VOICES.some(v => v.id === a.voice) ? a.voice : defaultVoice(a),
    look,
    color: look.shirt,
  };
}

let seq = 0;
export function uid(prefix = 'id') {
  seq = (seq + 1) % 100000;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

export function slug(name) {
  return String(name || 'agent').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'agent';
}

export function makeMessage({ from, to, act, subject, body = '', inReplyTo = null, conversation = null, hops = 0, needsHuman = false }) {
  const id = uid('msg');
  return {
    id,
    conversation: conversation || id,
    in_reply_to: inReplyTo,
    from,
    to,
    act,
    subject,
    body,
    hops,
    requires_reply: act === ACT.REQUEST || act === ACT.QUERY,
    needs_human: needsHuman,
    created_at: new Date().toISOString(),
  };
}

// Events the floor emits to clients. Each is { type, ...payload }.
export const EVT = {
  SNAPSHOT: 'snapshot', // { agents, tasks, chat, mode, providers }
  AGENT: 'agent', // { agent }
  AGENT_REMOVED: 'agent_removed', // { id }
  TASK: 'task', // { task }
  TASK_REMOVED: 'task_removed', // { id }
  MAIL: 'mail', // { message } (drives envelope animation)
  CHAT: 'chat', // { line: { from, text, ts } }
  TERM: 'term', // { agentId, text }
  LOG: 'log', // { line }
  PROVIDERS: 'providers', // { providers: [{ id, ready, reason }] }
  TEST_RESULT: 'test_result', // { provider, ok, text }
  PROGRESS: 'progress', // { progress, levelUp? }
};

// ---------------------------------------------------------------- progression (a reason to come back)
// XP from shipped work. Each level unlocks something you can see in the office.
export const LEVELS = [
  { level: 1, xp: 0, unlock: 'Your first office' },
  { level: 2, xp: 60, unlock: 'Gold trophy on Nova\'s desk' },
  { level: 3, xp: 160, unlock: 'Neon sign on the roof' },
  { level: 4, xp: 320, unlock: 'Rooftop garden' },
  { level: 5, xp: 540, unlock: 'Delivery drone' },
  { level: 6, xp: 840, unlock: 'Helipad and the city lights up' },
];
export const DAILY_GOAL = 3;
export const XP = { work: 20, chat: 2, answer: 5, streak: 10 };

export function levelFor(xp = 0) {
  let cur = LEVELS[0];
  for (const l of LEVELS) if (xp >= l.xp) cur = l;
  const next = LEVELS.find(l => l.xp > xp) || null;
  return { level: cur.level, unlock: cur.unlock, next, into: xp - cur.xp, span: next ? next.xp - cur.xp : 1 };
}

export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function freshProgress() {
  return { xp: 0, level: 1, streak: 0, bestStreak: 0, lastDay: '', lastSeen: 0, today: { day: '', done: 0 }, shipped: 0 };
}

// Commands clients send to the floor.
export const CMD = {
  SAY: 'say', // { text, to? }
  ASSIGN: 'assign', // { taskId, agentId }
  NEW_TASK: 'new_task', // { title }
  ANSWER: 'answer', // { agentId, text }
  STOP: 'stop', // { agentId }
  STATUS: 'status', // { agentId? }
  HIRE: 'hire', // { agent }
  UPDATE_AGENT: 'update_agent', // { id, patch }
  FIRE: 'fire', // { id }
  SET_KEYS: 'set_keys', // { keys: { openai: 'sk-...' }, baseUrls: { custom: 'https://...' } }  (server only)
  TEST_PROVIDER: 'test_provider', // { provider, model }  (server only)
  HELLO: 'hello', // { at } you opened DeskHive: streak and the while you were away recap
};

export function shortStatus(agent) {
  switch (agent.status) {
    case STATUS.WORKING: return agent.activity || 'working';
    case STATUS.THINKING: return 'thinking';
    case STATUS.BLOCKED: return 'needs you';
    case STATUS.DONE: return 'done';
    case STATUS.ERROR: return 'error';
    case STATUS.OFFLINE: return 'offline';
    default: return 'idle';
  }
}
