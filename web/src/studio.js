// Character Studio: design an agent's look, mind and brain, with a live 3D preview.
// Connections: plug in Claude, Codex, Grok, OpenAI, Gemini, OpenRouter, Ollama or any endpoint.

import * as THREE from 'three';
import { buildBody, animate } from './scene/avatar.js';
import { box } from './scene/office.js';
import {
  PROVIDERS, providerById, AUTONOMY, LOOK_OPTIONS, SKIN_SWATCHES, HAIR_SWATCHES, SHIRT_SWATCHES,
  TEMPLATES, defaultLook, randomLook, MAX_WORKERS, VOICES,
} from '@shared/protocol.js';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NAMES = ['Atlas', 'Juno', 'Orion', 'Vega', 'Iris', 'Sol', 'Rune', 'Lumen', 'Nyx', 'Kite', 'Onyx', 'Sage', 'Wren', 'Zephyr', 'Halo', 'Cleo'];

const ICON = {
  species: { human: '🧑', robot: '🤖', cat: '🐱' },
  accessory: { none: '∅', glasses: '👓', shades: '🕶', headphones: '🎧', cap: '🧢', crown: '👑', antenna: '📡', halo: '😇' },
  outfit: { tee: 'Tee', hoodie: 'Hoodie', suit: 'Suit', labcoat: 'Lab coat' },
  hairStyle: { short: 'Short', long: 'Long', bun: 'Bun', spiky: 'Spiky', mohawk: 'Mohawk', bald: 'Bald' },
  aura: { none: 'None', glow: 'Glow', sparkle: 'Sparkle' },
};

