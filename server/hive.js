// The hive on disk. Plain files so you can read, grep and git them.
//
// hive/
//   PROTOCOL.md       how agents talk (read by real CLI agents)
//   registry.json     the crew
//   tasks.json        the task ledger
//   board.md          shared notes written by the boss
//   log.jsonl         append only event feed
//   agents/<id>/
//     identity.md     who am I
//     memory.md       what I learned (I read it at start, the floor appends)
//     inbox/          mail delivered to me
//     outbox/         mail I want to send (the router drains it)

import fs from 'node:fs';
import path from 'node:path';

const PROTOCOL = `# DeskHive protocol

You are one agent on a small team. A human watches the team as a tiny office on their desk in VR.

## Talk to a teammate
Write one JSON file into your outbox folder. The router delivers it.

    {"to": "<agent id>", "act": "query" | "request" | "inform", "subject": "one line", "body": "optional detail"}

Use "query" or "request" when you need an answer. Use "inform" to share news. Keep it short.

## Ask the human
End your final message with one line:

    ASK_HUMAN: <your yes or no question>

You will be resumed with the answer. Ask only for risky things: deploys, deletes, spend, scope changes.

## Remember something
Add lines like this to your final message. They are saved to your memory.md.

    REMEMBER: <fact worth keeping>

## Finish
End with a one line summary of what you did.
`;

function writeAtomic(file, data) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export class Hive {
  constructor(root) {
    this.root = path.resolve(root);
    this.agentsDir = path.join(this.root, 'agents');
    fs.mkdirSync(this.agentsDir, { recursive: true });
    if (!fs.existsSync(path.join(this.root, 'PROTOCOL.md'))) fs.writeFileSync(path.join(this.root, 'PROTOCOL.md'), PROTOCOL);
    if (!fs.existsSync(path.join(this.root, 'board.md'))) fs.writeFileSync(path.join(this.root, 'board.md'), '# Board\n\nShared notes. The boss keeps this tidy.\n');
    this.logFile = path.join(this.root, 'log.jsonl');
  }

  agentDir(id) { return path.join(this.agentsDir, id); }

  ensureAgent(agent) {
    const dir = this.agentDir(agent.id);
    for (const sub of ['inbox', 'outbox', path.join('outbox', '.sent')]) fs.mkdirSync(path.join(dir, sub), { recursive: true });
    const identity = `# ${agent.name}\n\nid: ${agent.id}\n\n${agent.role}\n\nSkills: ${(agent.skills || []).join(', ')}\n`;
    fs.writeFileSync(path.join(dir, 'identity.md'), identity);
    const mem = path.join(dir, 'memory.md');
    if (!fs.existsSync(mem)) fs.writeFileSync(mem, `# ${agent.name} memory\n\n`);
  }

  writeRegistry(agents) {
    writeAtomic(path.join(this.root, 'registry.json'), JSON.stringify(agents.map(a => ({ id: a.id, name: a.name, role: a.role, skills: a.skills, isBoss: !!a.isBoss })), null, 2));
  }

  readMemory(id) {
    try {
      return fs.readFileSync(path.join(this.agentDir(id), 'memory.md'), 'utf8').split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2));
    } catch { return []; }
  }

  appendMemory(id, fact) {
    fs.appendFileSync(path.join(this.agentDir(id), 'memory.md'), `- ${fact.replace(/\n/g, ' ')}\n`);
  }

  writeTasks(tasks) {
    writeAtomic(path.join(this.root, 'tasks.json'), JSON.stringify(tasks.filter(t => t.kind === 'work'), null, 2));
  }

  readTasks() {
    try { return JSON.parse(fs.readFileSync(path.join(this.root, 'tasks.json'), 'utf8')); } catch { return []; }
  }

  appendLog(entry) {
    fs.appendFileSync(this.logFile, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  }

  deliver(msg) {
    if (!msg.to || msg.to === 'human') return;
    const dir = path.join(this.agentDir(msg.to), 'inbox');
    if (!fs.existsSync(dir)) return;
    writeAtomic(path.join(dir, `${Date.now()}-${msg.id}.json`), JSON.stringify(msg, null, 2));
  }

  // Drain every outbox. Returns raw mail objects with a from field.
  drainOutboxes(agentIds) {
    const out = [];
    for (const id of agentIds) {
      const dir = path.join(this.agentDir(id), 'outbox');
      let files = [];
      try { files = fs.readdirSync(dir).filter(f => f.endsWith('.json')); } catch { continue; }
      for (const f of files) {
        const full = path.join(dir, f);
        try {
          const raw = JSON.parse(fs.readFileSync(full, 'utf8'));
          out.push({ ...raw, from: id });
        } catch (e) {
          out.push({ from: id, to: 'human', act: 'inform', subject: `bad outbox file ${f}: ${e.message}` });
        }
        try { fs.renameSync(full, path.join(dir, '.sent', f)); } catch { /* ignore */ }
      }
    }
    return out;
  }

  // Direct conversation with the human, one JSON line per turn.
  appendConvo(id, turn) {
    try { fs.appendFileSync(path.join(this.agentDir(id), 'conversation.jsonl'), `${JSON.stringify(turn)}\n`); } catch { /* agent gone */ }
  }

  readConvo(id, n = 30) {
    try {
      return fs.readFileSync(path.join(this.agentDir(id), 'conversation.jsonl'), 'utf8').trim().split('\n').filter(Boolean).slice(-n).map(l => JSON.parse(l));
    } catch { return []; }
  }

  // Claude Code session id, so an agent keeps its whole context between chats.
  writeSession(id, sessionId) {
    const f = path.join(this.agentDir(id), 'session.json');
    try { if (sessionId) writeAtomic(f, JSON.stringify({ sessionId, at: Date.now() })); else if (fs.existsSync(f)) fs.unlinkSync(f); } catch { /* */ }
  }

  readSession(id) {
    try { return JSON.parse(fs.readFileSync(path.join(this.agentDir(id), 'session.json'), 'utf8')).sessionId || null; } catch { return null; }
  }
}
