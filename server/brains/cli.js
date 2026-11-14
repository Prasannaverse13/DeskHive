// CLI brains: real coding agents on your machine.
//   claude-cli  -> claude -p --output-format stream-json
//   codex-cli   -> codex exec --json
// Their live event streams drive the avatars (typing, tool names, progress).

import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cliPrompt, cliFollowUp, convoText, parseFinal } from './prompts.js';

const APPROVE_SCRIPT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'approve-mcp.js');

const IS_WIN = process.platform === 'win32';
// With shell: true on Windows, quote args that have spaces (paths, model ids are safe).
const winQuote = a => (/[\s"&|<>^]/.test(a) ? `"${String(a).replace(/"/g, '""')}"` : a);

function short(v) {
  const s = String(v || '').replace(/\s+/g, ' ');
  return s.length > 48 ? s.slice(0, 45) + '...' : s;
}

export function detectCli(bin) {
  return new Promise(resolve => {
    execFile(bin, ['--version'], { shell: IS_WIN, timeout: 8000, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim().split('\n')[0]);
    });
  });
}

function runJsonl({ bin, args, prompt, cwd, signal, onEvent, env = {} }) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, IS_WIN ? args.map(winQuote) : args, { cwd, shell: IS_WIN, env: { ...process.env, ...env }, windowsHide: true });
    let buf = '';
    let err = '';
    const kill = () => { try { child.kill(); } catch { /* */ } };
    signal?.addEventListener('abort', kill, { once: true });
    child.stdout.on('data', d => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { onEvent({ type: 'raw', text: line }); continue; }
        onEvent(evt);
      }
    });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', e => reject(new Error(e.code === 'ENOENT' ? `${bin} not found. Install it or pick another brain.` : e.message)));
    child.on('close', code => {
      signal?.removeEventListener('abort', kill);
      if (signal?.aborted) return reject(new Error('stopped'));
      resolve({ code, err });
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

// ---------------------------------------------------------------- Claude Code
// Permission prompts go to DeskHive through a tiny MCP server (approve-mcp.js).
// Safe tools pass on their own; risky ones raise the agent's hand in the office.
function claudeFlags(agent, mcpConfig) {
  if (process.env.DESKHIVE_CLAUDE_FLAGS) return process.env.DESKHIVE_CLAUDE_FLAGS.split(/\s+/).filter(Boolean);
  if (agent.autonomy === 'autonomous') return ['--dangerously-skip-permissions'];
  const flags = [];
  if (agent.autonomy !== 'cautious') flags.push('--permission-mode', 'acceptEdits');
  if (mcpConfig) flags.push('--mcp-config', mcpConfig, '--permission-prompt-tool', 'mcp__deskhive__approve');
  return flags;
}

// Meta VR CLI (metavr): when it is installed, Claude Code agents get its MCP server, so they can
// search Meta docs, install builds on your Quest, take screenshots and read performance traces.
// https://github.com/meta-quest/agentic-tools   Turn off with DESKHIVE_METAVR=off.
let metavr = null;
export async function detectMetaVr() {
  if ((process.env.DESKHIVE_METAVR || '').toLowerCase() === 'off') { metavr = null; return null; }
  metavr = await detectCli(process.env.DESKHIVE_METAVR_BIN || 'metavr');
  return metavr;
}
export const metaVrVersion = () => metavr;

// Writes the MCP config for one agent and returns its path.
function writeMcpConfig({ hive, agent, approval }) {
  if (!approval) return null;
  const file = path.join(hive.agentDir(agent.id), 'mcp.json');
  const cfg = { mcpServers: { deskhive: { command: process.execPath, args: [APPROVE_SCRIPT], env: { DESKHIVE_URL: approval.url, DESKHIVE_TOKEN: approval.token, DESKHIVE_AGENT: agent.id } } } };
  if (metavr) cfg.mcpServers.metavr = { command: process.env.DESKHIVE_METAVR_BIN || 'metavr', args: ['mcp', 'server'] };
  fs.writeFileSync(file, JSON.stringify(cfg, null, 2));
  return file;
}

export async function claudeOnce({ prompt, cwd, model, maxTurns }) {
  let final = null;
  const args = ['-p', '--output-format', 'stream-json', '--verbose'];
  if (maxTurns) args.push('--max-turns', String(maxTurns));
  if (model) args.push('--model', model);
  const { err } = await runJsonl({ bin: process.env.DESKHIVE_CLAUDE_BIN || 'claude', args, prompt, cwd, onEvent: e => { if (e.type === 'result') final = e; } });
  if (!final) throw new Error(err.trim().split('\n').pop() || 'claude returned nothing');
  return String(final.result || '');
}

export async function runClaudeCli({ agent, task, ctx, hive, workspace, approval }) {
  const agentDir = hive.agentDir(agent.id).replace(/\\/g, '/');
  const mcpConfig = writeMcpConfig({ hive, agent, approval });
  let sessionId = ctx.session?.get() || null;
  const fresh = () => cliPrompt({ agent, task, memory: ctx.memory(), crew: ctx.crew(), hiveDir: hive.root.replace(/\\/g, '/'), agentDir });
  // A resumed session already knows the team and its instructions.
  let prompt = sessionId ? cliFollowUp({ agent, task, memory: ctx.memory() }) : fresh();
  let steps = 0;
  let resumeFailed = false;
  for (let round = 0; round < 8; round++) {
    let final = null;
    let interrupted = null;
    const roundCtrl = new AbortController();
    const onTaskAbort = () => roundCtrl.abort();
    ctx.signal.addEventListener('abort', onTaskAbort, { once: true });
    // You talked while it worked: stop this run and resume the same session with your words.
    const offSteer = ctx.onSteer?.(() => {
      if (!sessionId || interrupted) return;
      interrupted = ctx.takeSteer();
      if (interrupted.length) roundCtrl.abort(); else interrupted = null;
    });
    const args = ['-p', '--output-format', 'stream-json', '--verbose', '--add-dir', hive.root, ...claudeFlags(agent, mcpConfig)];
    if (agent.model) args.push('--model', agent.model);
    if (sessionId) args.push('--resume', sessionId);
    let result;
    try {
      result = await runJsonl({
        bin: process.env.DESKHIVE_CLAUDE_BIN || 'claude', args, prompt, cwd: workspace, signal: roundCtrl.signal,
        env: { MCP_TOOL_TIMEOUT: '900000' },
        onEvent: evt => {
          if (evt.session_id) sessionId = evt.session_id;
          if (evt.type === 'result') final = evt;
          if (evt.type === 'assistant') {
            for (const c of evt.message?.content || []) {
              if (c.type === 'tool_use') {
                steps += 1;
                const i = c.input || {};
                const activity = `${c.name} ${short(i.file_path || i.path || i.command || i.pattern || i.url || i.query || i.description)}`.trim();
                ctx.update({ status: 'working', activity, progress: Math.min(0.95, 1 - 1 / (1 + steps * 0.25)) });
                ctx.term(`● ${activity}`);
              } else if (c.type === 'text' && c.text?.trim()) {
                ctx.update({ status: 'thinking', activity: 'thinking' });
                ctx.term(c.text.trim());
              }
            }
          } else if (evt.type === 'user') {
            for (const c of evt.message?.content || []) {
              if (c.type === 'tool_result') {
                const t = typeof c.content === 'string' ? c.content : (c.content || []).map(x => x.text || '').join(' ');
                ctx.term(`  ⎿ ${String(t).split('\n')[0].slice(0, 120)}`);
              }
            }
          } else if (evt.type === 'raw') ctx.term(evt.text);
        },
      });
    } catch (e) {
      if (!interrupted || ctx.signal.aborted) throw e;
    } finally {
      offSteer?.();
      ctx.signal.removeEventListener('abort', onTaskAbort);
    }
    if (sessionId) ctx.session?.set(sessionId);
    if (interrupted) {
      ctx.term(`↳ heard you: ${interrupted.join(' ')}`);
      prompt = `The human just interrupted you and said: ${interrupted.map(t => `"${t}"`).join(' and ')}. Take it into account and continue. Remember your final message is spoken to them.`;
      continue;
    }
    if (!final) {
      const msg = (result?.err || '').trim().split('\n').pop() || 'claude returned nothing';
      // An old session id that Claude no longer knows: start fresh once.
      if (sessionId && !resumeFailed && /no conversation|session/i.test(msg)) {
        resumeFailed = true; sessionId = null; ctx.session?.set(null); prompt = fresh(); continue;
      }
      throw new Error(msg);
    }
    if (final.is_error || final.subtype !== 'success') {
      const msg = String(final.result || final.subtype || 'claude failed');
      if (sessionId && !resumeFailed && /no conversation found/i.test(msg)) {
        resumeFailed = true; sessionId = null; ctx.session?.set(null); prompt = fresh(); continue;
      }
      throw new Error(msg.slice(0, 160));
    }
    const fin = parseFinal(final.result);
    for (const r of fin.remember) ctx.remember(r);
    if (fin.ask) {
      const answer = await ctx.ask(fin.ask);
      prompt = `The human answered: ${answer}\nContinue the task.`;
      continue;
    }
    return { result: task.kind === 'chat' ? (fin.summary || 'Done.') : (fin.summary || 'done').slice(-200) };
  }
  return { result: 'Stopped after several rounds.' };
}

// ---------------------------------------------------------------- Codex
function codexFlags(agent) {
  if (process.env.DESKHIVE_CODEX_FLAGS) return process.env.DESKHIVE_CODEX_FLAGS.split(/\s+/).filter(Boolean);
  if (agent.autonomy === 'autonomous') return ['--dangerously-bypass-approvals-and-sandbox'];
  if (agent.autonomy === 'cautious') return ['--sandbox', 'read-only'];
  return ['--full-auto'];
}

function codexItem(evt) {
  const item = evt.item || evt.msg || {};
  return { type: item.type || item.item_type || evt.item_type, item };
}

export async function codexOnce({ prompt, cwd, model }) {
  let text = '';
  const args = ['exec', '--json', '--skip-git-repo-check', '-C', cwd, '--sandbox', 'read-only'];
  if (model) args.push('-m', model);
  args.push('-');
  const { err } = await runJsonl({ bin: process.env.DESKHIVE_CODEX_BIN || 'codex', args, prompt, cwd, onEvent: e => {
    const { type, item } = codexItem(e);
    if (e.type === 'item.completed' && (type === 'agent_message' || type === 'assistant_message')) text = item.text || text;
  } });
  if (!text) throw new Error(err.trim().split('\n').pop() || 'codex returned nothing');
  return text;
}

export async function runCodexCli({ agent, task, ctx, hive, workspace }) {
  const agentDir = hive.agentDir(agent.id).replace(/\\/g, '/');
  const convo = task.kind === 'chat' && ctx.conversation ? convoText(ctx.conversation(), task.title) : '';
  let prompt = cliPrompt({ agent, task, memory: ctx.memory(), crew: ctx.crew(), hiveDir: hive.root.replace(/\\/g, '/'), agentDir }) + convo;
  let steps = 0;
  for (let round = 0; round < 4; round++) {
    let lastMessage = '';
    let failure = null;
    const args = ['exec', '--json', '--skip-git-repo-check', '-C', workspace, '--add-dir', hive.root, ...codexFlags(agent)];
    if (agent.model) args.push('-m', agent.model);
    args.push('-');
    const { code, err } = await runJsonl({
      bin: process.env.DESKHIVE_CODEX_BIN || 'codex', args, prompt, cwd: workspace, signal: ctx.signal,
      onEvent: evt => {
        if (evt.type === 'raw') return ctx.term(evt.text);
        if (evt.type === 'turn.failed' || evt.type === 'error') { failure = evt.error?.message || evt.message || 'codex failed'; return; }
        const { type, item } = codexItem(evt);
        if (!type) return;
        if (evt.type === 'item.started' || (evt.type === 'item.completed' && type !== 'agent_message')) {
          let activity = null;
          if (type === 'command_execution') activity = `Bash ${short(item.command)}`;
          else if (type === 'file_change') activity = `Edit ${short((item.changes || []).map(c => c.path).join(', '))}`;
          else if (type === 'web_search') activity = `WebSearch ${short(item.query)}`;
          else if (type === 'mcp_tool_call') activity = `Tool ${short(item.tool || item.name)}`;
          else if (type === 'reasoning') { ctx.update({ status: 'thinking', activity: 'thinking' }); return; }
          if (activity && evt.type === 'item.started') {
            steps += 1;
            ctx.update({ status: 'working', activity, progress: Math.min(0.95, 1 - 1 / (1 + steps * 0.25)) });
            ctx.term(`● ${activity}`);
          }
          if (evt.type === 'item.completed' && type === 'command_execution' && item.aggregated_output) ctx.term(`  ⎿ ${String(item.aggregated_output).split('\n')[0].slice(0, 120)}`);
        }
        if (evt.type === 'item.completed' && (type === 'agent_message' || type === 'assistant_message')) {
          lastMessage = item.text || '';
          if (lastMessage.trim()) ctx.term(lastMessage.trim());
        }
      },
    });
    if (failure) throw new Error(String(failure).slice(0, 160));
    if (!lastMessage && code !== 0) throw new Error(err.trim().split('\n').pop() || `codex exited with ${code}`);
    const fin = parseFinal(lastMessage);
    for (const r of fin.remember) ctx.remember(r);
    if (fin.ask) {
      const answer = await ctx.ask(fin.ask);
      prompt = `${cliPrompt({ agent, task, memory: ctx.memory(), crew: ctx.crew(), hiveDir: hive.root.replace(/\\/g, '/'), agentDir })}\n\nYou already started this task. Your last message was:\n${lastMessage}\n\nThe human answered: ${answer}\nContinue.`;
      continue;
    }
    return { result: task.kind === 'chat' ? (fin.summary || 'Done.') : (fin.summary || 'done').slice(-200) };
  }
  return { result: 'Stopped after several rounds of questions.' };
}
