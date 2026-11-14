import test from 'node:test';
import assert from 'node:assert/strict';
import { Floor } from '../shared/floor.js';
import { DEFAULT_CREW } from '../shared/protocol.js';
import { createMockRuntime, routeByKeywords } from '../shared/mockRuntime.js';

const wait = ms => new Promise(r => setTimeout(r, ms));
const mk = () => new Floor({ runtime: createMockRuntime({ speed: 40, askHumanRate: 0, askPeerRate: 0 }), crew: DEFAULT_CREW });

test('keyword router splits a request and picks the right people', () => {
  const t = routeByKeywords('build the settings page UI and add an auth endpoint, then deploy to vercel', DEFAULT_CREW);
  assert.deepEqual(t.map(x => x.agentId), ['kai', 'mira', 'zara']);
});

test('boss plans, workers finish, boss reports', async () => {
  const f = mk();
  await f.humanSay('fix the flaky test');
  await wait(1500);
  const leo = f.agents.get('leo');
  assert.equal(leo.doneCount, 1);
  assert.ok(f.chat.some(c => c.from === 'nova' && /finished/.test(c.text)));
});

test('an agent can block on the human and resume on yes', async () => {
  const f = mk();
  await f.humanSay('deploy to production');
  await wait(1500);
  assert.equal(f.agents.get('zara').status, 'blocked');
  await f.humanSay('yes');
  await wait(1500);
  assert.equal(f.agents.get('zara').doneCount, 1);
});

test('stop frees the agent and returns the task to the tray', async () => {
  const f = mk();
  await f.humanSay('deploy to production');
  await wait(300);
  f.stop('zara');
  await wait(100);
  assert.equal(f.agents.get('zara').status, 'idle');
  assert.ok(f.tasks.some(t => t.status === 'backlog'));
});

test('mail loops are cut off at the hop cap', () => {
  const f = mk();
  const seen = [];
  f.on(e => { if (e.type === 'chat') seen.push(e.line.text); });
  f.route({ id: 'm1', from: 'kai', to: 'mira', act: 'query', subject: 'x', body: '', hops: 99 });
  assert.ok(seen.some(t => /looping/.test(t)));
});

test('shipping work earns XP, levels up and counts the daily goal', async () => {
  const saved = [];
  const f = new Floor({ runtime: createMockRuntime({ speed: 40, askHumanRate: 0, askPeerRate: 0 }), crew: DEFAULT_CREW, store: { onProgress: p => saved.push({ ...p }) } });
  const ups = [];
  f.on(e => { if (e.type === 'progress' && e.levelUp) ups.push(e.progress.level); });
  f.gain(55);
  await f.humanSay('fix the flaky test');
  await wait(1500);
  const p = f.progressView();
  assert.ok(p.xp >= 75, `xp ${p.xp}`);
  assert.equal(p.level, 2);
  assert.equal(p.todayDone, 1);
  assert.deepEqual(ups, [2]);
  assert.ok(f.chat.some(c => c.from === 'nova' && /Office level 2/.test(c.text)));
  assert.ok(saved.length > 0);
});

test('coming back counts the streak and recaps what shipped while you were away', () => {
  const day = 86400000;
  const now = Date.now();
  const f = new Floor({ runtime: createMockRuntime(), crew: DEFAULT_CREW, progress: { xp: 0, streak: 2, lastDay: new Date(now - day).toISOString().slice(0, 10), lastSeen: now - 3 * 3600000 } });
  // lastDay uses local dates: rebuild it the same way the floor does.
  const d = new Date(now - day);
  f.progress.lastDay = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  f.tasks.push({ id: 'x', key: 'T-9', title: 'Ship the pricing page', kind: 'work', status: 'done', doneAt: now - 3600000 });
  const text = f.hello(now);
  assert.equal(f.progress.streak, 3);
  assert.match(text, /Day 3 in a row/);
  assert.match(text, /shipped 1: Ship the pricing page/);
  // A quick reload does not recap again.
  assert.equal(f.hello(now + 60000), null);
});
