// Anthropic API runtime. No CLI needed, just ANTHROPIC_API_KEY.
// Agents write their deliverable as a markdown file in workspace/deliverables.

import fs from 'node:fs';
import path from 'node:path';
import { planPrompt, parsePlan, parseFinal } from './prompts.js';

export async function createApiRuntime({ workspace }) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic();
  const model = process.env.DESKHIVE_MODEL || 'claude-sonnet-5-5';
  const planModel = process.env.DESKHIVE_PLAN_MODEL || model;
  const outDir = path.join(workspace, 'deliverables');
  fs.mkdirSync(outDir, { recursive: true });

  return {
    name: 'api',

    async plan({ text, crew }) {
      const msg = await client.messages.create({ model: planModel, max_tokens: 800, messages: [{ role: 'user', content: planPrompt(text, crew) }] });
      return parsePlan(msg.content.map(c => c.text || '').join(''), crew);
    },

    async run({ agent, task, ctx }) {
      const team = ctx.crew().filter(c => c.id !== agent.id).map(c => `${c.id} (${c.name}): ${c.role}`).join('\n');
      const system = `You are ${agent.name}. ${agent.role}
You work on a small AI team. Write the actual deliverable in markdown.
Special lines you may add at the very end:
TELL <agent id>: <short question or note for a teammate>
ASK_HUMAN: <yes or no question, only for risky choices>
REMEMBER: <fact worth keeping>
Team:\n${team}\nMemory:\n${ctx.memory().slice(-10).join('\n') || '(none)'}`;
      const job = task.kind === 'reply'
        ? `Reply briefly to ${task.message.from}: ${task.message.subject}\n${task.message.body || ''}`
        : `Task ${task.key}: ${task.title}\n${task.detail || ''}`;

      const messages = [{ role: 'user', content: job }];
      let full = '';
      for (let round = 0; round < 3; round++) {
        ctx.update({ status: 'thinking', activity: 'thinking', progress: 0.1 });
        let text = '';
        let chars = 0;
        const stream = client.messages.stream({ model, max_tokens: 2500, system, messages }, { signal: ctx.signal });
        stream.on('text', t => {
          text += t;
          chars += t.length;
          ctx.update({ status: 'working', activity: `Write ${task.key}.md`, progress: Math.min(0.95, chars / 3000) });
          if (t.includes('\n')) ctx.term(text.split('\n').slice(-2, -1)[0] || '');
        });
        await stream.finalMessage();
        full += text;
        const fin = parseFinal(text);
        for (const r of fin.remember) ctx.remember(r);
        for (const m of text.matchAll(/^\s*TELL\s+([a-z0-9_-]+):\s*(.+)$/gim)) {
          if (task.kind === 'reply' && m[1] === task.message.from) {
            ctx.send(m[1], 'inform', m[2], '', { inReplyTo: task.message.id, hops: task.message.hops + 1 });
          } else ctx.send(m[1], 'query', m[2]);
        }
        if (fin.ask) {
          const answer = await ctx.ask(fin.ask);
          messages.push({ role: 'assistant', content: text }, { role: 'user', content: `Human answered: ${answer}. Continue.` });
          continue;
        }
        break;
      }
      if (task.kind === 'reply') {
        if (!/^\s*TELL/im.test(full)) ctx.send(task.message.from, 'inform', full.trim().slice(0, 160), '', { inReplyTo: task.message.id, hops: task.message.hops + 1 });
        return { result: 'replied' };
      }
      const file = path.join(outDir, `${task.key}-${agent.id}.md`);
      fs.writeFileSync(file, `# ${task.title}\n\nBy ${agent.name}\n\n${full}`);
      ctx.term(`saved ${path.relative(workspace, file)}`);
      return { result: `Saved deliverables/${path.basename(file)}` };
    },
  };
}
