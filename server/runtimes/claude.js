// Claude Code runtime. Each task runs the real `claude` CLI in headless mode
// (claude -p with stream-json), so tool calls drive the avatars live.
// Uses your existing Claude subscription or key. Nothing extra to pay for.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { planPrompt, parsePlan, workPrompt, parseFinal } from './prompts.js';

const IS_WIN = process.platform === 'win32';

function short(input) {
  if (!input || typeof input !== 'object') return '';
  const v = input.file_path || input.path || input.command || input.pattern || input.url || input.query || input.description || '';
  const s = String(v).replace(/\s+/g, ' ');
  return s.length > 48 ? s.slice(0, 45) + '...' : s;
}

function runClaude({ prompt, cwd, args, signal, onEvent }) {
  return new Promise((resolve, reject) => {
    const bin = process.env.DESKHIVE_CLAUDE_BIN || 'claude';
    const child = spawn(bin, args, { cwd, shell: IS_WIN, env: process.env, windowsHide: true });
    let buf = '';
    let final = null;
    let err = '';
    const kill = () => { try { child.kill(); } catch { /* ignore */ } };
    signal?.addEventListener('abort', kill, { once: true });
    child.stdout.on('data', d => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!line) continue;
        let evt;
        try { evt = JSON.parse(line); } catch { onEvent?.({ type: 'raw', text: line }); continue; }
        if (evt.type === 'result') final = evt;
        onEvent?.(evt);
      }
    });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', e => reject(new Error(e.code === 'ENOENT' ? 'claude CLI not found. Install Claude Code or set DESKHIVE_RUNTIME=demo' : e.message)));
    child.on('close', code => {
      signal?.removeEventListener('abort', kill);
      if (signal?.aborted) return reject(new Error('stopped'));
      if (final) return resolve(final);
      reject(new Error(err.trim().split('\n').pop() || `claude exited with code ${code}`));
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

export function createClaudeRuntime({ hive, workspace }) {
  const extraFlags = (process.env.DESKHIVE_CLAUDE_FLAGS || '--permission-mode acceptEdits').split(/\s+/).filter(Boolean);
  const model = process.env.DESKHIVE_MODEL ? ['--model', process.env.DESKHIVE_MODEL] : [];
  const planModel = process.env.DESKHIVE_PLAN_MODEL ? ['--model', process.env.DESKHIVE_PLAN_MODEL] : model;

  return {
    name: 'claude',

    async plan({ text, crew }) {
      const res = await runClaude({
        prompt: planPrompt(text, crew),
        cwd: workspace,
        args: ['-p', '--output-format', 'stream-json', '--verbose', '--max-turns', '1', ...planModel],
      });
      return parsePlan(res.result, crew);
    },

    async run({ agent, task, ctx }) {
      const agentDir = hive.agentDir(agent.id).replace(/\\/g, '/');
      let prompt = workPrompt({ agent, task, memory: ctx.memory(), crew: ctx.crew(), hiveDir: hive.root.replace(/\\/g, '/'), agentDir });
      let sessionId = null;
      let steps = 0;

      for (let round = 0; round < 4; round++) {
        const args = ['-p', '--output-format', 'stream-json', '--verbose', '--add-dir', hive.root, ...extraFlags, ...model];
        if (sessionId) args.push('--resume', sessionId);
        const res = await runClaude({
          prompt,
          cwd: workspace,
          args,
          signal: ctx.signal,
          onEvent: evt => {
            if (evt.session_id) sessionId = evt.session_id;
            if (evt.type === 'assistant') {
              for (const c of evt.message?.content || []) {
                if (c.type === 'tool_use') {
                  steps += 1;
                  const activity = `${c.name} ${short(c.input)}`.trim();
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
            } else if (evt.type === 'raw') {
              ctx.term(evt.text);
            }
          },
        });
        if (res.is_error || res.subtype !== 'success') throw new Error(String(res.result || res.subtype || 'claude failed').slice(0, 160));
        const fin = parseFinal(res.result);
        for (const r of fin.remember) ctx.remember(r);
        if (fin.ask) {
          const answer = await ctx.ask(fin.ask);
          if (ctx.signal.aborted) throw new Error('stopped');
          prompt = `The human answered: ${answer}\nContinue the task.`;
          continue;
        }
        return { result: fin.summary || 'done' };
      }
      return { result: 'Stopped after several rounds of questions.' };
    },
  };
}

export const claudeWorkspaceDefault = path.resolve('workspace');
