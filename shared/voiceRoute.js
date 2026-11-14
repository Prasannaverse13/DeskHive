// Who did you just talk to? Turns a spoken line into { to, text }.
//
//   "Kai, fix the header"           -> Kai
//   "hey Mira can you check auth"   -> Mira
//   "tell Leo to run the tests"     -> Leo: "run the tests"
//   "everyone, standup"             -> Nova (the boss plans it)
//   "ship the docs"                 -> whoever you look at or selected, else Nova
//   "Kai"                           -> just picks Kai (next line goes to Kai)

const WAKE = /^(hey|hi|hello|ok|okay|yo|oi|so|um+|uh+|alright|right)[\s,.!]+/i;
const TEAM = /^(everyone|everybody|team|guys|folks|all of you|y'all)[\s,.:!]+/i;
// Short common words that sound like names. Never fuzzy match these.
const STOP = new Set(['the', 'then', 'they', 'them', 'there', 'their', 'this', 'that', 'than', 'can', 'may', 'and', 'all', 'let', 'lets', 'make', 'take', 'more', 'mike', 'like', 'also', 'okay', 'what', 'when', 'where', 'who', 'how', 'why', 'now', 'new', 'run', 'see', 'set', 'get', 'yes', 'no', 'not', 'one', 'two', 'way', 'kit', 'key', 'cool', 'read', 'ready', 'leave']);

function lev(a, b) {
  if (Math.abs(a.length - b.length) > 1) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

// Rough sound skeleton: first letter, then consonants. "Kye" and "Kai" both become "k".
function skeleton(w) {
  const s = w.toLowerCase().replace(/^th/, 't').replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c(?=[aou])/g, 'k');
  return (s[0] + s.slice(1).replace(/[aeiouyhw]/g, '')).replace(/(.)\1+/g, '$1');
}

export function findAgent(word, agents, { fuzzy = false } = {}) {
  const w = String(word || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!w) return null;
  const exact = agents.find(a => a.name.toLowerCase().replace(/[^a-z0-9]/g, '') === w || a.id === w);
  if (exact) return exact;
  if (!fuzzy || w.length < 3 || STOP.has(w)) return null;
  const close = agents.filter(a => {
    const n = a.name.toLowerCase().replace(/[^a-z0-9]/g, '');
    return n.length >= 3 && (lev(n, w) <= 1 || skeleton(n) === skeleton(w));
  });
  return close.length === 1 ? close[0] : null;
}

const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

export function routeUtterance(raw, agents, { focusId = null } = {}) {
  let text = String(raw || '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  for (let i = 0; i < 2; i++) text = text.replace(WAKE, '');
  const boss = agents.find(a => a.isBoss);
  const result = (agent, body, how) => ({ to: agent && !agent.isBoss ? agent.id : null, agentId: agent?.id || boss?.id || null, text: cap(body.trim()), how });

  if (TEAM.test(text)) return result(boss, text.replace(TEAM, ''), 'team');

  // "tell Leo to run the tests", "ask Mira whether the db is up"
  let m = text.match(/^(?:tell|ask|have|get)\s+([a-z0-9-]+)[,]?\s+(?:to\s+|if\s+|whether\s+|about\s+)?(.+)$/i);
  if (m) {
    const a = findAgent(m[1], agents, { fuzzy: true });
    if (a) return result(a, m[2], 'name');
  }

  // "Kai, fix the header" or "Kai fix the header" or "@kai ..."
  m = text.match(/^@?([a-z0-9-]+)([,:!.]?)\s*(.*)$/i);
  if (m) {
    const a = findAgent(m[1], agents, { fuzzy: !!m[2] });
    if (a) {
      if (!m[3]) return { ...result(a, '', 'name'), pickOnly: true };
      return result(a, m[3], 'name');
    }
  }

  // No name: whoever you are looking at or selected, else the boss.
  const focus = focusId && agents.find(a => a.id === focusId);
  if (focus) return result(focus, text, 'focus');
  return result(boss, text, 'boss');
}

// Speakable version of a chat line: first sentences, no markdown, not too long.
export function speakable(text, max = 280) {
  let s = String(text || '')
    .replace(/```[\s\S]*?```/g, ' (code) ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*|__|[*_#>]/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return end > 60 ? cut.slice(0, end + 1) : `${cut.replace(/\s+\S*$/, '')}…`;
}
