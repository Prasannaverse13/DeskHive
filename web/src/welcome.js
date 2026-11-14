// First run: how you connect and how you talk. Opens once, and from the ? button.

import { PROVIDERS } from '@shared/protocol.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const KEY = 'deskhive.welcomed.v2';

export function initWelcome({ hive, voice, openConnections, onClose = null }) {
  const root = document.createElement('div');
  root.className = 'welcome hidden';
  root.innerHTML = `
    <div class="wl-card" role="dialog" aria-label="Welcome to DeskHive">
      <header><b>Welcome to DeskHive</b><span class="wl-steps" id="wl-steps"></span><button class="x" id="wl-x" aria-label="Close">✕</button></header>
      <section id="wl-body"></section>
      <footer><button id="wl-back">Back</button><span class="grow"></span><button id="wl-next" class="pri">Next</button></footer>
    </div>`;
  document.body.appendChild(root);
  const $ = id => root.querySelector('#' + id);
  let step = 0;
  let heard = '';
  let testing = false;

  const steps = [
    () => `
      <h2>Your AI team lives in this office</h2>
      <div class="wl-grid">
        <div><i>🗣</i><b>Talk to anyone</b><p>Say a name first: <q>Kai, fix the header</q>. Or select an agent, or in the headset just look at them and talk.</p></div>
        <div><i>✋</i><b>Hands up = needs you</b><p>When an agent hits something risky it raises its hand with a red ring. Say <q>yes</q> or <q>no</q>.</p></div>
        <div><i>🃏</i><b>Hand out work</b><p>Pinch a task card on the inbox table and drop it on a desk. Or tell Nova and she routes it.</p></div>
        <div><i>🧠</i><b>Any brain</b><p>Each agent can run on Claude Code, Codex, Claude, GPT, Grok, Gemini or a local model.</p></div>
      </div>`,
    () => {
      const ready = PROVIDERS.filter(p => p.id !== 'demo' && hive.providerReady(p.id));
      const live = hive.isLive;
      const metaReady = hive.providerReady('meta');
      const ol = hive.providers.find(x => x.id === 'ollama') || {};
      const ollamaUp = !!ol.ready;
      const llama = ol.llama || null;
      return `
      <h2>1. Connect a brain</h2>
      ${live ? '' : '<p class="note">This is the hosted demo. Run <code>npm start</code> on your laptop and open <code>localhost:8080</code> to use real brains.</p>'}
      <div class="wl-meta llama ${llama ? 'ok' : ''}">
        <i>🦙</i>
        <div><b>Llama on your laptop</b> <span class="tag free">free default</span>
          <p>Meta's open Llama model running on your own computer with Ollama. No key, no bill, works offline.</p>
          ${llama ? `<p class="ok">✓ ${esc(llama)} is ready. Agents on the demo brain move to it by themselves.</p>`
            : ollamaUp ? '<p>Ollama is running. Now pull a model in a terminal: <code>ollama pull llama3.2:3b</code></p>'
            : `<ol class="wl-mini">
                <li>Install Ollama from <code>ollama.com</code></li>
                <li>In a terminal: <code>ollama pull llama3.2:3b</code> <span class="dim">(2 GB, any laptop)</span> or <code>ollama pull llama3.1:8b</code> <span class="dim">(5 GB, 8 GB RAM, smarter)</span></li>
                <li>Leave Ollama running. DeskHive finds it within 20 seconds.</li>
              </ol>`}
        </div>
      </div>
      <div class="wl-meta ${metaReady ? 'ok' : ''}">
        <i>∞</i>
        <div><b>Meta Muse Spark</b> <span class="tag">if you have a key</span>
          <p>Meta's hosted agent model. Paid per use. With a key set in Connections it takes over from Llama.</p>
          ${metaReady ? '<p class="ok">✓ Connected. Your team runs on Muse Spark.</p>' : '<p class="dim">Key from <code>dev.meta.ai</code>. Skip this if you want everything free.</p>'}
        </div>
      </div>
      <p>Found on this laptop:</p>
      <div class="wl-brains">
        ${ready.length ? ready.map(p => `<div class="wl-brain"><i style="background:${p.color}">${p.badge}</i><b>${esc(p.label)}</b><span class="ok">ready</span><button data-team="${p.id}">Use for the whole team</button></div>`).join('') : '<p class="dim">No real brain yet. The team runs on the demo brain.</p>'}
      </div>
      <p class="dim">Claude Code and Codex use your own plan: install the CLI and sign in once. API brains need a key.</p>
      <button id="wl-conn" ${live ? '' : 'disabled'}>🔌 Open Connections</button>`;
    },
    () => `
      <h2>2. Your voice</h2>
      <p>Speech engine: <b>${esc(voice.engineLabel)}</b></p>
      ${voice.canListen ? '' : `<p class="note">${esc(voice.serverHint || 'No speech engine here.')} You can still type.</p>`}
      <p class="dim">In the headset the laptop does the listening, so it works on Quest too. Free local Whisper downloads a small model the first time.</p>
      <div class="wl-mic">
        <button id="wl-test" class="pri" ${voice.canListen ? '' : 'disabled'}>${testing ? '● Listening… say something' : '🎤 Test my mic'}</button>
        <span id="wl-heard">${heard ? `I heard: <b>“${esc(heard)}”</b>` : 'Try: <q>Kai, what are you working on?</q>'}</span>
      </div>
      <ul class="wl-tips">
        <li><b>Laptop:</b> hold <kbd>Space</kbd> or press 🎤 to talk. 👂 turns on hands-free.</li>
        <li><b>Headset:</b> hands-free turns on when you enter. Say a name first, or look at an agent.</li>
        <li><b>Agents talk back</b> in their own voice. ${hive.voice?.tts ? 'Using OpenAI voices.' : 'Add an OpenAI key for natural voices.'}</li>
      </ul>`,
    () => {
      const links = hive.info?.headset || [];
      return `
      <h2>3. Put on your headset</h2>
      <ol class="wl-steps-list">
        <li>Keep this laptop running <code>npm start</code>. Headset and laptop on the same Wi-Fi.</li>
        <li>In the Quest browser open:<div class="wl-links">${links.length ? links.map(l => `<code>${esc(l)}</code>`).join('') : '<code>https://&lt;your laptop IP&gt;:8443</code>'}</div></li>
        <li>Accept the certificate warning once (Advanced, then Proceed).</li>
        <li>Allow the microphone, then press <b>Enter VR</b> or <b>Enter passthrough</b>.</li>
      </ol>
      <p class="dim">No headset? Add <code>?emu</code> to the URL for the built in emulator.</p>`;
    },
  ];

  function render() {
    $('wl-body').innerHTML = steps[step]();
    $('wl-steps').innerHTML = steps.map((_, i) => `<i class="${i === step ? 'on' : ''}"></i>`).join('');
    $('wl-back').style.visibility = step ? 'visible' : 'hidden';
    $('wl-next').textContent = step === steps.length - 1 ? 'Start' : 'Next';
    root.querySelectorAll('[data-team]').forEach(b => {
      b.onclick = () => {
        for (const a of hive.agents.values()) hive.updateAgent(a.id, { provider: b.dataset.team, model: '' });
        b.textContent = '✓ Done';
        b.disabled = true;
      };
    });
    const conn = root.querySelector('#wl-conn');
    if (conn) conn.onclick = () => { close(); openConnections(); };
    const test = root.querySelector('#wl-test');
    if (test) test.onclick = async () => {
      testing = true; heard = ''; render();
      const ok = await voice.start({ test: true });
      if (!ok) { testing = false; heard = ''; render(); root.querySelector('#wl-heard').innerHTML = `<span class="err">${esc(voice.err || 'Mic not available')}</span>`; }
    };
  }

  function open(at = 0) { step = at; root.classList.remove('hidden'); render(); }
  function close() {
    const wasOpen = !root.classList.contains('hidden');
    root.classList.add('hidden');
    if (wasOpen) onClose?.();
    try { localStorage.setItem(KEY, '1'); } catch { /* */ }
  }
  $('wl-x').onclick = close;
  $('wl-back').onclick = () => { step = Math.max(0, step - 1); render(); };
  $('wl-next').onclick = () => { if (step >= steps.length - 1) close(); else { step += 1; render(); } };
  root.addEventListener('pointerdown', e => { if (e.target === root) close(); });

  let seen = false;
  try { seen = !!localStorage.getItem(KEY); } catch { /* */ }

  return {
    open,
    close,
    get isOpen() { return !root.classList.contains('hidden'); },
    maybeOpen() { if (!seen && !new URLSearchParams(location.search).has('emu')) open(0); },
    heard(text) { testing = false; heard = text; if (step === 2) render(); },
    voiceState(st) { if (testing && st.state === 'idle') { testing = false; if (step === 2) render(); } },
    refresh() { if (!root.classList.contains('hidden')) render(); },
  };
}
