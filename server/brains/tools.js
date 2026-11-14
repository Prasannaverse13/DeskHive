// Tools every API brain can use. All file paths are locked inside the workspace.

import fs from 'node:fs';
import path from 'node:path';
import { exec } from 'node:child_process';
import { ACT } from '../../shared/protocol.js';

export const TOOL_DEFS = [
  { name: 'list_files', description: 'List files and folders at a path inside the workspace.', parameters: { type: 'object', properties: { path: { type: 'string', description: 'Folder path relative to the workspace. Use "." for the root.' } }, required: ['path'] } },
  { name: 'read_file', description: 'Read a text file from the workspace.', parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
  { name: 'write_file', description: 'Create or overwrite a text file in the workspace.', parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
  { name: 'run_command', description: 'Run a shell command in the workspace and get its output. Use for tests, builds, git, package managers.', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
  { name: 'web_fetch', description: 'Fetch a public web page or API and get its text.', parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'message_teammate', description: 'Send a short message to a teammate. Use needs_reply true when you want an answer; it will arrive as a new task later.', parameters: { type: 'object', properties: { to: { type: 'string', description: 'Teammate id' }, subject: { type: 'string' }, body: { type: 'string' }, needs_reply: { type: 'boolean' } }, required: ['to', 'subject'] } },
  { name: 'ask_human', description: 'Ask the human a yes or no question and wait for the answer. Use for risky or ambiguous choices only.', parameters: { type: 'object', properties: { question: { type: 'string' } }, required: ['question'] } },
  { name: 'remember', description: 'Save a fact to your long term memory for future tasks.', parameters: { type: 'object', properties: { fact: { type: 'string' } }, required: ['fact'] } },
  { name: 'finish', description: 'Call when the task is complete. Give a one line summary for the human.', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
];

export const RISKY = /\b(rm\s+-rf?|del\s+\/|rmdir|drop\s+table|truncate|git\s+push|npm\s+publish|deploy|vercel\s+--prod|kubectl|terraform\s+apply|shutdown|format\s|mkfs|curl[^|]*\|\s*(sh|bash)|chmod\s+777)\b/i;

function safePath(workspace, p) {
  const full = path.resolve(workspace, String(p || '.'));
  const root = path.resolve(workspace);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('path is outside the workspace');
  return full;
}

function clip(s, n) {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n)}\n…(${s.length - n} more chars)` : s;
}

function runShell(command, cwd, signal) {
  return new Promise(resolve => {
    const child = exec(command, { cwd, timeout: 120000, maxBuffer: 4 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const code = err ? (err.code ?? 1) : 0;
      resolve(`exit ${code}\n${clip(stdout, 6000)}${stderr ? `\nstderr:\n${clip(stderr, 2000)}` : ''}`);
    });
    signal?.addEventListener('abort', () => { try { child.kill(); } catch { /* */ } }, { once: true });
  });
}

// Short label for the avatar's activity line.
export function toolLabel(name, args = {}) {
  const v = args.path || args.command || args.url || args.to || args.question || args.fact || '';
  const s = String(v).replace(/\s+/g, ' ');
  const nice = { list_files: 'List', read_file: 'Read', write_file: 'Write', run_command: 'Bash', web_fetch: 'Fetch', message_teammate: 'Mail', ask_human: 'Ask', remember: 'Remember', finish: 'Finish' }[name] || name;
  return `${nice} ${s.length > 44 ? s.slice(0, 41) + '...' : s}`.trim();
}

export async function execTool({ name, args = {}, agent, ctx, workspace }) {
  switch (name) {
    case 'list_files': {
      const dir = safePath(workspace, args.path);
      if (!fs.existsSync(dir)) return 'not found';
      return fs.readdirSync(dir, { withFileTypes: true }).filter(d => d.name !== 'node_modules' && d.name !== '.git').slice(0, 200).map(d => (d.isDirectory() ? `${d.name}/` : d.name)).join('\n') || '(empty)';
    }
    case 'read_file': {
      const f = safePath(workspace, args.path);
      if (!fs.existsSync(f)) return 'not found';
      return clip(fs.readFileSync(f, 'utf8'), 60000);
    }
    case 'write_file': {
      const f = safePath(workspace, args.path);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, String(args.content ?? ''));
      return `wrote ${path.relative(workspace, f)} (${String(args.content ?? '').length} chars)`;
    }
    case 'run_command': {
      const cmd = String(args.command || '');
      const mode = agent.autonomy || 'balanced';
      if (mode === 'cautious' || (mode === 'balanced' && RISKY.test(cmd))) {
        const ans = await ctx.ask(`Run this command? ${cmd.slice(0, 160)}`);
        if (!/^(y|yes|ok|okay|sure|go|approve|ship)/i.test(String(ans).trim())) return 'The human said no. Do not run it. Find another way or finish.';
      }
      return runShell(cmd, workspace, ctx.signal);
    }
    case 'web_fetch': {
      const url = String(args.url || '');
      if (!/^https?:\/\//i.test(url)) return 'only http and https urls';
      const res = await fetch(url, { signal: ctx.signal, headers: { 'user-agent': 'DeskHive/0.2' } });
      const type = res.headers.get('content-type') || '';
      let text = await res.text();
      if (type.includes('html')) text = text.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
      return `status ${res.status}\n${clip(text, 12000)}`;
    }
    case 'message_teammate': {
      const mates = ctx.crew();
      const to = mates.find(m => m.id === args.to || m.name.toLowerCase() === String(args.to || '').toLowerCase());
      if (!to) return `no teammate called ${args.to}. Team: ${mates.map(m => m.id).join(', ')}`;
      if (to.id === agent.id) return 'that is you';
      const extra = ctx.replyTo ? { inReplyTo: ctx.replyTo.id, conversation: ctx.replyTo.conversation, hops: (ctx.replyTo.hops || 0) + 1 } : {};
      const replying = ctx.replyTo && ctx.replyTo.from === to.id;
      ctx.send(to.id, replying ? ACT.INFORM : (args.needs_reply ? ACT.QUERY : ACT.INFORM), String(args.subject || '').slice(0, 200), String(args.body || ''), replying ? extra : {});
      return `sent to ${to.name}`;
    }
    case 'ask_human': {
      const ans = await ctx.ask(String(args.question || 'Continue?'));
      return `The human answered: ${ans}`;
    }
    case 'remember': {
      ctx.remember(String(args.fact || '').slice(0, 300));
      return 'saved';
    }
    case 'finish':
      return 'ok';
    default:
      return `unknown tool ${name}`;
  }
}