export function initStudio({ hive, onClose, speak }) {
  const root = document.createElement('div');
  root.className = 'studio hidden';
  root.innerHTML = `
    <div class="st-card" role="dialog" aria-label="Character Studio">
      <header class="st-head">
        <nav class="st-tabs">
          <button data-tab="character" class="on">Character</button>
          <button data-tab="connections">Connections</button>
        </nav>
        <span class="st-title" id="st-title"></span>
        <button class="x" id="st-close" aria-label="Close">✕</button>
      </header>
      <section class="st-body" data-pane="character">
        <div class="st-left">
          <div class="st-preview" id="st-preview"></div>
          <div class="row center">
            <button id="st-random">🎲 Randomize</button>
            <button id="st-pose">👋 Pose</button>
          </div>
          <div class="st-templates" id="st-templates"></div>
        </div>
        <div class="st-right">
          <div class="st-grid2">
            <label>Name<input id="f-name" maxlength="24" /></label>
            <label>Role<input id="f-role" maxlength="80" placeholder="Frontend engineer" /></label>
          </div>
          <label>Instructions <small>how this agent thinks and works. It reads this before every task.</small>
            <textarea id="f-instr" rows="5" maxlength="4000" placeholder="You build clean, accessible UI. Always run the tests before you finish."></textarea>
          </label>
          <label>Skills <small>comma separated. Nova routes work by these.</small><input id="f-skills" placeholder="ui, react, css" /></label>
          <div class="st-section">Brain</div>
          <div class="st-brains" id="f-brains"></div>
          <div class="st-grid2">
            <label>Model<input id="f-model" list="f-models" placeholder="default" /><datalist id="f-models"></datalist></label>
            <div class="st-test"><button id="f-test">Test brain</button><span id="f-test-out"></span></div>
          </div>
          <div class="st-section">Voice</div>
          <div class="row voicepick"><div class="seg wrap" id="f-voice"></div><button type="button" id="f-hear">▶ Hear</button></div>
          <div class="st-section">Autonomy</div>
          <div class="seg" id="f-auto"></div>
          <p class="hintline" id="f-auto-hint"></p>
          <div class="st-section">Look</div>
          <div class="st-look">
            <div class="lk"><span>Species</span><div class="seg" id="l-species"></div></div>
            <div class="lk"><span id="l-skin-label">Skin</span><div class="sw" id="l-skin"></div></div>
            <div class="lk" id="l-hair-row"><span>Hair</span><div class="sw" id="l-hair"></div></div>
            <div class="lk" id="l-style-row"><span>Hair style</span><div class="seg wrap" id="l-hairStyle"></div></div>
            <div class="lk"><span>Shirt</span><div class="sw" id="l-shirt"></div></div>
            <div class="lk"><span>Outfit</span><div class="seg wrap" id="l-outfit"></div></div>
            <div class="lk"><span>Accessory</span><div class="seg wrap" id="l-accessory"></div></div>
            <div class="lk" id="l-eyes-row"><span>Eyes</span><div class="sw" id="l-eyes"></div></div>
            <div class="lk"><span>Aura</span><div class="seg" id="l-aura"></div></div>
          </div>
        </div>
      </section>
      <section class="st-body hidden" data-pane="connections">
        <div class="conn" id="conn"></div>
      </section>
      <footer class="st-foot">
        <button id="st-fire" class="danger">Fire</button>
        <span class="grow"></span>
        <span class="st-err" id="st-err"></span>
        <button id="st-cancel">Cancel</button>
        <button id="st-save" class="pri">Save</button>
      </footer>
    </div>`;
  document.body.appendChild(root);
  const $ = id => root.querySelector('#' + id);

  let mode = 'edit'; // 'edit' | 'hire'
  let editingId = null;
  let draft = null;
  let pose = 'idle';
  let tab = 'character';

  // ---------------------------------------------------------------- live preview
  const pv = $('st-preview');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  pv.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
  cam.position.set(0, 0.07, 0.28);
  cam.lookAt(0, 0.04, 0);
  scene.add(new THREE.HemisphereLight('#fff6e5', '#3a3f4b', 1.6));
  const key = new THREE.DirectionalLight('#ffffff', 1.8);
  key.position.set(0.3, 0.5, 0.4);
  key.castShadow = true;
  scene.add(key);
  const stage = new THREE.Group();
  scene.add(stage);
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.075, 0.006, 48), new THREE.MeshStandardMaterial({ color: '#2b3144', roughness: 0.6 }));
  disc.position.y = -0.003;
  disc.receiveShadow = true;
  stage.add(disc);
  const chair = new THREE.Group();
  chair.add(box(0.026, 0.004, 0.024, '#3d4452', 0, 0.012, 0));
  chair.add(box(0.026, 0.026, 0.004, '#3d4452', 0, 0.012, -0.014));
  chair.add(box(0.003, 0.012, 0.003, '#222', 0, 0, 0));
  stage.add(chair);
  let rig = null;
  let t = 0;
  let drag = null;
  let spin = 0.5;
  pv.addEventListener('pointerdown', e => { drag = { x: e.clientX, r: stage.rotation.y }; pv.setPointerCapture(e.pointerId); });
  pv.addEventListener('pointermove', e => { if (drag) { stage.rotation.y = drag.r + (e.clientX - drag.x) * 0.012; spin = 0; } });
  pv.addEventListener('pointerup', () => { drag = null; });

  function rebuildPreview() {
    if (rig) stage.remove(rig.root);
    rig = buildBody(draft.look, { boss: draft.isBoss });
    rig.root.position.z = 0.012;
    stage.add(rig.root);
  }

  function sizePreview() {
    const w = pv.clientWidth || 300;
    const h = pv.clientHeight || 320;
    renderer.setSize(w, h, false);
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
  }

  let raf = 0;
  const clock = new THREE.Clock();
  function loop() {
    raf = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    t += dt;
    stage.rotation.y += spin * dt;
    if (rig) animate(rig, pose, t, dt);
    renderer.render(scene, cam);
  }

  // ---------------------------------------------------------------- form helpers
  function seg(el, options, value, labels, onPick) {
    el.innerHTML = options.map(o => `<button type="button" data-v="${esc(o)}" class="${o === value ? 'on' : ''}">${esc(labels?.[o] ?? o)}</button>`).join('');
    el.onclick = e => { const v = e.target.closest('button')?.dataset.v; if (v != null) onPick(v); };
  }
  function swatches(el, colors, value, onPick) {
    el.innerHTML = colors.map(c => `<button type="button" data-v="${c}" class="${c.toLowerCase() === String(value).toLowerCase() ? 'on' : ''}" style="background:${c}" aria-label="${c}"></button>`).join('')
      + `<label class="custom" title="Custom color"><input type="color" value="${/^#[0-9a-f]{6}$/i.test(value) ? value : '#888888'}" /></label>`;
    el.onclick = e => { const v = e.target.closest('button')?.dataset.v; if (v) onPick(v); };
    el.querySelector('input').oninput = e => onPick(e.target.value);
  }
  function setLook(k, v) { draft.look = { ...draft.look, [k]: v }; renderLook(); rebuildPreview(); }

  function renderLook() {
    const L = draft.look;
    seg($('l-species'), LOOK_OPTIONS.species, L.species, ICON.species, v => {
      const next = { species: v };
      if (v === 'robot' && !['#b8c4d6', '#9ad1ff', '#e5e5e5'].includes(L.skin)) Object.assign(next, { skin: '#b8c4d6', eyes: '#5ce1e6' });
      if (v === 'cat' && SKIN_SWATCHES.slice(0, 7).includes(L.skin)) next.skin = '#f2b134';
      if (v === 'human' && !SKIN_SWATCHES.slice(0, 7).includes(L.skin)) Object.assign(next, { skin: '#e0ac69', eyes: '#111111' });
      draft.look = { ...L, ...next }; renderLook(); rebuildPreview();
    });
    $('l-skin-label').textContent = L.species === 'robot' ? 'Metal' : L.species === 'cat' ? 'Fur' : 'Skin';
    const skinSet = L.species === 'robot' ? ['#b8c4d6', '#9ad1ff', '#e5e5e5', '#7a7f8a', '#ffd166', '#2b2d42'] : L.species === 'cat' ? ['#f2b134', '#3b2f2f', '#e8e8e8', '#ff7f11', '#7a7f8a', '#111111'] : SKIN_SWATCHES.slice(0, 7);
    swatches($('l-skin'), skinSet, L.skin, v => setLook('skin', v));
    $('l-hair-row').classList.toggle('hidden', L.species !== 'human');
    $('l-style-row').classList.toggle('hidden', L.species !== 'human');
    swatches($('l-hair'), HAIR_SWATCHES, L.hair, v => setLook('hair', v));
    seg($('l-hairStyle'), LOOK_OPTIONS.hairStyle, L.hairStyle, ICON.hairStyle, v => setLook('hairStyle', v));
    swatches($('l-shirt'), SHIRT_SWATCHES, L.shirt, v => setLook('shirt', v));
    seg($('l-outfit'), LOOK_OPTIONS.outfit, L.outfit, ICON.outfit, v => setLook('outfit', v));
    seg($('l-accessory'), LOOK_OPTIONS.accessory, L.accessory, ICON.accessory, v => setLook('accessory', v));
    swatches($('l-eyes'), ['#111111', '#5ce1e6', '#06d6a0', '#ff3b3b', '#ffd166', '#7c5cff'], L.eyes, v => setLook('eyes', v));
    seg($('l-aura'), LOOK_OPTIONS.aura, L.aura, ICON.aura, v => setLook('aura', v));
  }

  function renderBrains() {
    const el = $('f-brains');
    el.innerHTML = PROVIDERS.map(p => {
      const st = hive.providers.find(x => x.id === p.id);
      const ready = st ? st.ready : p.id === 'demo';
      return `<button type="button" data-v="${p.id}" class="brain ${draft.provider === p.id ? 'on' : ''}" title="${esc(p.blurb)}">
        <i style="background:${p.color};color:${['#ffffff', '#e5e5e5'].includes(p.color) ? '#111' : '#fff'}">${p.badge}</i>
        <b>${esc(p.label)}</b><em class="${ready ? 'ok' : 'no'}">${ready ? 'ready' : 'set up'}</em></button>`;
    }).join('');
    el.onclick = e => {
      const v = e.target.closest('button')?.dataset.v;
      if (!v) return;
      const prev = providerById(draft.provider);
      draft.provider = v;
      if (!draft.model || prev.models.includes(draft.model) || prev.id === 'ollama') {
        const pulled = v === 'ollama' ? hive.providers.find(x => x.id === 'ollama')?.llama : null;
        draft.model = pulled || providerById(v).models.find(Boolean) || '';
      }
      $('f-model').value = draft.model;
      $('f-test-out').textContent = '';
      renderBrains();
    };
    const p = providerById(draft.provider);
    $('f-models').innerHTML = p.models.filter(Boolean).map(m => `<option value="${esc(m)}">`).join('');
    $('f-model').placeholder = p.kind === 'cli' ? 'CLI default' : p.models.find(Boolean) || 'model id';
    $('f-model').disabled = p.kind === 'demo';
  }

  function renderVoice() {
    seg($('f-voice'), VOICES.map(v => v.id), draft.voice, Object.fromEntries(VOICES.map(v => [v.id, v.label])), v => { draft.voice = v; renderVoice(); hear(); });
  }
  function hear() {
    readForm();
    speak?.({ id: '__preview', voice: draft.voice }, `Hi, I am ${draft.name || 'your new agent'}${draft.role ? `, your ${draft.role.toLowerCase()}` : ''}. Ready when you are.`);
  }
  $('f-hear').onclick = hear;

  function renderAutonomy() {
    seg($('f-auto'), AUTONOMY.map(a => a.id), draft.autonomy, Object.fromEntries(AUTONOMY.map(a => [a.id, a.label])), v => { draft.autonomy = v; renderAutonomy(); });
    $('f-auto-hint').textContent = AUTONOMY.find(a => a.id === draft.autonomy)?.blurb || '';
  }

  function renderTemplates() {
    const el = $('st-templates');
    el.classList.toggle('hidden', mode !== 'hire');
    el.innerHTML = `<div class="st-section">Start from a template</div>` + TEMPLATES.map(tp => `<button type="button" data-k="${tp.key}">${esc(tp.role)}</button>`).join('');
    el.onclick = e => {
      const k = e.target.closest('button')?.dataset.k;
      const tp = TEMPLATES.find(x => x.key === k);
      if (!tp) return;
      Object.assign(draft, {
        name: tp.name, role: tp.role, instructions: tp.instructions, skills: tp.skills,
        look: defaultLook({ ...randomLook(), ...tp.look }),
        provider: tp.provider && hive.providerReady(tp.provider) ? tp.provider : draft.provider,
      });
      fillForm();
    };
  }

  function fillForm() {
    $('f-name').value = draft.name;
    $('f-role').value = draft.role;
    $('f-instr').value = draft.instructions;
    $('f-skills').value = (draft.skills || []).join(', ');
    $('f-model').value = draft.model || '';
    renderBrains();
    renderVoice();
    renderAutonomy();
    renderLook();
    rebuildPreview();
  }

  function readForm() {
    draft.name = $('f-name').value.trim() || draft.name;
    draft.role = $('f-role').value.trim();
    draft.instructions = $('f-instr').value.trim();
    draft.skills = $('f-skills').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    draft.model = $('f-model').value.trim();
  }

  $('f-test').onclick = () => {
    readForm();
    $('f-test-out').className = '';
    $('f-test-out').textContent = 'testing…';
    hive.testProvider(draft.provider, draft.model);
  };

  $('st-random').onclick = () => {
    draft.look = randomLook();
    if (mode === 'hire' && !$('f-name').value.trim()) $('f-name').value = NAMES[Math.floor(Math.random() * NAMES.length)];
    renderLook(); rebuildPreview();
  };
  $('st-pose').onclick = () => { pose = { idle: 'working', working: 'thinking', thinking: 'blocked', blocked: 'wave', wave: 'idle' }[pose] || 'idle'; $('st-pose').textContent = `👋 Pose: ${pose}`; };

  // ---------------------------------------------------------------- connections pane
  const keyDrafts = {};
  function renderConnections() {
    const live = hive.isLive;
    $('conn').innerHTML = (live ? '' : `<p class="note">You are on the hosted demo. Connections need the local server: run <code>npm start</code> and open <code>localhost:8080</code>. Every agent runs the demo brain here.</p>`)
      + `<p class="note small">Keys are saved on your machine in <code>deskhive.config.json</code>. They are never sent back to the browser.</p>`
      + PROVIDERS.filter(p => p.id !== 'demo').map(p => {
        const st = hive.providers.find(x => x.id === p.id) || {};
        const res = hive.testResults.get(p.id);
        const needsBase = p.id === 'custom' || p.id === 'ollama';
        return `<div class="conn-row" data-p="${p.id}">
          <i class="badge" style="background:${p.color};color:${['#ffffff', '#e5e5e5'].includes(p.color) ? '#111' : '#fff'}">${p.badge}</i>
          <div class="conn-main">
            <div class="conn-top"><b>${esc(p.label)}</b><span class="dot ${st.ready ? 'ok' : 'no'}"></span><span class="reason">${esc(st.reason || (live ? '' : 'needs local server'))}</span></div>
            <p>${esc(p.blurb)}</p>
            ${p.kind === 'cli' ? `<p class="small">Install: <code>${p.id === 'claude-cli' ? 'npm i -g @anthropic-ai/claude-code' : 'npm i -g @openai/codex'}</code> then sign in once in a terminal.</p>` : ''}
            <div class="conn-inputs">
              ${p.keyName ? `<input type="password" data-key="${p.id}" placeholder="${st.keySet ? '•••••••• saved (type to replace)' : p.keyName}" value="${esc(keyDrafts[p.id] || '')}" ${live ? '' : 'disabled'} autocomplete="off" />` : ''}
              ${needsBase ? `<input data-base="${p.id}" placeholder="${p.id === 'ollama' ? 'http://localhost:11434/v1' : 'https://api.example.com/v1'}" value="${esc(st.baseUrl || '')}" ${live ? '' : 'disabled'} />` : ''}
              ${p.kind === 'api' ? `<button data-save="${p.id}" ${live ? '' : 'disabled'}>Save</button>` : ''}
              <button data-test="${p.id}">Test</button>
              ${p.keyName && st.keySet ? `<button data-clear="${p.id}" class="ghost" ${live ? '' : 'disabled'}>Remove key</button>` : ''}
            </div>
            ${res ? `<p class="res ${res.ok ? 'ok' : 'no'}">${res.ok ? '✓' : '✗'} ${esc(res.text)}</p>` : ''}
          </div>
        </div>`;
      }).join('');
  }
  $('conn').addEventListener('input', e => { const k = e.target.dataset.key; if (k) keyDrafts[k] = e.target.value; });
  $('conn').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const row = b.closest('.conn-row');
    const id = b.dataset.save || b.dataset.test || b.dataset.clear;
    if (b.dataset.save) {
      const keyIn = row.querySelector('[data-key]');
      const baseIn = row.querySelector('[data-base]');
      const keys = keyIn && keyIn.value.trim() ? { [id]: keyIn.value.trim() } : {};
      const baseUrls = baseIn ? { [id]: baseIn.value.trim() } : {};
      hive.setKeys(keys, baseUrls);
      delete keyDrafts[id];
      setTimeout(() => hive.testProvider(id), 300);
    } else if (b.dataset.clear) {
      hive.setKeys({ [id]: null });
    } else if (b.dataset.test) {
      hive.testProvider(id);
      b.textContent = 'Testing…';
    }
  });

  // ---------------------------------------------------------------- open / save
  function switchTab(next) {
    tab = next;
    root.querySelectorAll('.st-tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    root.querySelectorAll('[data-pane]').forEach(p => p.classList.toggle('hidden', p.dataset.pane !== tab));
    root.querySelector('.st-foot').classList.toggle('hidden', tab !== 'character');
    if (tab === 'connections') renderConnections();
  }
  root.querySelector('.st-tabs').onclick = e => { const tb = e.target.closest('button')?.dataset.tab; if (tb) switchTab(tb); };

  function show() {
    root.classList.remove('hidden');
    sizePreview();
    cancelAnimationFrame(raf);
    clock.getDelta();
    loop();
  }

  function close() {
    root.classList.add('hidden');
    cancelAnimationFrame(raf);
    onClose?.();
  }

  function openEdit(id) {
    const a = hive.agents.get(id);
    if (!a) return;
    mode = 'edit'; editingId = id;
    draft = JSON.parse(JSON.stringify({ name: a.name, role: a.role, instructions: a.instructions || '', skills: a.skills || [], provider: a.provider || 'demo', model: a.model || '', autonomy: a.autonomy || 'balanced', voice: a.voice || 'alloy', look: defaultLook(a.look), isBoss: a.isBoss }));
    $('st-title').textContent = `Editing ${a.name}${a.isBoss ? ' (boss)' : ''}`;
    $('st-save').textContent = 'Save';
    $('st-fire').classList.toggle('hidden', !!a.isBoss);
    $('st-err').textContent = '';
    pose = 'idle'; $('st-pose').textContent = '👋 Pose';
    renderTemplates(); fillForm(); switchTab('character'); show();
  }

  function openHire(seat = null) {
    const workers = [...hive.agents.values()].filter(a => !a.isBoss).length;
    mode = 'hire'; editingId = null;
    const tp = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
    draft = { name: NAMES[Math.floor(Math.random() * NAMES.length)], role: tp.role, instructions: tp.instructions, skills: tp.skills, provider: 'demo', model: '', autonomy: 'balanced', voice: VOICES[1 + Math.floor(Math.random() * (VOICES.length - 1))].id, look: defaultLook({ ...randomLook(), ...tp.look }), seat };
    // Default to the best connected brain.
    const best = ['meta', 'claude-cli', 'codex-cli', 'anthropic', 'openai', 'xai', 'gemini', 'openrouter', 'ollama'].find(id => hive.providerReady(id));
    if (best) { draft.provider = best; draft.model = ''; }
    $('st-title').textContent = workers >= MAX_WORKERS ? `The floor is full (${MAX_WORKERS} desks)` : 'Hire a new agent';
    $('st-save').textContent = 'Hire';
    $('st-save').disabled = workers >= MAX_WORKERS;
    $('st-fire').classList.add('hidden');
    $('st-err').textContent = '';
    pose = 'wave'; $('st-pose').textContent = '👋 Pose: wave';
    renderTemplates(); fillForm(); switchTab('character'); show();
  }

  function openConnections() {
    if (!draft) { draft = { name: '', role: '', instructions: '', skills: [], provider: 'demo', model: '', autonomy: 'balanced', voice: 'alloy', look: defaultLook() }; fillForm(); }
    show();
    switchTab('connections');
  }

  $('st-save').onclick = () => {
    readForm();
    if (!draft.name) { $('st-err').textContent = 'Give them a name.'; return; }
    const p = providerById(draft.provider);
    if (p.kind === 'api' && !draft.model && !p.models.find(Boolean)) { $('st-err').textContent = 'This brain needs a model name.'; return; }
    const payload = { name: draft.name, role: draft.role, instructions: draft.instructions, skills: draft.skills, provider: draft.provider, model: draft.model, autonomy: draft.autonomy, voice: draft.voice, look: draft.look };
    if (mode === 'hire') hive.hire({ ...payload, seat: draft.seat });
    else hive.updateAgent(editingId, payload);
    close();
  };
  $('st-fire').onclick = () => {
    const a = hive.agents.get(editingId);
    if (!a) return;
    if (!confirm(`Fire ${a.name}? Their open tasks go back on the tray.`)) return;
    hive.fire(editingId);
    close();
  };
  $('st-cancel').onclick = close;
  $('st-close').onclick = close;
  root.addEventListener('pointerdown', e => { if (e.target === root) close(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !root.classList.contains('hidden')) close(); });
  addEventListener('resize', () => { if (!root.classList.contains('hidden')) sizePreview(); });

  // Live updates while open.
  hive.on(evt => {
    if (root.classList.contains('hidden')) return;
    if (evt.type === 'providers' || evt.type === 'test_result' || evt.type === 'snapshot') {
      if (tab === 'connections') renderConnections();
      else renderBrains();
      if (evt.type === 'test_result' && draft && evt.provider === draft.provider) {
        const out = $('f-test-out');
        out.className = evt.ok ? 'ok' : 'no';
        out.textContent = `${evt.ok ? '✓' : '✗'} ${evt.text}`;
      }
    }
  });

  return { openEdit, openHire, openConnections, close, get open() { return !root.classList.contains('hidden'); } };
}
