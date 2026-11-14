import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openaiChat, anthropicChat } from '../server/brains/llm.js';
import { runAgentLoop } from '../server/brains/loop.js';
import { parsePlan } from '../server/brains/prompts.js';
import { Floor } from '../shared/floor.js';
import { DEFAULT_CREW, normalizeAgent } from '../shared/protocol.js';
import { createMockRuntime } from '../shared/mockRuntime.js';

// A fake model server that speaks both OpenAI and Anthropic formats and scripts tool calls.
function fakeServer(script) {
  const calls = [];
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', d => { body += d; });
    req.on('end', () => {
      const j = JSON.parse(body);
      calls.push({ url: req.url, body: j, auth: req.headers.authorization || req.headers['x-api-key'] });
      const step = script[Math.min(calls.length - 1, script.length - 1)];
      res.setHeader('content-type', 'application/json');
      if (req.url.endsWith('/v1/messages')) {
        const content = [];
        if (step.text) content.push({ type: 'text', text: step.text });
        for (const [i, t] of (step.tools || []).entries()) content.push({ type: 'tool_use', id: `tu_${calls.length}_${i}`, name: t.name, input: t.args });
        return res.end(JSON.stringify({ content, stop_reason: step.tools ? 'tool_use' : 'end_turn' }));
      }
      const msg = { role: 'assistant', content: step.text || null };
      if (step.tools) msg.tool_calls = step.tools.map((t, i) => ({ id: `call_${calls.length}_${i}`, type: 'function', function: { name: t.name, arguments: JSON.stringify(t.args) } }));
      res.end(JSON.stringify({ choices: [{ message: msg }] }));
    });
  });
  return new Promise(r => srv.listen(0, () => r({ srv, calls, url: `http://localhost:${srv.address().port}` })));
}

function fakeCtx({ answer = 'yes' } = {}) {
  const log = { updates: [], term: [], sent: [], asked: [], memory: [] };
  const ctx = {
    signal: new AbortController().signal,
    memory: () => ['Prefers small PRs'],
    crew: () => DEFAULT_CREW.map(normalizeAgent),
    update: p => log.updates.push(p),
    term: t => log.term.push(t),
    remember: f => log.memory.push(f),
    send: (to, act, subject, body) => log.sent.push({ to, act, subject, body }),
    ask: q => { log.asked.push(q); return Promise.resolve(answer); },
  };
  return { ctx, log };
}

const SCRIPT = [
  { text: 'Plan: write the file then tell Mira.', tools: [{ name: 'write_file', args: { path: 'notes/hello.md', content: '# Hello from the loop' } }] },
  { tools: [{ name: 'run_command', args: { command: 'node -e "console.log(41+1)"' } }, { name: 'message_teammate', args: { to: 'mira', subject: 'Notes are ready', needs_reply: true } }] },
  { tools: [{ name: 'remember', args: { fact: 'Notes live in notes/' } }, { name: 'finish', args: { summary: 'Wrote notes/hello.md and pinged Mira.' } }] },
];

for (const kind of ['openai', 'anthropic']) {
  test(`agent loop runs real tools through the ${kind} adapter`, async () => {
    const { srv, calls, url } = await fakeServer(SCRIPT);
    const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-'));
    const chat = kind === 'openai'
      ? args => openaiChat({ ...args, baseUrl: `${url}/v1`, key: 'sk-test', model: 'fake-model' })
      : args => anthropicChat({ ...args, baseUrl: url, key: 'sk-ant-test', model: 'fake-model' });
    const agent = normalizeAgent({ ...DEFAULT_CREW[1], autonomy: 'balanced', instructions: 'Always write notes.' });
    const { ctx, log } = fakeCtx();
    const out = await runAgentLoop({ chat, agent, task: { key: 'DH-1', title: 'Write hello notes', kind: 'work' }, ctx, workspace: ws });
    srv.close();
    assert.equal(out.result, 'Wrote notes/hello.md and pinged Mira.');
    assert.equal(fs.readFileSync(path.join(ws, 'notes/hello.md'), 'utf8'), '# Hello from the loop');
    assert.deepEqual(log.sent.map(s => [s.to, s.act]), [['mira', 'query']]);
    assert.deepEqual(log.memory, ['Notes live in notes/']);
    assert.ok(log.term.some(t => t.includes('exit 0')), 'command output reached the terminal');
    assert.ok(log.updates.some(u => u.activity?.startsWith('Write notes/hello.md')));
    // Tool results were sent back to the model in the right shape.
    const second = calls[1].body;
    if (kind === 'openai') {
      assert.equal(calls[0].auth, 'Bearer sk-test');
      assert.ok(second.messages.some(m => m.role === 'tool' && /wrote notes/.test(m.content)));
      assert.ok(second.messages[0].content.includes('Always write notes.'), 'instructions in system prompt');
      assert.equal(second.tools.length, 9);
    } else {
      assert.equal(calls[0].auth, 'sk-ant-test');
      const last = second.messages[second.messages.length - 1];
      assert.equal(last.role, 'user');
      assert.equal(last.content[0].type, 'tool_result');
      assert.ok(second.system.includes('Always write notes.'));
    }
  });
}

