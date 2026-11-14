// Prompts shared by the real runtimes.

export function planPrompt(text, crew) {
  const roster = crew.filter(c => !c.isBoss).map(c => `- ${c.id} (${c.name}): ${c.role}`).join('\n');
  return `You are Nova, chief of staff for a small team of AI agents. The human just said:

"""${text}"""

Your team:
${roster}

Split the request into 1 to 4 concrete tasks and route each to the best teammate.
If nobody fits a task, use null for agentId so it goes on the tray for the human.
Reply with ONLY this JSON, no prose:
{"reply": "one or two short friendly sentences to the human", "tasks": [{"agentId": "kai", "title": "short imperative title", "detail": "what done looks like"}]}`;
}

export function parsePlan(raw, crew) {
  const text = String(raw || '');
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('planner did not return JSON');
  const obj = JSON.parse(text.slice(start, end + 1));
  const ids = new Set(crew.map(c => c.id));
  return {
    reply: String(obj.reply || 'On it.'),
    tasks: (obj.tasks || []).slice(0, 6).map(t => ({
      agentId: ids.has(t.agentId) ? t.agentId : null,
      title: String(t.title || 'Untitled task').slice(0, 120),
      detail: String(t.detail || ''),
    })),
  };
}

export function workPrompt({ agent, task, memory, crew, hiveDir, agentDir }) {
  const team = crew.filter(c => c.id !== agent.id).map(c => `- ${c.id} (${c.name}): ${c.role}`).join('\n');
  const mem = memory.length ? memory.slice(-15).map(m => `- ${m}`).join('\n') : '(nothing yet)';
  const job = task.kind === 'reply'
    ? `A teammate wrote to you. Answer them by writing a JSON file to your outbox with "to": "${task.message.from}" and "act": "inform".\n\nFrom: ${task.message.from}\nAct: ${task.message.act}\nSubject: ${task.message.subject}\n${task.message.body || ''}`
    : `Task ${task.key}: ${task.title}\n${task.detail || ''}`;
  return `You are ${agent.name}. ${agent.role}

Read the team protocol at ${hiveDir}/PROTOCOL.md once if you have not.
Your outbox folder: ${agentDir}/outbox

Your team:
${team}

What you remember:
${mem}

${job}

Work in the current folder. Be brief in chat. Follow the protocol for asking the human and remembering.`;
}

// Pull ASK_HUMAN and REMEMBER lines out of a final message.
export function parseFinal(text) {
  const lines = String(text || '').split('\n');
  let ask = null;
  const remember = [];
  const rest = [];
  for (const l of lines) {
    const m1 = l.match(/^\s*ASK_HUMAN:\s*(.+)$/);
    const m2 = l.match(/^\s*REMEMBER:\s*(.+)$/);
    if (m1) ask = m1[1].trim();
    else if (m2) remember.push(m2[1].trim());
    else rest.push(l);
  }
  const summary = rest.join(' ').replace(/\s+/g, ' ').trim();
  return { ask, remember, summary: summary.slice(-200) };
}
