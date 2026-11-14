// The DeskHive agent loop. Same loop for every API brain: think, call tools, repeat, finish.

import { TOOL_DEFS, execTool, toolLabel } from './tools.js';
import { AUTONOMY } from '../../shared/protocol.js';

export function systemPrompt({ agent, crew, memory, workspace }) {
  const team = crew.filter(c => c.id !== agent.id).map(c => `- ${c.id} (${c.name}): ${c.role}`).join('\n');
  const mem = memory.length ? memory.slice(-20).map(m => `- ${m}`).join('\n') : '(nothing yet)';
  const auto = AUTONOMY.find(a => a.id === agent.autonomy) || AUTONOMY[1];
  return `You are ${agent.name}, ${agent.role}, on a small team of AI agents that a human watches as a tiny office in VR.

## Your instructions from the human
${agent.instructions || 'Do excellent work and keep the human informed.'}

## Team (use their id with message_teammate)
${team || '(you are alone)'}

## What you remember
${mem}

## How you work
- Your workspace folder is ${workspace}. Use the tools to read, write and run things there.
- Autonomy: ${auto.label}. ${auto.blurb}
- Ask a teammate when their skill fits better. Ask the human only for risky or unclear choices.
- Save useful facts with remember.
- The human can talk to you while you work. Their messages appear as "The human just said". Follow them.
- Your finish summary is spoken out loud in the office, so write it like you talk: short, plain, no markdown.
- When done, call finish.`;
}

// Earlier direct conversation, as alternating turns the model can read.
function priorTurns(conversation, currentText) {
  const turns = [...conversation];
  // The newest human line is the current job; do not repeat it.
  if (turns.length && turns[turns.length - 1].role === 'human' && turns[turns.length - 1].text === currentText) turns.pop();
  const out = [];
  for (const t of turns.slice(-12)) {
    const role = t.role === 'human' ? 'user' : 'assistant';
    const last = out[out.length - 1];
    if (last && last.role === role) { last.text = `${last.text}\n${t.text}`; continue; }
    out.push({ role, text: t.text });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  if (out.length && out[out.length - 1].role === 'user') out.pop(); // keep strict alternation before the job
  return out.map(t => (t.role === 'user' ? { role: 'user', content: t.text } : { role: 'assistant', text: t.text, toolCalls: [] }));
}

export async function runAgentLoop({ chat, agent, task, ctx, workspace, maxSteps = 24 }) {
  const system = systemPrompt({ agent, crew: ctx.crew(), memory: ctx.memory(), workspace });
  let job;
  if (task.kind === 'reply') job = `A teammate wrote to you. Answer them with message_teammate (to: "${task.message.from}"), then call finish.\n\nFrom: ${task.message.from}\nAct: ${task.message.act}\nSubject: ${task.message.subject}\n${task.message.body || ''}`;
  else if (task.kind === 'chat') job = `The human is talking to you directly:\n"${task.title}"\n\nIf they asked a question, answer it. If they asked you to do something, do it with your tools first. Then call finish with what you would say back to them out loud (one to three short sentences).`;
  else job = `Task ${task.key}: ${task.title}${task.detail ? `\n\n${task.detail}` : ''}`;
  if (task.kind === 'reply') ctx.replyTo = task.message;
  const limit = task.kind === 'chat' ? 700 : 200;

  const history = [...(task.kind === 'chat' && ctx.conversation ? priorTurns(ctx.conversation(), task.title) : []), { role: 'user', content: job }];
  let lastText = '';
  for (let step = 1; step <= maxSteps; step++) {
    if (ctx.signal.aborted) throw new Error('stopped');
    // The human talked while we were working: add it before the next model call.
    const heard = ctx.takeSteer?.() || [];
    if (heard.length) {
      const note = `The human just said: ${heard.map(h => `"${h}"`).join(' and ')}. Take it into account now.`;
      const last = history[history.length - 1];
      if (last.role === 'user') last.content = `${last.content}\n\n${note}`;
      else history.push({ role: 'user', content: note });
      ctx.term(`↳ heard you: ${heard.join(' ')}`);
    }
    ctx.update({ status: 'thinking', activity: step === 1 ? 'reading the task' : 'thinking', progress: Math.min(0.95, step / (maxSteps * 0.6)) });
    const out = await chat({ system, history, tools: TOOL_DEFS, signal: ctx.signal });
    if (out.text?.trim()) { ctx.term(out.text.trim()); lastText = out.text.trim(); }
    history.push({ role: 'assistant', text: out.text || '', toolCalls: out.toolCalls });
    if (!out.toolCalls?.length) {
      // No tool call means the model thinks it is done.
      return { result: (task.kind === 'chat' ? lastText.replace(/\s+/g, ' ').trim() : (lastText || 'done').split('\n').filter(Boolean).pop() || '').slice(0, limit) || 'done' };
    }
    for (const call of out.toolCalls) {
      if (ctx.signal.aborted) throw new Error('stopped');
      const label = toolLabel(call.name, call.args);
      ctx.update({ status: 'working', activity: label });
      ctx.term(`● ${label}`);
      if (call.name === 'finish') {
        const summary = String(call.args?.summary || lastText || 'done').slice(0, limit);
        return { result: summary };
      }
      let result;
      try { result = await execTool({ name: call.name, args: call.args, agent, ctx, workspace }); } catch (e) { result = `error: ${e.message}`; }
      ctx.term(`  ⎿ ${String(result).split('\n')[0].slice(0, 120)}`);
      history.push({ role: 'tool', id: call.id, name: call.name, content: result });
    }
  }
  return { result: `Stopped after ${maxSteps} steps. ${lastText.slice(0, 120)}` };
}
