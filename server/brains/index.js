// The brain router. Each agent picks its own brain; the floor never needs to know which.

import { PROVIDERS, providerById } from '../../shared/protocol.js';
import { createMockRuntime, routeByKeywords } from '../../shared/mockRuntime.js';
import { openaiChat, anthropicChat } from './llm.js';
import { runAgentLoop } from './loop.js';
import { planPrompt, parsePlan } from './prompts.js';
import { RISKY } from './tools.js';
import { runClaudeCli, runCodexCli, claudeOnce, codexOnce, detectCli, detectMetaVr, metaVrVersion } from './cli.js';

// Tools Claude Code may use without asking, by autonomy level.
const SAFE_TOOLS = new Set(['Read', 'Glob', 'Grep', 'LS', 'TodoWrite', 'TodoRead', 'WebSearch', 'WebFetch', 'NotebookRead', 'Task', 'ExitPlanMode', 'BashOutput', 'ListMcpResourcesTool', 'ReadMcpResourceTool']);
const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const YES = /^(y|yes|yeah|yep|ok|okay|sure|go|go ahead|do it|approve|approved|allow|ship|fine)\b/i;

export function createBrains({ hive, workspace, config, approval = null }) {
  const live = new Map(); // agentId -> { agent, ctx } while a CLI brain runs
  const mock = createMockRuntime();
  const cli = { 'claude-cli': null, 'codex-cli': null }; // detected versions
  let ollamaUp = false;
  const badModels = new Set(); // models that ran out of memory here
  let ollamaModels = []; // installed model tags
  const listeners = new Set();
  const onChange = () => { for (const fn of listeners) { try { fn(); } catch (e) { console.error(e); } } };

  // Is Ollama running, and which models are pulled? Checked now and every 20 s,
  // so starting Ollama later just works.
  async function detectOllama() {
    const before = `${ollamaUp}|${ollamaModels.join(',')}`;
    try {
      const r = await fetch(`${config.baseUrl('ollama').replace(/\/$/, '')}/models`, { signal: AbortSignal.timeout(1500) });
      ollamaUp = r.ok;
      ollamaModels = r.ok ? ((await r.json()).data || []).map(m => m.id).filter(Boolean) : [];
    } catch { ollamaUp = false; ollamaModels = []; }
    return before !== `${ollamaUp}|${ollamaModels.join(',')}`;
  }
  setInterval(() => { detectOllama().then(changed => { if (changed) onChange(); }); }, 20000).unref?.();

  async function detect() {
    const [c, x] = await Promise.all([
      detectCli(process.env.DESKHIVE_CLAUDE_BIN || 'claude'),
      detectCli(process.env.DESKHIVE_CODEX_BIN || 'codex'),
    ]);
    cli['claude-cli'] = c; cli['codex-cli'] = x;
    await detectMetaVr();
    await detectOllama();
    onChange();
  }
  detect();

  function modelFor(agent, p) {
    // Ollama: use whichever Llama you actually pulled.
    if (!agent.model && p.id === 'ollama') return localLlama() || p.models[0];
    return agent.model || p.models.find(Boolean) || '';
  }

  // A chat function bound to one provider and model.
  function chatFor(providerId, model) {
    const p = providerById(providerId);
    if (p.id === 'anthropic') {
      const key = config.key('anthropic');
      return args => anthropicChat({ ...args, key, model });
    }
    const key = config.key(p.id);
    const baseUrl = config.baseUrl(p.id);
    if (p.keyName && !key && p.id !== 'custom') throw new Error(`${p.label} has no API key. Add it in Connections.`);
    if (!model) throw new Error(`${p.label} needs a model name. Set it in the Studio.`);
    if (p.id !== 'ollama') return args => openaiChat({ ...args, baseUrl, key, model, flavor: p.id });
    // Ollama: if a big Llama runs out of memory, skip it and use a smaller one.
    return async args => {
      let m = model;
      for (let i = 0; i < 3; i++) {
        try { return await openaiChat({ ...args, baseUrl, key, model: m, flavor: p.id }); } catch (e) {
          if (!/out-of-memory|out of memory|requires more system memory|unable to allocate|buffer/i.test(e.message)) throw e;
          badModels.add(m);
          const next = localLlama();
          onChange();
          if (!next || next === m) throw e;
          m = next;
        }
      }
      throw new Error('Llama ran out of memory on every model. Close other apps or pull a smaller one.');
    };
  }

  function status() {
    return PROVIDERS.map(p => {
      if (p.kind === 'demo') return { id: p.id, ready: true, reason: 'built in' };
      if (p.kind === 'cli') return { id: p.id, ready: !!cli[p.id], reason: cli[p.id] ? cli[p.id] : 'not installed on this machine' };
      const src = config.keySource(p.id);
      const base = config.baseUrl(p.id);
      if (p.id === 'ollama') {
        const llama = localLlama();
        return { id: p.id, ready: ollamaUp, reason: !ollamaUp ? 'Ollama is not running at ' + base : llama ? `${llama} ready` : 'running, but no Llama yet: ollama pull llama3.2:3b', baseUrl: base, models: ollamaModels, llama };
      }
      if (p.id === 'custom') return { id: p.id, ready: !!base, reason: base || 'set a base URL', baseUrl: base, keySet: !!src };
      return { id: p.id, ready: !!src, reason: src || 'no key yet', baseUrl: base, keySet: !!src };
    });
  }

  // Best Llama model pulled in Ollama, bigger first.
  function localLlama() {
    if (!ollamaUp) return null;
    const pref = ['llama3.3', 'llama3.1:8b', 'llama3.1', 'llama4', 'llama3.2:3b', 'llama3.2'];
    const pool = ollamaModels.filter(m => !badModels.has(m));
    for (const want of pref) {
      const hit = pool.find(m => m === want || m === `${want}:latest` || m.startsWith(`${want}:`) || m.startsWith(`${want}-`));
      if (hit) return hit;
    }
    return pool.find(m => /llama/i.test(m)) || null;
  }

  // The free default: Meta Muse when you have a key, otherwise Llama on your own laptop.
  function defaultBrain() {
    if (config.key('meta')) return { provider: 'meta', model: 'muse-spark-1.3', label: 'Meta Muse Spark' };
    const llama = localLlama();
    if (llama) return { provider: 'ollama', model: llama, label: `Llama (${llama}) on this laptop, free` };
    return null;
  }

  return {
    name: 'live',
    providerStatus: status,
    defaultBrain,
    metaVr: () => metaVrVersion(),
    onStatusChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    redetect: detect,

    // Can a running agent take your words mid task?
    canSteer(agent) {
      const p = providerById(agent.provider);
      return p.kind === 'demo' || p.kind === 'api' || p.id === 'claude-cli';
    },

    // Claude Code asked for permission (via approve-mcp.js). Decide, or raise the hand and ask you.
    async approve({ agentId, tool, input = {} }) {
      const run = live.get(agentId);
      if (!run) return { behavior: 'deny', message: 'This agent is not running a task.' };
      const { agent, ctx } = run;
      const mode = agent.autonomy || 'balanced';
      const cmd = String(input.command || '');
      const file = String(input.file_path || input.notebook_path || input.path || '');
      let needHuman = false;
      let ask = '';
      if (SAFE_TOOLS.has(tool)) needHuman = false;
      else if (EDIT_TOOLS.has(tool)) {
        needHuman = mode === 'cautious';
        ask = `Edit ${file || 'a file'}?`;
      } else if (tool === 'Bash') {
        needHuman = mode === 'cautious' || RISKY.test(cmd);
        ask = `Run this command? ${cmd.slice(0, 160)}`;
      } else {
        needHuman = mode === 'cautious';
        ask = `Use ${tool}?`;
      }
      if (!needHuman) { ctx.term(`  ✓ allowed ${tool}`); return { behavior: 'allow' }; }
      const answer = String(await ctx.ask(ask)).trim();
      if (YES.test(answer)) { ctx.term(`  ✓ you allowed ${tool}`); return { behavior: 'allow' }; }
      ctx.term(`  ✗ you said no to ${tool}`);
      return { behavior: 'deny', message: `The human said no${answer && !/^no?\b/i.test(answer) ? `: ${answer}` : ''}. Do not do that. Find another way or explain.` };
    },

    async plan({ text, crew, boss, context, conversation }) {
      const p = providerById(boss?.provider);
      if (p.kind === 'demo') return mock.plan({ text, crew, context });
      const prompt = planPrompt(text, crew, boss, { context, conversation });
      try {
        let raw;
        if (p.id === 'claude-cli') raw = await claudeOnce({ prompt, cwd: workspace, model: boss.model, maxTurns: 1 });
        else if (p.id === 'codex-cli') raw = await codexOnce({ prompt, cwd: workspace, model: boss.model });
        else raw = (await chatFor(p.id, modelFor(boss, p))({ system: 'You are a precise planner. Output JSON only.', history: [{ role: 'user', content: prompt }], tools: [], maxTokens: 900 })).text;
        return parsePlan(raw, crew);
      } catch (e) {
        // Never leave the human hanging: fall back to keyword routing.
        const tasks = routeByKeywords(text, crew);
        return { reply: `My ${p.label} brain failed (${e.message.slice(0, 80)}). I routed it by skills instead.`, tasks };
      }
    },

    async run({ agent, task, ctx }) {
      const p = providerById(agent.provider);
      if (p.kind === 'demo') return mock.run({ agent, task, ctx });
      if (p.id === 'claude-cli' || p.id === 'codex-cli') {
        live.set(agent.id, { agent, ctx });
        try {
          return p.id === 'claude-cli'
            ? await runClaudeCli({ agent, task, ctx, hive, workspace, approval })
            : await runCodexCli({ agent, task, ctx, hive, workspace });
        } finally { live.delete(agent.id); }
      }
      const chat = chatFor(p.id, modelFor(agent, p));
      return runAgentLoop({ chat, agent, task, ctx, workspace });
    },

    async test(providerId, model) {
      const p = providerById(providerId);
      try {
        if (p.kind === 'demo') return { ok: true, text: 'Demo brain is built in.' };
        if (p.kind === 'cli') {
          await detect();
          return cli[p.id] ? { ok: true, text: `Found ${cli[p.id]}` } : { ok: false, text: `${p.id === 'claude-cli' ? 'claude' : 'codex'} is not on your PATH.` };
        }
        const m = model || p.models.find(Boolean);
        if (!m && (p.id === 'custom' || p.id === 'ollama')) {
          const base = config.baseUrl(p.id);
          if (!base) return { ok: false, text: 'Set a base URL first.' };
          const key = config.key(p.id);
          const r = await fetch(`${base.replace(/\/$/, '')}/models`, { headers: key ? { authorization: `Bearer ${key}` } : {}, signal: AbortSignal.timeout(5000) });
          if (!r.ok) return { ok: false, text: `Server answered ${r.status}` };
          const j = await r.json().catch(() => ({}));
          const ids = (j.data || j.models || []).map(x => x.id || x.name).filter(Boolean);
          return { ok: true, text: ids.length ? `Reachable. Models: ${ids.slice(0, 5).join(', ')}` : 'Reachable. Type a model name in the Studio.' };
        }
        const t0 = Date.now();
        const out = await chatFor(p.id, m)({ system: 'Reply with exactly one word.', history: [{ role: 'user', content: 'Say: ready' }], tools: [], maxTokens: p.id === 'meta' ? 400 : 20, signal: AbortSignal.timeout(45000) });
        return { ok: true, text: `${m} replied "${out.text.trim().slice(0, 30)}" in ${Date.now() - t0} ms` };
      } catch (e) {
        return { ok: false, text: e.message.slice(0, 220) };
      }
    },
  };
}