test('risky commands wait for the human and respect a no', async () => {
  const { srv, url } = await fakeServer([
    { tools: [{ name: 'run_command', args: { command: 'git push origin main' } }] },
    { tools: [{ name: 'finish', args: { summary: 'skipped push' } }] },
  ]);
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-'));
  const { ctx, log } = fakeCtx({ answer: 'no' });
  const agent = normalizeAgent({ ...DEFAULT_CREW[5], autonomy: 'balanced' });
  const out = await runAgentLoop({ chat: a => openaiChat({ ...a, baseUrl: `${url}/v1`, key: 'k', model: 'm' }), agent, task: { key: 'DH-2', title: 'push', kind: 'work' }, ctx, workspace: ws });
  srv.close();
  assert.equal(log.asked.length, 1);
  assert.match(log.asked[0], /git push/);
  assert.equal(out.result, 'skipped push');
});

test('file tools cannot escape the workspace', async () => {
  const { srv, url } = await fakeServer([
    { tools: [{ name: 'read_file', args: { path: '../../etc/passwd' } }] },
    { tools: [{ name: 'finish', args: { summary: 'ok' } }] },
  ]);
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-'));
  const { ctx, log } = fakeCtx();
  await runAgentLoop({ chat: a => openaiChat({ ...a, baseUrl: `${url}/v1`, key: 'k', model: 'm' }), agent: normalizeAgent(DEFAULT_CREW[1]), task: { key: 'DH-3', title: 'x', kind: 'work' }, ctx, workspace: ws });
  srv.close();
  assert.ok(log.term.some(t => /outside the workspace/.test(t)));
});

test('planner JSON is parsed and unknown agents go to the tray', () => {
  const crew = DEFAULT_CREW.map(normalizeAgent);
  const plan = parsePlan('Sure! {"reply":"On it","tasks":[{"agentId":"kai","title":"Build it"},{"agentId":"ghost","title":"Mystery"}]}', crew);
  assert.deepEqual(plan.tasks.map(t => t.agentId), ['kai', null]);
});

test('hire, edit and fire agents on the floor', async () => {
  const saved = [];
  const f = new Floor({ runtime: createMockRuntime({ speed: 50, askHumanRate: 0, askPeerRate: 0 }), crew: DEFAULT_CREW, store: { onCrew: d => saved.push(d) } });
  const a = f.hire({ name: 'Echo Bot', role: 'Trend scout', skills: ['trend', 'social', 'twitter'], provider: 'xai', model: 'grok-4.7', look: { species: 'robot' } });
  assert.equal(a.id, 'echo-bot');
  assert.equal(a.seat, 'd6');
  assert.equal(a.provider, 'xai');
  f.updateAgent('echo-bot', { name: 'Echo', instructions: 'Cite posts.', look: { species: 'cat', accessory: 'crown' } });
  assert.equal(f.agents.get('echo-bot').name, 'Echo');
  assert.equal(f.agents.get('echo-bot').look.accessory, 'crown');
  await f.humanSay('scan the trend on social', null);
  assert.ok(f.tasks.some(t => t.assignee === 'echo-bot'));
  f.fire('echo-bot');
  assert.ok(!f.agents.has('echo-bot'));
  assert.ok(f.tasks.filter(t => t.title.toLowerCase().includes('trend')).every(t => t.status === 'backlog' || t.status === 'done'));
  assert.equal(f.fire('nova'), false, 'cannot fire the boss');
  assert.equal(saved.at(-1).length, 7);
  for (let i = 0; i < 4; i++) f.hire({ name: `X${i}` });
  assert.equal(f.hire({ name: 'TooMany' }), null, '9 desks max');
});

test('Meta Muse brain: OpenAI style tool loop with Meta parameters', async () => {
  const { srv, calls, url } = await fakeServer([
    { tools: [{ name: 'write_file', args: { path: 'muse.txt', content: 'made by muse' } }] },
    { tools: [{ name: 'finish', args: { summary: 'Wrote muse.txt.' } }] },
  ]);
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-meta-'));
  const chat = args => openaiChat({ ...args, baseUrl: `${url}/v1`, key: 'meta-key', model: 'muse-spark-1.3', flavor: 'meta' });
  const { ctx } = fakeCtx();
  const out = await runAgentLoop({ chat, agent: normalizeAgent({ ...DEFAULT_CREW[1], provider: 'meta' }), task: { key: 'DH-9', title: 'write muse.txt', kind: 'work' }, ctx, workspace: ws });
  assert.equal(out.result, 'Wrote muse.txt.');
  assert.equal(fs.readFileSync(path.join(ws, 'muse.txt'), 'utf8'), 'made by muse');
  const b = calls[0].body;
  assert.equal(b.model, 'muse-spark-1.3');
  assert.equal(b.max_tokens, undefined);
  assert.ok(b.max_completion_tokens > 0);
  assert.equal(b.reasoning_effort, 'low');
  assert.equal(calls[0].auth, 'Bearer meta-key');
  assert.ok(!('stop' in b) && !('logprobs' in b), 'no params Meta rejects');
  srv.close();
});

test('Meta key makes Muse Spark the default brain', async () => {
  const { BrainConfig } = await import('../server/brains/config.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dh-cfg-'));
  process.env.META_API_KEY = 'from-alias';
  const c = new BrainConfig(dir);
  assert.equal(c.key('meta'), 'from-alias', 'META_API_KEY works as an alias of MODEL_API_KEY');
  assert.equal(c.keySource('meta'), 'env META_API_KEY');
  assert.equal(c.baseUrl('meta'), 'https://api.meta.ai/v1');
  delete process.env.META_API_KEY;
  const { providerById } = await import('../shared/protocol.js');
  assert.equal(providerById('meta').models[0], 'muse-spark-1.3');
  assert.equal(providerById('ollama').models[0], 'llama3.2:3b', 'local default is Llama');
});
