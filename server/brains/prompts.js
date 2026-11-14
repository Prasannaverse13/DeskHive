// Prompts shared by the brains.

export function planPrompt(text, crew, boss, { context = '', conversation = [] } = {}) {
  const convo = conversation.slice(-10).map(t => `${t.role === 'human' ? 'Human' : boss?.name || 'Nova'}: ${t.text}`).join('\n');
  const roster = crew.filter(c => !c.isBoss).map(c => `- ${c.id} (${c.name}): ${c.role}. Skills: ${(c.skills || []).join(', ')}`).join('\n');
  return `You are ${boss?.name || 'Nova'}, chief of staff for a small team of AI agents.
${boss?.instructions ? `Your instructions: ${boss.instructions}\n` : ''}
${convo ? `Recent conversation with the human:\n${convo}\n\n` : ''}The human just said:
"""${text}"""

Your team:
${roster}

${context ? `Team status:\n${context}\n\n` : ''}If the human gave work: split it into 1 to 4 concrete tasks and route each to the best teammate.
If nobody fits a task, use null for agentId so it goes on the tray for the human.
If the human only asked a question or chatted: answer it in reply using the team status, and return no tasks.
Your reply is spoken out loud, so keep it short and plain, no markdown.
Reply with ONLY this JSON, no prose:
{"reply": "one or two short friendly sentences to the human", "tasks": [{"agentId": "id", "title": "short imperative title", "detail": "what done looks like"}]}`;
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

// Prompt for CLI coding agents (Claude Code, Codex). They use files for mail.
export function cliPrompt({ agent, task, memory, crew, hiveDir, agentDir }) {
  const team = crew.filter(c => c.id !== agent.id).map(c => `- ${c.id} (${c.name}): ${c.role}`).join('\n');
  const mem = memory.length ? memory.slice(-15).map(m => `- ${m}`).join('\n') : '(nothing yet)';
  const job = cliJob(task);
  return `You are ${agent.name}, ${agent.role}.

Your instructions from the human:
${agent.instructions || 'Do excellent work.'}

Team protocol: ${hiveDir}/PROTOCOL.md (read it once).
Your outbox folder: ${agentDir}/outbox

Your team:
${team}

What you remember:
${mem}

${job}

Work in the current folder. Be brief. To ask the human end with a line ASK_HUMAN: <question>. To save a fact add a line REMEMBER: <fact>.`;
}

export function cliJob(task) {
  if (task.kind === 'reply') return `A teammate wrote to you. Answer them by writing a JSON file to your outbox with "to": "${task.message.from}" and "act": "inform".\n\nFrom: ${task.message.from}\nAct: ${task.message.act}\nSubject: ${task.message.subject}\n${task.message.body || ''}`;
  if (task.kind === 'chat') return `The human is talking to you directly:\n"${task.title}"\nIf it is a question, answer it. If it asks you to do something, do it first. Your final message is spoken out loud to them: one to three short plain sentences, no markdown.`;
  return `Task ${task.key}: ${task.title}\n${task.detail || ''}`;
}

// Short follow up prompt for a resumed Claude Code session (it already knows who it is).
export function cliFollowUp({ agent, task, memory }) {
  const mem = memory.length ? `\nThings you remember:\n${memory.slice(-5).map(m => `- ${m}`).join('\n')}\n` : '';
  return `(DeskHive) You are still ${agent.name}. Same team protocol as before.${mem}\n${cliJob(task)}\n\nTo ask the human end with ASK_HUMAN: <question>. To save a fact add REMEMBER: <fact>.`;
}

// Earlier direct conversation for brains that cannot resume a session.
export function convoText(conversation, currentText) {
  const turns = conversation.filter(t => t.text !== currentText).slice(-8);
  return turns.length ? `\nYour recent conversation with the human:\n${turns.map(t => `${t.role === 'human' ? 'Human' : 'You'}: ${t.text}`).join('\n')}\n` : '';
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
  return { ask, remember, summary: summary.slice(-700) };
}
