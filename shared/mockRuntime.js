// Mock runtime: a scripted brain so the floor works with no keys and no CLI.
// Great for the demo video and for judges who open the web link.

import { ACT } from './protocol.js';

const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const rand = (a, b) => a + Math.random() * (b - a);

const STEPS = {
  kai: [['Read', 'src/components/Header.tsx'], ['Grep', '"theme"'], ['Edit', 'src/components/Toggle.tsx'], ['Edit', 'src/styles/tokens.css'], ['Bash', 'npm run lint'], ['Bash', 'npm run dev'], ['Read', 'src/App.tsx']],
  mira: [['Read', 'server/routes/users.ts'], ['Edit', 'server/db/schema.sql'], ['Bash', 'npm run migrate'], ['Edit', 'server/routes/auth.ts'], ['Bash', 'curl localhost:3000/api/health'], ['Grep', '"findUser"']],
  leo: [['Bash', 'npm test'], ['Read', 'tests/login.spec.ts'], ['Edit', 'tests/login.spec.ts'], ['Bash', 'npx playwright test'], ['Grep', '"flaky"'], ['Bash', 'npm test -- --watch=false']],
  ravi: [['WebSearch', 'best options 2026'], ['WebFetch', 'docs page'], ['Read', 'notes/brief.md'], ['Write', 'notes/compare.md'], ['WebSearch', 'pricing and limits']],
  zara: [['Bash', 'docker build .'], ['Read', '.github/workflows/ci.yml'], ['Edit', 'vercel.json'], ['Bash', 'npm run build'], ['Bash', 'vercel --prebuilt']],
  theo: [['Read', 'CHANGELOG.md'], ['Write', 'docs/release-notes.md'], ['Edit', 'README.md'], ['Read', 'docs/pitch.md'], ['Write', 'docs/post.md']],
};

const ASKS = {
  kai: [['mira', 'What shape is the /users response?'], ['theo', 'Can you give me the button copy?']],
  mira: [['zara', 'Is the staging DB up?'], ['leo', 'Can you run the auth tests after my change?']],
  leo: [['kai', 'Which selector should the test use for the toggle?'], ['mira', 'Is the login rate limit 5 per minute?']],
  ravi: [['theo', 'Want my brief as bullet points or prose?']],
  zara: [['leo', 'Are all tests green before I ship?']],
  theo: [['ravi', 'Do you have the numbers for the post?'], ['kai', 'What did the new UI change?']],
};

const REPLIES = [
  'Yes, it is in the latest commit.', 'Use the data attribute selector.', 'It is an array of { id, name, email }.',
  'All green on my side.', 'Staging is up.', 'Bullets please.', 'Try "Switch theme".', 'Five per minute, yes.',
];

const HUMAN_ASKS = {
  zara: ['Ship this to production now?', 'The deploy will restart the API for 30 seconds. Go ahead?'],
  mira: ['This migration drops an old column. OK to run it?'],
  kai: ['Two layouts look good. Keep the compact one?'],
  ravi: ['Should I include paid tools in the comparison?'],
  leo: ['One test is flaky. Quarantine it for now?'],
  theo: ['Formal or playful tone for the post?'],
};

// Map any agent to a step family by its skills, so hired agents work too.
const FAMILY_SKILLS = {
  kai: ['ui', 'frontend', 'css', 'react', 'design'],
  mira: ['api', 'backend', 'database', 'db', 'sql', 'server'],
  leo: ['test', 'qa', 'bug', 'e2e', 'security', 'audit', 'review'],
  ravi: ['research', 'compare', 'market', 'trend', 'news', 'social'],
  zara: ['deploy', 'ci', 'infra', 'docker', 'ship', 'pipeline'],
  theo: ['write', 'copy', 'docs', 'blog', 'post', 'readme'],
};
function family(agent) {
  if (STEPS[agent.id]) return agent.id;
  let best = 'ravi'; let bestN = 0;
  for (const [fam, skills] of Object.entries(FAMILY_SKILLS)) {
    const n = (agent.skills || []).filter(s => skills.includes(s)).length;
    if (n > bestN) { best = fam; bestN = n; }
  }
  return best;
}

function score(agent, text) {
  const t = text.toLowerCase();
  return (agent.skills || []).reduce((s, k) => s + (t.includes(k) ? 1 : 0), 0);
}

