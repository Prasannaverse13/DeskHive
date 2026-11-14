// Desktop HTML overlay. Mouse and keyboard fallback, and the buttons to enter VR.
// Hidden while inside a headset.

import { statusColor } from './scene/office.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function initOverlay({ hive, onEnterVR, onEnterAR, onSelectAgent, onTalk, onTalkStop, onHandsFree }) {
  const root = document.getElementById('ui');
  root.innerHTML = `
    <header class="bar">
      <div class="brand"><span class="logo"></span><b>DeskHive</b><span class="tag" id="mode">connecting</span><span class="tag lvl hidden" id="lvl" title="Office level. Ship work to unlock more of your HQ."></span></div>
      <div class="bar-right">
        <button id="btn-help" class="pill" title="How to connect and talk">?</button>
        <button id="btn-access" class="pill" title="High contrast and look to select">♿</button>
        <button id="btn-conn" class="pill" title="Connect Claude, Codex, Grok, OpenAI, Gemini and more">🔌 Connections</button>
        <button id="btn-ar" class="pill" title="Quest 3 or VR glasses with passthrough">Enter passthrough</button>
        <button id="btn-vr" class="pill pri">Enter VR</button>
      </div>
    </header>
    <aside class="side" id="side">
      <section class="card">
        <h3>Crew <button id="btn-hire" class="mini">+ Hire</button></h3>
        <div id="crew" class="crew"></div>
      </section>
      <section class="card grow">
        <h3 id="chat-title">Chat with Nova</h3>
        <div id="chat" class="chat"></div>
        <div class="vbar" id="vbar">
          <span class="vdot" id="vdot"></span><span class="vlevel" id="vlevel"><i></i><i></i><i></i><i></i><i></i></span>
          <span class="vcap" id="vcap">Press 🎤 or hold <kbd>Space</kbd> to talk</span>
        </div>
        <form id="form" class="row">
          <input id="input" autocomplete="off" placeholder="Tell Nova what to ship…" />
          <button type="button" id="mic" class="icon" title="Talk (or hold Space)">🎤</button>
          <button type="button" id="hands" class="icon" title="Hands-free: always listening">👂</button>
          <button class="icon pri" title="Send">➤</button>
        </form>
        <div class="chips" id="chips">
          <button data-q="Build a dark mode toggle in the UI, add a settings API endpoint, then test it">Ship dark mode</button>
          <button data-q="Research three competitors and write a launch post">Launch post</button>
          <button data-q="Run the tests then deploy to production">Deploy</button>
          <button data-q="status">Status</button>
        </div>
      </section>
    </aside>
    <section class="detail hidden" id="detail"></section>
    <div class="toast hidden" id="toast"></div>
    <div class="hint" id="hint">Hold <b>Space</b> to talk · say a name first · click an agent · drag a task card onto a desk · <b>?emu</b> for the headset emulator</div>
  `;
  const $ = id => root.querySelector('#' + id);
  const crewEl = $('crew'); const chatEl = $('chat'); const detail = $('detail');
  const input = $('input'); const toastEl = $('toast');
  let selected = null;
  let inXR = false;
  let handlers = {};
  $('btn-conn').onclick = () => handlers.onConnections?.();
  $('btn-access').onclick = () => handlers.onAccess?.();
  $('btn-help').onclick = () => handlers.onHelp?.();
  $('btn-hire').onclick = () => handlers.onHire?.();

  $('btn-vr').onclick = onEnterVR;
  $('btn-ar').onclick = onEnterAR;
  let vs = { state: 'off' };
  let voiceCtl = null;
  $('mic').onclick = () => onTalk(selected && selected !== 'nova' ? selected : null);
  $('hands').onclick = () => onHandsFree(!vs.handsFree);
  // Hold Space to talk, release to send (when you are not typing).
  let spaceDown = false;
  addEventListener('keydown', e => {
    if (e.code !== 'Space' || e.repeat || spaceDown || inXR) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (document.querySelector('.studio:not(.hidden)') || document.querySelector('.welcome:not(.hidden)')) return;
    e.preventDefault();
    spaceDown = true;
    onTalk(selected && selected !== 'nova' ? selected : null);
  });
  addEventListener('keyup', e => {
    if (e.code !== 'Space' || !spaceDown) return;
    spaceDown = false;
    setTimeout(() => onTalkStop?.(), 250);
  });
  $('form').onsubmit = e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    hive.say(text, selected && selected !== 'nova' ? selected : null);
    input.value = '';
  };
  $('chips').onclick = e => {
    const q = e.target.dataset?.q;
    if (q) hive.say(q === 'status' ? 'status' : q);
  };

  function renderCrew() {
    crewEl.innerHTML = [...hive.agents.values()].map(a => `
      <button class="agent ${selected === a.id ? 'sel' : ''}" data-id="${a.id}">
        <span class="dot" style="background:${statusColor(a.status)}"></span>
        <span class="nm">${esc(a.name)}${a.isBoss ? ' ★' : ''}</span>
        <span class="act">${esc(a.status === 'blocked' ? 'needs you' : (a.activity || a.status))}</span>
        ${a.inbox ? `<span class="mail">✉${a.inbox}</span>` : ''}
      </button>`).join('');
  }
  crewEl.onclick = e => {
    const b = e.target.closest('.agent');
    if (b) onSelectAgent(selected === b.dataset.id ? null : b.dataset.id);
  };

  function renderChat() {
    chatEl.innerHTML = hive.chat.slice(-30).map(l => {
      const you = l.from === 'you';
      const name = you ? 'You' : (hive.agents.get(l.from)?.name || l.from);
      return `<div class="msg ${you ? 'you' : ''}"><b>${esc(name)}</b> ${esc(l.text).replace(/\n/g, '<br>')}</div>`;
    }).join('');
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function renderDetail() {
    const a = selected && hive.agents.get(selected);
    detail.classList.toggle('hidden', !a);
    if (!a) return;
    const lines = (hive.terms.get(a.id) || []).slice(-40);
    detail.innerHTML = `
      <div class="d-head"><span class="dot" style="background:${statusColor(a.status)}"></span><b>${esc(a.name)}</b><span class="st">${esc(a.status)}</span><button class="x" id="d-close">✕</button></div>
      <p class="role">${esc(a.role)} · <span class="brainchip">${esc(a.provider || 'demo')}${a.model ? ' / ' + esc(a.model) : ''}</span></p>
      <div class="prog"><i style="width:${Math.round((a.progress || 0) * 100)}%;background:${statusColor(a.status)}"></i></div>
      <p class="actline">${esc(a.activity || '')}</p>
      ${a.status === 'blocked' ? `<div class="ask"><p>${esc(a.question || '')}</p><div class="row"><button class="pri" data-a="yes">Yes</button><button data-a="no">No</button></div></div>` : ''}
      <pre class="term">${esc(lines.join('\n')) || 'quiet…'}</pre>
      <div class="row"><button data-a="status">Status</button><button data-a="stop">Stop</button><button data-a="edit" class="pri">✎ Design</button></div>
      <details><summary>Memory</summary><ul>${(a.memory || []).map(m => `<li>${esc(m)}</li>`).join('') || '<li>nothing yet</li>'}</ul></details>`;
    const term = detail.querySelector('.term');
    term.scrollTop = term.scrollHeight;
    detail.querySelector('#d-close').onclick = () => onSelectAgent(null);
    detail.onclick = e => {
      const act = e.target.dataset?.a;
      if (act === 'yes') hive.answer(a.id, 'yes');
      if (act === 'no') hive.answer(a.id, 'no');
      if (act === 'status') hive.status(a.id);
      if (act === 'stop') hive.stop(a.id);
      if (act === 'edit') handlers.onEdit?.(a.id);
    };
  }

  function renderTarget() {
    const a = selected && selected !== 'nova' && hive.agents.get(selected);
    $('chat-title').textContent = a ? `Message ${a.name} directly` : 'Chat with Nova';
    input.placeholder = a ? `Order ${a.name} directly (skips Nova)…` : 'Tell Nova what to ship…';
    $('chips').classList.toggle('hidden', !!a);
  }

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; renderCrew(); renderChat(); renderDetail(); renderTarget(); renderVoice(); $('mode').textContent = hive.mode; });
  }

  function renderVoice() {
    const st = vs.state;
    const live = st === 'listening' || st === 'hearing';
    $('mic').classList.toggle('rec', live && !vs.handsFree);
    $('hands').classList.toggle('on', !!vs.handsFree);
    $('vdot').className = `vdot ${st === 'hearing' ? 'hot' : (live || vs.handsFree) ? 'on' : ''}`;
    const bars = $('vlevel').children;
    for (let i = 0; i < bars.length; i++) bars[i].style.height = `${4 + Math.max(0, Math.min(1, (vs.level || 0) * 1.6 - i * 0.15)) * 14}px`;
    $('vlevel').style.visibility = live || vs.handsFree ? 'visible' : 'hidden';
    const who = selected && selected !== 'nova' ? hive.agents.get(selected)?.name : null;
    let cap;
    if (vs.error && !live) cap = `<span class="err">${esc(vs.error)}</span>`;
    else if (vs.interim) cap = `“${esc(vs.interim)}”`;
    else if (st === 'hearing') cap = 'Hearing you…';
    else if (st === 'transcribing' || vs.busy) cap = 'Writing it down…';
    else if (vs.handsFree) cap = `Listening. Start with a name like <b>Kai,</b> or just talk${who ? ` to <b>${esc(who)}</b>` : ' to Nova'}.`;
    else if (st === 'listening') cap = `Listening${who ? ` → <b>${esc(who)}</b>` : ''}… speak now`;
    else if (vs.speaking) cap = `${esc(hive.agents.get(voiceCtl?.speakingId)?.name || 'Agent')} is talking…`;
    else if (voiceCtl && !voiceCtl.canListen) cap = `<span class="dim">${esc(voiceCtl.serverHint || 'No speech engine. Type instead.')}</span>`;
    else cap = `Press 🎤 or hold <kbd>Space</kbd> to talk${who ? ` to <b>${esc(who)}</b>` : ''}. <span class="dim">${esc(voiceCtl?.engineLabel || '')}</span>`;
    $('vcap').innerHTML = cap;
  }

  return {
    setVoice(state, ctl) { vs = state; voiceCtl = ctl; renderVoice(); },
    update: schedule,
    selectAgent(id) { selected = id; schedule(); },
    focusInput() { input.focus(); },
    setHandlers(h) { handlers = h; },
    toast(text) {
      toastEl.textContent = text;
      toastEl.classList.remove('hidden');
      clearTimeout(toastEl._t);
      toastEl._t = setTimeout(() => toastEl.classList.add('hidden'), 3500);
    },
    setXR(v) { inXR = v; root.style.display = v ? 'none' : ''; },
    setProgress(p) {
      const el = $('lvl');
      if (!p) return;
      el.classList.remove('hidden');
      el.textContent = `LV ${p.level} · ${Math.min(p.todayDone, p.goal)}/${p.goal} today${p.streak > 1 ? ` · 🔥${p.streak}` : ''}`;
      el.title = p.next ? `${p.xp} XP. Next unlock at ${p.next.xp} XP: ${p.next.unlock}` : `${p.xp} XP. Top level.`;
    },
    get inXR() { return inXR; },
  };
}