export function routeByKeywords(text, crew) {
  const parts = text.split(/\s*(?:,|;|\. | and then | and also | then | also | and )\s*/i)
    .map(s => s.trim().replace(/^(then|also|and|please)\s+/i, '')).filter(s => s.length > 3);
  const chunks = parts.length ? parts : [text];
  const tasks = [];
  for (const chunk of chunks) {
    let best = null; let bestScore = 0;
    for (const a of crew) {
      if (a.isBoss) continue;
      const s = score(a, chunk);
      if (s > bestScore) { best = a; bestScore = s; }
    }
    const title = chunk.charAt(0).toUpperCase() + chunk.slice(1).replace(/[.?!]+$/, '');
    tasks.push({ agentId: best?.id || null, title });
  }
  return tasks;
}

export function createMockRuntime({ speed = 1, askHumanRate = 0.18, askPeerRate = 0.35 } = {}) {
  const S = ms => ms / speed;
  return {
    name: 'demo',

    async plan({ text, crew, context = '' }) {
      await new Promise(r => setTimeout(r, S(900)));
      // A question or small talk gets an answer, not a pile of tasks.
      const isWork = !(/\?\s*$/.test(text) || /^(hi|hello|hey|yo|thanks|thank you|good (morning|evening|afternoon)|what|how|who|why|when|where|is|are|can you tell|tell me|any)\b/i.test(text.trim()));
      if (!isWork) {
        const lines = context.split('\n').filter(l => /^- /.test(l) && !/: idle$/.test(l)).slice(0, 3).map(l => l.slice(2));
        if (/^(hi|hello|hey|yo|good (morning|evening|afternoon))\b/i.test(text)) return { reply: `Hey! I am Nova. Tell me what to ship, or talk to anyone by name.`, tasks: [] };
        return { reply: lines.length ? `Here is where we are. ${lines.join('. ')}.` : 'Everyone is free right now. Give me something to build.', tasks: [] };
      }
      const tasks = routeByKeywords(text, crew);
      const routed = tasks.filter(t => t.agentId);
      const tray = tasks.length - routed.length;
      const names = routed.map(t => crew.find(c => c.id === t.agentId).name);
      let reply;
      if (routed.length && tray) reply = `Got it. ${names.join(' and ')} on it. ${tray} card${tray > 1 ? 's' : ''} on the tray for you to hand out.`;
      else if (routed.length) reply = `Got it. ${names.join(' and ')} ${names.length > 1 ? 'are' : 'is'} on it.`;
      else reply = 'Not sure who fits best. I put it on the tray. Drag the card to someone.';
      return { reply, tasks };
    },

    canSteer: () => true,

    async run({ agent, task, ctx }) {
      // You talked to this agent directly.
      if (task.kind === 'chat') {
        const text = task.title;
        ctx.update({ status: 'thinking', activity: 'listening', progress: 0.2 });
        await ctx.sleep(S(rand(600, 1100)));
        const doing = /\b(build|fix|make|add|write|create|test|deploy|refactor|update|change|ship|research|find|draft|check|review|run)\b/i.test(text);
        if (doing) {
          const steps = STEPS[family(agent)];
          for (let i = 0; i < 3; i++) {
            const [tool, arg] = pick(steps);
            ctx.update({ status: 'working', activity: `${tool} ${arg}`, progress: (i + 1) / 4 });
            ctx.term(`● ${tool}(${arg})`);
            await ctx.sleep(S(rand(900, 1600)));
            const heard = ctx.takeSteer?.() || [];
            if (heard.length) ctx.term(`(noted: ${heard.join(' ')})`);
          }
          ctx.remember(`You asked me: ${text.slice(0, 80)}`);
          return { result: pick([`Done. I handled "${text.slice(0, 60)}". Want me to open a PR?`, `Finished that. ${pick(['Tests pass.', 'Looks clean.', 'I left notes in the workspace.'])}`, `All set on "${text.slice(0, 50)}".`]) };
        }
        const mem = ctx.memory();
        const last = mem[mem.length - 1];
        const said = ctx.conversation().filter(t => t.role === 'human').length;
        const answers = [
          `Hey! I am ${agent.name}, your ${agent.role.toLowerCase()}. ${last ? `Last thing on my mind: ${last}.` : 'Nothing on my plate yet.'} What should I do?`,
          `Good question. In this demo I am scripted, so connect a real brain in Connections and I will really think about it.`,
          `${said > 1 ? 'Like I said, ' : ''}I can take that. Just tell me what done looks like.`,
        ];
        return { result: answers[Math.min(said - 1, answers.length - 1)] || answers[0] };
      }

      // Reply to a teammate.
      if (task.kind === 'reply') {
        ctx.update({ status: 'working', activity: 'reading mail', progress: 0.3 });
        await ctx.sleep(S(rand(900, 1600)));
        ctx.update({ activity: 'writing reply', progress: 0.7 });
        await ctx.sleep(S(rand(700, 1200)));
        const answer = pick(REPLIES);
        ctx.term(answer);
        ctx.send(task.message.from, ACT.INFORM, `Re: ${task.message.subject} ${answer}`, '', { inReplyTo: task.message.id, conversation: task.message.conversation, hops: task.message.hops + 1 });
        return { result: 'replied' };
      }

      const fam = family(agent);
      const steps = STEPS[fam];
      const n = 4 + Math.floor(Math.random() * 3);
      const askPeerAt = Math.random() < askPeerRate ? 1 + Math.floor(Math.random() * (n - 2)) : -1;
      const wantsHuman = fam === 'zara' && /deploy|ship|prod|release/i.test(task.title);
      const askHumanAt = wantsHuman ? n - 1 : (Math.random() < askHumanRate ? 2 : -1);

      if (agent.instructions) ctx.term(`(following my instructions: ${agent.instructions.slice(0, 90)}${agent.instructions.length > 90 ? '…' : ''})`);
      await ctx.sleep(S(rand(700, 1300)));
      for (let i = 0; i < n; i++) {
        const [tool, arg] = pick(steps);
        ctx.update({ status: 'working', activity: `${tool} ${arg}`, progress: (i + 0.5) / n });
        ctx.term(`● ${tool}(${arg})`);
        const heard = ctx.takeSteer?.() || [];
        if (heard.length) { ctx.term(`(you said: ${heard.join(' ')}. adjusting)`); ctx.remember(`Human steered ${task.key}: ${heard.join(' ')}`); }
        await ctx.sleep(S(rand(1300, 2600)));
        ctx.term(`  ⎿ ${pick(['ok', 'done', '3 files changed', 'no issues', 'passed', '12 matches', 'saved'])}`);

        if (i === askPeerAt) {
          let opts = (ASKS[agent.id] || []).filter(([to]) => ctx.crew().some(c => c.id === to));
          if (!opts.length) {
            const mates = ctx.crew().filter(c => !c.isBoss && c.id !== agent.id);
            if (mates.length) opts = [[pick(mates).id, pick(['Can you check my change?', 'Any blockers on your side?', 'Do you have the latest numbers?'])]];
          }
          if (opts.length) {
            const [to, q] = pick(opts);
            ctx.send(to, ACT.QUERY, q);
            ctx.term(`✉ asked ${to}: ${q}`);
          }
        }
        if (i === askHumanAt) {
          const q = pick(HUMAN_ASKS[agent.id] || HUMAN_ASKS[fam] || ['Should I keep going?']);
          const ans = await ctx.ask(`${q} (${task.key})`);
          if (/^(no|n|nope|stop|deny|wait)\b/i.test(ans)) {
            ctx.term('human said no. wrapping up safely.');
            ctx.remember(`Human declined: ${q}`);
            return { result: 'Paused at your request.' };
          }
          ctx.remember(`Human approved: ${q}`);
        }
      }
      ctx.update({ activity: 'writing summary', progress: 0.97 });
      await ctx.sleep(S(700));
      ctx.remember(`Did ${task.key}: ${task.title}`);
      return { result: pick(['All checks pass.', 'Ready for review.', 'Pushed to a branch.', 'Notes saved.', 'Looks good.']) };
    },
  };
}

export const STARTER_BACKLOG = [
  'Add a dark mode toggle to settings',
  'Fix the flaky login test',
  'Compare three vector databases',
  'Write release notes for v0.2',
  'Deploy the API to production',
];
