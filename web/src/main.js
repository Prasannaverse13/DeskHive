// DeskHive client: a tiny office of AI agents on your desk.
// Works on a laptop (mouse), in the emulator (?emu) and on Meta VR glasses or Quest (hands).

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { XRHandModelFactory } from 'three/examples/jsm/webxr/XRHandModelFactory.js';
import { XRControllerModelFactory } from 'three/examples/jsm/webxr/XRControllerModelFactory.js';
import { HiveClient } from './hive-client.js';
import { SEATS, statusColor, drawScreen, box } from './scene/office.js';
import { buildOffice, buildBuilding, buildCity, BASE_H, W as HQ_W, D as HQ_D } from './scene/building.js';
import { Avatar } from './scene/avatar.js';
import { Panel3D, wrap, rr, clickSound } from './scene/panel.js';
import { Perks } from './scene/perks.js';
import { CardTray } from './scene/cards.js';
import { Envelopes } from './scene/fx.js';
import { Voice } from './voice.js';
import { routeUtterance, findAgent } from '@shared/voiceRoute.js';
import { initOverlay } from './overlay.js';
import { initStudio } from './studio.js';
import { initWelcome } from './welcome.js';
import { TEMPLATES, randomLook, defaultLook, MAX_WORKERS, LEVELS } from '@shared/protocol.js';
import './style.css';

const params = new URLSearchParams(location.search);
if (params.has('emu')) {
  const { installEmulator } = await import('./emulator.js');
  installEmulator();
}

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFoveation(1); // fixed foveated rendering: cheaper edges, steady frame rate on Quest
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color('#a9d6f0');
scene.background = BG;
const FOG = new THREE.Fog('#cde6f4', 3.5, 11);
scene.fog = FOG;

const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 50);
camera.position.set(0, 1.42, 0.62);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.78, -0.48);
controls.enableDamping = true;
controls.minDistance = 0.25;
controls.maxDistance = 2.5;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

scene.add(new THREE.HemisphereLight('#ffffff', '#7d8f6a', 1.5));
const sun = new THREE.DirectionalLight('#fff4e0', 1.9);
const SUN_OFFSET = new THREE.Vector3(0.7, 1.6, 0.9);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -0.8, right: 0.8, top: 0.8, bottom: -0.8, near: 0.3, far: 4 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// ---------------------------------------------------------------- world (the diorama)
const world = new THREE.Group();
world.position.set(0, 0.8, -0.5);
scene.add(world);
// The HQ: a glass office building with the live floor on top, and a city around it.
const building = buildBuilding();
world.add(building);
const city = buildCity();
world.add(city);
const { root: office, desks } = buildOffice();
world.add(office);

// Move handle: pinch and drag to place the office anywhere.
const handle = new THREE.Group();
handle.position.set(0.52, 0, 0.33);
const knob = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.05, 4, 12), new THREE.MeshStandardMaterial({ color: '#f2b134', emissive: '#f2b134', emissiveIntensity: 0.15 }));
knob.rotation.z = Math.PI / 2;
knob.position.y = 0.014;
knob.userData.kind = 'handle';
handle.add(knob);
world.add(handle);

const hive = new HiveClient();
const avatars = new Map();
const cards = new CardTray(world);
const envelopes = new Envelopes(world);
const perks = new Perks(world, city);

// Accessibility: high contrast panels and look to select (dwell), saved per viewer.
const access = { hc: false, dwell: false };
try { Object.assign(access, JSON.parse(localStorage.getItem('deskhive.access') || '{}')); } catch { /* */ }
Panel3D.hc = access.hc;
document.body.classList.toggle('hc', access.hc);
function saveAccess() { try { localStorage.setItem('deskhive.access', JSON.stringify(access)); } catch { /* */ } }

// ---------------------------------------------------------------- first five minutes: a coach, not a manual
// Four short steps, spoken by Nova, with a bouncing arrow on the thing to touch. Done once, redo from Help.
const COACH_KEY = 'deskhive.coach.v1';
const coach = (() => {
  const worker = () => [...hive.agents.values()].find(a => !a.isBoss && a.status !== 'blocked') || null;
  const devops = () => [...hive.agents.values()].find(a => /deploy|devops|ship/i.test(`${a.role} ${(a.skills || []).join(' ')}`)) || null;
  const act = () => (inXR ? 'Pinch' : 'Drag');
  const tap = () => (inXR ? 'Poke' : 'Click');
  const steps = [
    { id: 'card', text: () => `${act()} a card from the inbox table onto a desk.` },
    { id: 'talk', text: () => voiceCtl.canListen ? `Talk. Say: ${worker()?.name || 'Kai'}, how is it going?` : `${tap()} ${worker()?.name || 'an agent'} to open their panel.` },
    { id: 'deploy', text: () => `${tap()} Deploy. ${devops()?.name || 'Ops'} will ask you first.` },
    { id: 'answer', text: () => [...hive.agents.values()].some(x => x.status === 'blocked') ? `A hand is up. ${tap()} ✓ Yes, or say yes.` : 'Watch for a raised hand. It means: I need you.' },
  ];
  let i = -1;
  let since = 0;
  let done = false;
  try { done = !!localStorage.getItem(COACH_KEY); } catch { /* */ }
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.014, 0.034, 16), new THREE.MeshBasicMaterial({ color: '#f2b134', toneMapped: false }));
  arrow.rotation.x = Math.PI; // points down
  arrow.visible = false;
  scene.add(arrow);
  const at = new THREE.Vector3();

  function say(text) {
    const nova = [...hive.agents.values()].find(a => a.isBoss);
    if (nova) voiceCtl.say(nova, text);
    showToast(text);
  }
  function go(n) {
    i = n;
    since = performance.now();
    if (i >= steps.length) {
      i = -1; done = true; arrow.visible = false;
      try { localStorage.setItem(COACH_KEY, '1'); } catch { /* */ }
      say('That is it. You run the office now. Ship three tasks a day to grow your HQ.');
      clickSound(1320, 0.12, 0.1);
    } else {
      if (n > 0) clickSound(1100, 0.08, 0.09);
      say(steps[i].text());
    }
    panelDirty = true;
  }
  return {
    get active() { return i >= 0; },
    start() { if (!done && i < 0) go(0); },
    restart() { done = false; go(0); },
    text() { return i >= 0 ? steps[i].text() : ''; },
    stepLabel() { return `${i + 1}/${steps.length}`; },
    event(kind, data = '') {
      if (i < 0) return;
      const id = steps[i].id;
      if (id === 'card' && kind === 'assign') go(1);
      else if (id === 'talk' && (kind === 'talk' || kind === 'select')) go(2);
      else if (id === 'deploy' && ((kind === 'quick' && data === 'q3') || (kind === 'you' && /deploy|ship/i.test(data)))) go(3);
      else if (id === 'deploy' && kind === 'blocked') go(3);
      else if (id === 'answer' && kind === 'answered') go(4);
    },
    tick(t) {
      if (i < 0) { arrow.visible = false; return; }
      const id = steps[i].id;
      let ok = false;
      if (id === 'card') { const m = cards.meshes()[0]; if (m) { m.getWorldPosition(at); at.y += 0.05; ok = true; } }
      else if (id === 'talk') { const w = worker(); const av = w && avatars.get(w.id); if (av) { av.group.getWorldPosition(at); at.y += 0.17; ok = true; } }
      else if (id === 'deploy') { if (consolePanel.buttonWorld('q3', at)) { at.y += 0.04; ok = true; } }
      else if (id === 'answer') {
        const b = [...hive.agents.values()].find(a => a.status === 'blocked');
        if (b && agentPanel.mesh.visible && selectedId === b.id && agentPanel.buttonWorld('yes', at)) { at.y += 0.04; ok = true; }
        else if (b && avatars.get(b.id)) { avatars.get(b.id).group.getWorldPosition(at); at.y += 0.17; ok = true; }
        // Nobody asked after a while (a real brain may not need to): finish anyway.
        if (!b && performance.now() - since > 45000) go(4);
      }
      arrow.visible = ok;
      if (ok) { arrow.position.copy(at); arrow.position.y += Math.sin(t * 5) * 0.008; arrow.rotation.y = t * 2; }
    },
  };
})();

let selectedId = null;
// Voice state for the panels: { state, level, handsFree, speaking, error, interim }
let vstate = { state: 'off', level: 0 };
let talkTarget = null; // agent the current push to talk goes to (null = whoever you name or look at)
let lastHeard = null; // { text, to, at } what you said last, shown as a caption
let gazeId = null; // agent you are looking at in the headset
let toast = { text: '', until: 0 };
let inXR = false;
let showBuilding = true;

function seatOf(agentId) {
  const a = hive.agents.get(agentId);
  return a ? SEATS[a.seat] : null;
}
function seatPos(agentId, y = 0.05) {
  if (agentId === 'human') return new THREE.Vector3(0, 0.08, 0.36);
  const s = seatOf(agentId);
  return s ? new THREE.Vector3(s.x, y, s.z - 0.03) : null;
}

// ---------------------------------------------------------------- console panel (front edge)
const consolePanel = new Panel3D({ width: 0.56, height: 0.205, ppm: 2000, name: 'console', onPress: onConsolePress });
// Floats in front of the HQ like a reception hologram, close to your hands.
consolePanel.mesh.position.set(0, 0.0, 0.43);
consolePanel.mesh.rotation.x = -0.85;
consolePanel.mesh.userData.kind = 'panel';
world.add(consolePanel.mesh);

const QUICK = [
  ['q1', 'Ship dark mode', 'Build a dark mode toggle in the UI, add a settings API endpoint, then test it'],
  ['q2', 'Launch post', 'Research three competitors and write a launch post'],
  ['q3', 'Deploy', 'Run the tests then deploy to production'],
];

function talkLabel() {
  const st = vstate.state;
  const to = focusTarget();
  const name = to ? hive.agents.get(to)?.name : 'Nova';
  if (st === 'hearing') return '● Hearing you…';
  if (st === 'transcribing' || vstate.busy) return '… Writing it down';
  if (st === 'listening' && !vstate.handsFree) return `● Listening → ${name}`;
  return `🎤  Talk to ${name}`;
}

function drawCaption(ctx, x, y, maxW) {
  // Mic level, then what we heard or what is happening.
  const st = vstate.state;
  const on = vstate.handsFree || st === 'listening' || st === 'hearing' || st === 'transcribing' || vstate.busy;
  if (on) {
    ctx.fillStyle = st === 'hearing' ? '#ff3b3b' : '#06d6a0';
    ctx.beginPath(); ctx.arc(x + 10, y - 8, 9, 0, Math.PI * 2); ctx.fill();
    for (let i = 0; i < 5; i++) {
      const h = 6 + Math.max(0, Math.min(1, vstate.level * 1.6 - i * 0.15)) * 22;
      ctx.fillRect(x + 28 + i * 9, y - h / 2 - 8, 6, h);
    }
    x += 84;
  }
  ctx.font = '600 24px system-ui, sans-serif';
  let text = '';
  if (vstate.error && !on) { ctx.fillStyle = '#ff8a8a'; text = vstate.error; }
  else if (vstate.interim) { ctx.fillStyle = '#ffffff'; text = `“${vstate.interim}”`; }
  else if (lastHeard && performance.now() - lastHeard.at < 6000) { ctx.fillStyle = '#8ecae6'; text = `You → ${hive.agents.get(lastHeard.to)?.name || 'Nova'}: ${lastHeard.text}`; }
  else if (st === 'hearing') { ctx.fillStyle = '#ffd166'; text = 'Hearing you…'; }
  else if (st === 'transcribing' || vstate.busy) { ctx.fillStyle = '#ffd166'; text = 'Writing it down…'; }
  else if (vstate.handsFree) { ctx.fillStyle = '#9fe8c9'; text = 'Listening. Say a name first, or look at an agent and talk.'; }
  else if (vstate.speaking) { ctx.fillStyle = '#c9b8ff'; text = `${hive.agents.get(voiceCtl.speakingId)?.name || 'Agent'} is talking…`; }
  if (text) ctx.fillText(wrap(ctx, text, maxW - (on ? 84 : 0))[0], x, y);
}

function drawConsole(ctx, W, H, P) {
  rr(ctx, 0, 0, W, H, 36);
  ctx.fillStyle = access.hc ? '#000' : 'rgba(20,23,34,0.94)'; ctx.fill();
  ctx.lineWidth = access.hc ? 8 : 4; ctx.strokeStyle = access.hc ? '#ffe600' : '#f2b134'; ctx.stroke();
  const nova = hive.agents.get('nova');
  // Header
  ctx.fillStyle = '#f2b134';
  ctx.font = 'bold 36px system-ui, sans-serif';
  ctx.fillText('NOVA ★', 30, 48);
  ctx.fillStyle = '#aab';
  ctx.font = '24px system-ui, sans-serif';
  const working = [...hive.agents.values()].filter(a => a.status === 'working' || a.status === 'thinking').length;
  const blocked = [...hive.agents.values()].filter(a => a.status === 'blocked').length;
  ctx.fillText(`${working} working  ·  ${blocked} need you  ·  ${hive.mode}`, 215, 48);
  if (nova?.status === 'thinking') { ctx.fillStyle = '#ffd166'; ctx.fillText('planning…', 600, 48); }

  // Live voice caption
  drawCaption(ctx, 30, 92, 710);

  // Chat feed
  const lines = [];
  ctx.font = '24px system-ui, sans-serif';
  for (const l of hive.chat.slice(-6)) {
    const who = l.from === 'you' ? 'You' : (hive.agents.get(l.from)?.name || l.from);
    for (const w of wrap(ctx, `${who}: ${l.text}`, 700)) lines.push({ w, you: l.from === 'you' });
  }
  const coachLine = coach.text();
  const shown = coachLine ? lines.slice(-4) : lines.slice(-5);
  shown.forEach((l, i) => { ctx.fillStyle = access.hc ? '#fff' : l.you ? '#8ecae6' : '#f1f1f1'; ctx.fillText(l.w, 30, 128 + i * 30); });
  if (coachLine) {
    rr(ctx, 22, 236, 712, 44, 14); ctx.fillStyle = access.hc ? '#ffe600' : '#f2b134'; ctx.fill();
    ctx.fillStyle = '#111'; ctx.font = 'bold 24px system-ui, sans-serif';
    ctx.fillText(wrap(ctx, `${coach.stepLabel()}  ${coachLine}`, 690)[0], 34, 266);
  } else if (toast.until > performance.now()) {
    ctx.fillStyle = '#ffd166'; ctx.font = 'bold 22px system-ui, sans-serif';
    ctx.fillText(toast.text, 30, 274);
  }

  // Buttons
  const bx = 760;
  const live = vstate.state === 'listening' || vstate.state === 'hearing';
  P.button('talk', bx, 66, 336, 76, talkLabel(), { bg: live && !vstate.handsFree ? '#c1121f' : '#3a4a8c', accent: '#8ecae6' });
  P.button('hands', bx, 152, 164, 60, vstate.handsFree ? '● Hands-free' : 'Hands-free', { bg: vstate.handsFree ? '#0b6e4f' : '#2b3250', accent: '#06d6a0' });
  P.button('status', bx + 172, 152, 164, 60, 'Team status');
  P.button('table', bx, 222, 100, 54, showBuilding ? 'Floor' : 'Building');
  P.button('voice', bx + 105, 222, 100, 54, voiceCtl.speakOn ? '🔊 On' : '🔈 Off');
  P.button('rotl', bx + 210, 222, 60, 54, '⟲');
  P.button('rotr', bx + 276, 222, 60, 54, '⟳');
  // Quick prompts
  QUICK.forEach(([id, label], i) => P.button(id, 30 + i * 240, 286, 228, 56, label, { bg: '#2b3a2e', accent: '#06d6a0' }));

  // Progress: office level, XP to the next unlock, today's goal, streak.
  const pr = hive.progress;
  if (pr) {
    const y = 352;
    ctx.font = 'bold 24px system-ui, sans-serif'; ctx.fillStyle = access.hc ? '#ffe600' : '#f2b134';
    ctx.fillText(`LV ${pr.level}`, 30, y + 24);
    rr(ctx, 104, y + 8, 220, 20, 10); ctx.fillStyle = '#2c3142'; ctx.fill();
    const frac = pr.next ? Math.min(1, pr.into / pr.span) : 1;
    rr(ctx, 104, y + 8, Math.max(20, 220 * frac), 20, 10); ctx.fillStyle = '#06d6a0'; ctx.fill();
    ctx.font = '600 21px system-ui, sans-serif'; ctx.fillStyle = access.hc ? '#fff' : '#e8e8f0';
    ctx.fillText(`Today ${Math.min(pr.todayDone, pr.goal)}/${pr.goal}${pr.todayDone >= pr.goal ? ' ✓' : ''}${pr.streak > 1 ? `   🔥 ${pr.streak} day streak` : ''}`, 340, y + 25);
    ctx.font = '19px system-ui, sans-serif'; ctx.fillStyle = access.hc ? '#fff' : '#99a';
    ctx.fillText(pr.next ? `Next unlock at ${pr.next.xp} XP: ${pr.next.unlock}` : 'Top level. The whole HQ is yours.', 30, y + 50);
  }
  P.button('place', bx, 352, 164, 50, placeMode ? '● Pinch table' : '📍 Place', { bg: placeMode ? '#0b6e4f' : '#2b3250', accent: '#8ecae6' });
  P.button('access', bx + 172, 352, 164, 50, access.hc || access.dwell ? '♿ On' : '♿ Access', { bg: '#2b3250', accent: '#ffe600' });
}

function onConsolePress(id) {
  if (id === 'talk') return toggleTalk(null);
  if (id === 'hands') return setHandsFree(!vstate.handsFree);
  if (id === 'status') return hive.say('status');
  if (id === 'rotl') world.rotation.y += Math.PI / 8;
  if (id === 'rotr') world.rotation.y -= Math.PI / 8;
  if (id === 'table') setBuilding(!showBuilding);
  if (id === 'voice') voiceCtl.setSpeak(!voiceCtl.speakOn);
  if (id === 'place') setPlaceMode(!placeMode);
  if (id === 'access') cycleAccess();
  const q = QUICK.find(x => x[0] === id);
  if (q) { hive.say(q[2]); coach.event('quick', id); }
  consolePanel.redraw();
}

// Off, then high contrast, then high contrast plus look to select, then off.
function cycleAccess() {
  if (!access.hc) { access.hc = true; access.dwell = false; showToast('High contrast on.'); }
  else if (!access.dwell) { access.dwell = true; showToast('Look to select on: look at an agent or a button for a moment.'); }
  else { access.hc = false; access.dwell = false; showToast('Accessibility off.'); }
  applyAccess();
}
function applyAccess() {
  Panel3D.hc = access.hc;
  document.body.classList.toggle('hc', access.hc);
  agentPanel.mesh.scale.setScalar(access.hc ? 1.7 : 1.35);
  saveAccess();
  consolePanel.redraw();
  if (agentPanel.mesh.visible) agentPanel.redraw();
}

// ---------------------------------------------------------------- agent panel (floats above a selected agent)
const agentPanel = new Panel3D({ width: 0.28, height: 0.22, ppm: 2400, name: 'agentPanel', onPress: onAgentPress });
agentPanel.mesh.userData.kind = 'panel';
agentPanel.mesh.visible = false;
agentPanel.mesh.scale.setScalar(access.hc ? 1.7 : 1.35); // big enough to poke comfortably in a headset
world.add(agentPanel.mesh);

function drawAgentPanel(ctx, W, H, P) {
  const a = hive.agents.get(selectedId);
  if (!a) return;
  rr(ctx, 0, 0, W, H, 30);
  ctx.fillStyle = access.hc ? '#000' : 'rgba(18,20,30,0.95)'; ctx.fill();
  const col = statusColor(a.status);
  ctx.lineWidth = 6; ctx.strokeStyle = col; ctx.stroke();
  ctx.fillStyle = a.color;
  ctx.beginPath(); ctx.arc(46, 50, 22, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = 'bold 40px system-ui, sans-serif';
  ctx.fillText(a.name, 82, 64);
  ctx.font = '21px system-ui, sans-serif'; ctx.fillStyle = '#aab';
  wrap(ctx, a.role, W - 60).slice(0, 2).forEach((l, i) => ctx.fillText(l, 28, 104 + i * 26));
  P.button('close', W - 74, 18, 54, 54, '✕', { bg: '#333a4f' });

  // Status line + progress
  rr(ctx, 28, 148, 150, 38, 19); ctx.fillStyle = col; ctx.fill();
  ctx.fillStyle = '#111'; ctx.font = 'bold 22px system-ui, sans-serif'; ctx.textAlign = 'center';
  ctx.fillText(a.status.toUpperCase(), 103, 175); ctx.textAlign = 'left';
  ctx.fillStyle = '#eee'; ctx.font = '22px system-ui, sans-serif';
  ctx.fillText((a.activity || '').slice(0, 44), 190, 175);
  rr(ctx, 28, 198, W - 56, 10, 5); ctx.fillStyle = '#2c3142'; ctx.fill();
  if (a.progress > 0) { rr(ctx, 28, 198, (W - 56) * Math.min(1, a.progress), 10, 5); ctx.fillStyle = col; ctx.fill(); }
  ctx.fillStyle = '#889'; ctx.font = '19px system-ui, sans-serif';
  ctx.fillText(`${a.doneCount || 0} done  ·  ${a.queued || 0} queued  ·  ${a.inbox || 0} mail  ·  ${a.runtime || ''}`, 28, 236);

  let y = 254;
  if (a.status === 'blocked' && a.question) {
    rr(ctx, 20, y, W - 40, 128, 18); ctx.fillStyle = '#3d1414'; ctx.fill();
    ctx.strokeStyle = '#ff3b3b'; ctx.lineWidth = 4; ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.font = '600 23px system-ui, sans-serif';
    wrap(ctx, a.question, W - 80).slice(0, 2).forEach((l, i) => ctx.fillText(l, 36, y + 34 + i * 28));
    P.button('yes', 36, y + 70, 180, 48, '✓ Yes', { bg: '#0b6e4f', accent: '#06d6a0' });
    P.button('no', 230, y + 70, 180, 48, '✗ No', { bg: '#7a1f1f', accent: '#ef476f' });
    y += 140;
  }
  // Terminal tail
  const termH = H - y - 90;
  if (termH > 40) {
    rr(ctx, 20, y, W - 40, termH, 14); ctx.fillStyle = '#0a0d14'; ctx.fill();
    ctx.font = '17px ui-monospace, Menlo, Consolas, monospace';
    const lines = (hive.terms.get(a.id) || []).filter(Boolean);
    const max = Math.floor((termH - 16) / 21);
    const tail = [];
    for (const l of lines.slice(-max * 2)) tail.push(...wrap(ctx, l, W - 70));
    tail.slice(-max).forEach((l, i) => {
      ctx.fillStyle = l.startsWith('●') ? '#8ecae6' : l.startsWith('?') ? '#ff8080' : l.startsWith('✔') ? '#06d6a0' : '#c9d1d9';
      ctx.fillText(l, 34, y + 26 + i * 21);
    });
  }
  // Footer buttons
  const fy = H - 76;
  P.button('astatus', 16, fy, 104, 58, 'Status');
  const talkingToMe = talkTarget === a.id && (vstate.state === 'listening' || vstate.state === 'hearing');
  P.button('atalk', 128, fy, 132, 58, talkingToMe ? '● Listening' : '🎤 Talk', { bg: talkingToMe ? '#c1121f' : '#3a4a8c' });
  P.button('astop', 268, fy, 104, 58, '■ Stop', { bg: '#5a2330' });
  P.button('adesign', 380, fy, 150, 58, inXR ? '🎲 Restyle' : '✎ Design', { bg: '#4a3a7c', accent: '#b8a2ff' });
  P.button('anext', 538, fy, W - 554, 58, '›');
}

function onAgentPress(id) {
  const a = hive.agents.get(selectedId);
  if (!a) return;
  if (id === 'close') return selectAgent(null);
  if (id === 'yes') hive.answer(a.id, 'yes');
  if (id === 'no') hive.answer(a.id, 'no');
  if (id === 'astatus') hive.status(a.id);
  if (id === 'atalk') toggleTalk(a.id);
  if (id === 'astop') hive.stop(a.id);
  if (id === 'adesign') {
    if (inXR) { hive.updateAgent(a.id, { look: randomLook() }); showToast(`New look for ${a.name}`); } else studio.openEdit(a.id);
  }
  if (id === 'anext') {
    const ids = [...hive.agents.keys()];
    selectAgent(ids[(ids.indexOf(a.id) + 1) % ids.length]);
  }
}

function placeAgentPanel() {
  const s = seatOf(selectedId);
  if (!s) return;
  agentPanel.mesh.position.set(s.x, 0.27, s.z - 0.02);
}

function selectAgent(id) {
  if (selectedId) avatars.get(selectedId)?.setSelected(false);
  selectedId = id;
  if (id) {
    avatars.get(id)?.setSelected(true);
    coach.event('select');
    placeAgentPanel();
    agentPanel.mesh.visible = true;
    agentPanel.setDraw(drawAgentPanel);
  } else {
    agentPanel.mesh.visible = false;
  }
  overlay.selectAgent(id);
}

function showToast(text) {
  toast = { text, until: performance.now() + 4000 };
  consolePanel.redraw();
  overlay.toast(text);
}

// ---------------------------------------------------------------- voice
// Who a line without a name goes to: the agent you selected, else the one you look at (headset).
function focusTarget() {
  if (talkTarget) return talkTarget;
  if (selectedId) return selectedId;
  if (inXR && gazeId) return gazeId;
  return null;
}

const voiceCtl = new Voice({
  onTranscript(text, meta) {
    if (meta.test) { welcome?.heard(text); return; } // the mic test in the welcome screen
    if (uiCommand(text)) return; // every hand action also works by voice
    const agents = [...hive.agents.values()];
    const r = routeUtterance(text, agents, { focusId: meta.target || focusTarget() });
    if (!r) return;
    if (r.pickOnly) {
      selectAgent(r.agentId);
      showToast(`Talking to ${hive.agents.get(r.agentId)?.name}. Go ahead.`);
      return;
    }
    if (!r.text) return;
    lastHeard = { text: r.text, to: r.agentId, at: performance.now() };
    hive.say(r.text, r.to);
    const av = avatars.get(r.agentId);
    if (av) av.hopT = 0.25;
    panelDirty = true;
  },
  onState(st) {
    const was = vstate.state;
    vstate = { ...vstate, ...st };
    if (st.interim === undefined && st.state !== 'hearing') vstate.interim = '';
    if (was !== vstate.state && vstate.state === 'idle') talkTarget = null;
    panelDirty = true;
    overlay?.setVoice?.(vstate, voiceCtl);
    welcome?.voiceState(vstate);
  },
});

// Voice for everything you can do with hands (accessibility, and handy when your hands are busy).
function uiCommand(raw) {
  const t = String(raw).toLowerCase().replace(/[.!?,]/g, '').trim();
  const done = msg => { showToast(msg); clickSound(); panelDirty = true; return true; };
  if (/^(hands ?free|stop listening|mic) off$|^stop listening$/.test(t)) { setHandsFree(false); return true; }
  if (/^(hands ?free) on$|^start listening$/.test(t)) { setHandsFree(true); return true; }
  if (/^(show|go to) (the )?(building|tower|hq)$/.test(t)) { setBuilding(true); return done('Showing the building.'); }
  if (/^(show|go to) (the )?(floor|office|table)$|^hide (the )?building$/.test(t)) { setBuilding(false); return done('Showing the floor.'); }
  if (/^(rotate|turn) (it )?left$/.test(t)) { world.rotation.y += Math.PI / 8; return done('Turned left.'); }
  if (/^(rotate|turn) (it )?right$/.test(t)) { world.rotation.y -= Math.PI / 8; return done('Turned right.'); }
  if (/^(place|move) (the )?(office|building|hq)( here)?$|^place mode$/.test(t)) { setPlaceMode(true); return true; }
  if (/^(mute|quiet|be quiet)( voices)?$/.test(t)) { voiceCtl.setSpeak(false); return done('Voices off.'); }
  if (/^unmute( voices)?$|^voices on$/.test(t)) { voiceCtl.setSpeak(true); return done('Voices on.'); }
  if (/^high contrast( on)?$/.test(t)) { access.hc = true; applyAccess(); return done('High contrast on.'); }
  if (/^high contrast off$/.test(t)) { access.hc = false; applyAccess(); return done('High contrast off.'); }
  if (/^look to select( on)?$|^dwell( on)?$/.test(t)) { access.dwell = true; applyAccess(); return done('Look to select on.'); }
  if (/^look to select off$|^dwell off$/.test(t)) { access.dwell = false; applyAccess(); return done('Look to select off.'); }
  if (/^(close|close (the )?panel|deselect)$/.test(t)) { selectAgent(null); return true; }
  if (/^(next|next agent)$/.test(t)) { const ids = [...hive.agents.keys()]; selectAgent(ids[(ids.indexOf(selectedId) + 1) % ids.length]); return true; }
  if (/^(help|tutorial|show me how|teach me)$/.test(t)) { coach.restart(); return true; }
  // "give the next card to Kai", "assign T-3 to Mira"
  const m = t.match(/^(?:give|assign|hand|send) (?:the )?(next|first|top|t-?\d+)?\s*(?:task|card|ticket)?\s*to (\w+)$/);
  if (m) {
    const agent = findAgent(m[2], [...hive.agents.values()], { fuzzy: true });
    const list = hive.backlog();
    const key = m[1] && /^t/.test(m[1]) ? m[1].replace(/^t-?/, 'T-').toUpperCase() : null;
    const task = key ? list.find(x => x.key?.toUpperCase() === key) : list[0];
    if (agent && task) { hive.assign(task.id, agent.id); coach.event('assign'); return done(`${task.key} → ${agent.name}`); }
  }
  return false;
}

function configureVoice() {
  voiceCtl.configure({ live: hive.isLive, status: hive.voice });
}

async function toggleTalk(target) {
  const st = vstate.state;
  if (st === 'listening' || st === 'hearing') {
    if (vstate.handsFree) { talkTarget = target; panelDirty = true; return; }
    voiceCtl.stop();
    return;
  }
  if (!voiceCtl.canListen) {
    if (!inXR) return overlay.focusInput(target);
    return showToast(voiceCtl.serverHint || 'No speech engine. Add an OpenAI key, or run npm install for local Whisper.');
  }
  talkTarget = target;
  const ok = await voiceCtl.start({ target });
  if (!ok) { talkTarget = null; showToast(vstate.error || 'Mic not available.'); }
}

async function setHandsFree(on) {
  const ok = await voiceCtl.setHandsFree(on);
  if (!ok && on) showToast(vstate.error || 'Mic not available.');
  else showToast(on ? 'Hands-free on. Say a name, or look at an agent and talk.' : 'Hands-free off.');
}

// Look at an agent for a moment and it becomes who you talk to (headset only).
let gazeCandidate = null;
let gazeSince = 0;
const gazeDir = new THREE.Vector3();
const gazeTo = new THREE.Vector3();
function updateGaze(cam, now) {
  cam.getWorldDirection(gazeDir);
  const eye = cam.getWorldPosition(new THREE.Vector3());
  let best = null; let bestA = 0.16;
  for (const av of avatars.values()) {
    av.hit.getWorldPosition(gazeTo);
    gazeTo.sub(eye);
    const a = gazeTo.angleTo(gazeDir);
    if (a < bestA && gazeTo.length() < 2) { best = av.id; bestA = a; }
  }
  if (best !== gazeCandidate) { gazeCandidate = best; gazeSince = now; }
  const next = gazeCandidate && now - gazeSince > 450 ? gazeCandidate : (gazeCandidate ? gazeId : null);
  if (next !== gazeId) { gazeId = next; panelDirty = true; }
}

// ---------------------------------------------------------------- hive events -> scene
function syncAgents() {
  for (const [id, av] of avatars) {
    if (!hive.agents.has(id)) {
      world.remove(av.group);
      avatars.delete(id);
      if (selectedId === id) selectAgent(null);
    }
  }
  const taken = new Set();
  for (const a of hive.agents.values()) {
    taken.add(a.seat);
    let av = avatars.get(a.id);
    const s = SEATS[a.seat];
    if (!av) {
      av = new Avatar(a);
      av.hit.userData.kind = 'agent';
      world.add(av.group);
      avatars.set(a.id, av);
    } else av.update(a);
    if (s) av.group.position.set(s.x, 0, s.z - 0.03);
  }
  for (const [seat, d] of desks) d.setOccupied(taken.has(seat));
}

let panelDirty = true;
const blockedIds = new Set();
hive.on(evt => {
  switch (evt.type) {
    case 'snapshot': syncAgents(); cards.sync(hive.backlog()); perks.setLevel(hive.progress?.level || 1); overlay.setProgress(hive.progress); break;
    case 'agent': {
      const was = blockedIds.has(evt.agent.id);
      const now = evt.agent.status === 'blocked';
      if (now && !was) { blockedIds.add(evt.agent.id); coach.event('blocked'); clickSound(520, 0.18, 0.1); }
      if (!now && was) { blockedIds.delete(evt.agent.id); coach.event('answered'); }
      syncAgents();
      break;
    }
    case 'agent_removed': syncAgents(); break;
    case 'task': cards.sync(hive.backlog()); break;
    case 'mail': {
      const m = evt.message;
      const from = m.from === 'human' ? seatPos('human') : seatPos(m.from, 0.06);
      const to = m.to === 'human' ? seatPos('human') : seatPos(m.to, 0.06);
      envelopes.send(from, to, m.act);
      break;
    }
    case 'progress':
      perks.setLevel(evt.progress?.level || 1);
      overlay.setProgress(evt.progress);
      if (evt.levelUp) { clickSound(660, 0.25, 0.12); setTimeout(() => clickSound(990, 0.3, 0.12), 180); }
      break;
    case 'chat': {
      const l = evt.line;
      if (l.from === 'you') coach.event(/^@/.test(l.text) ? 'talk' : 'you', l.text);
      if (l.from !== 'you' && !/^Passed your answer to /.test(l.text)) {
        const a = hive.agents.get(l.from);
        if (a) voiceCtl.say(a, l.text);
      }
      break;
    }
    case 'voice':
      configureVoice();
      welcome?.refresh();
      break;
    default: break;
  }
  panelDirty = true;
  overlay.update(evt);
});

// ---------------------------------------------------------------- input: mouse, XR rays (pinch), fingertip poke
const raycaster = new THREE.Raycaster();
raycaster.near = 0.001;
const tmpV = new THREE.Vector3();
const tmpQ = new THREE.Quaternion();

function targets() {
  const list = [knob, consolePanel.mesh, ...cards.meshes()];
  if (agentPanel.mesh.visible) list.push(agentPanel.mesh);
  for (const av of avatars.values()) list.push(av.hit);
  for (const d of desks.values()) if (d.hire.visible) list.push(d.hire);
  return list;
}

function pick(ray) {
  raycaster.ray.copy(ray);
  const hits = raycaster.intersectObjects(targets(), false);
  // Panels and cards win over the big agent hit boxes behind them.
  const order = { panel: 0, hire: 0.5, card: 1, handle: 2, agent: 3 };
  hits.sort((a, b) => (order[a.object.userData.kind] - order[b.object.userData.kind]) || (a.distance - b.distance));
  return hits[0] || null;
}

const NAMES = ['Atlas', 'Juno', 'Orion', 'Vega', 'Iris', 'Sol', 'Rune', 'Lumen', 'Nyx', 'Kite', 'Onyx', 'Sage', 'Wren', 'Zephyr', 'Halo', 'Cleo'];
function hireAt(seat) {
  if (!inXR) return studio.openHire(seat);
  // In a headset there is no form. Hire a random specialist, then restyle or edit later.
  const workers = [...hive.agents.values()].filter(a => !a.isBoss).length;
  if (workers >= MAX_WORKERS) return showToast('All desks are taken');
  const used = new Set([...hive.agents.values()].map(a => a.name));
  const tp = TEMPLATES[Math.floor(Math.random() * TEMPLATES.length)];
  const name = NAMES.find(n => !used.has(n)) || `${tp.name}${workers}`;
  const best = ['meta', 'claude-cli', 'codex-cli', 'anthropic', 'openai', 'xai', 'gemini', 'openrouter', 'ollama'].find(id => hive.providerReady(id)) || 'demo';
  hive.hire({ name, role: tp.role, instructions: tp.instructions, skills: tp.skills, provider: best, model: '', autonomy: 'balanced', look: defaultLook({ ...randomLook(), ...tp.look }), seat });
  showToast(`Hired ${name} (${tp.role})`);
}

const pointers = []; // { id, ray, grab, hit, hand, controller }

function nearestDesk(localPos) {
  let best = null; let bestD = 0.085;
  for (const a of hive.agents.values()) {
    if (a.isBoss) continue;
    const s = SEATS[a.seat];
    if (!s) continue;
    const d = Math.hypot(localPos.x - s.x, localPos.z - (s.z - 0.01));
    if (d < bestD) { best = a; bestD = d; }
  }
  return best;
}

function beginSelect(p, directPoint = null) {
  if (placeMode && inXR) {
    const point = placeFromRay(p.ray);
    if (point) { putWorldAt(point); snapped = true; showToast('Placed. It will be here next time too.'); haptic(p); }
    setPlaceMode(false);
    return true;
  }
  // Direct grab: a pinch right on top of a card or an agent.
  if (directPoint) {
    let near = null; let nd = 0.045;
    for (const m of cards.meshes()) {
      const d = m.getWorldPosition(tmpV).distanceTo(directPoint);
      if (d < nd) { near = m; nd = d; }
    }
    if (near) { p.grab = { kind: 'card', card: cards.byMesh(near), direct: true }; p.grab.card.grabbed = true; haptic(p); return; }
  }
  const hit = pick(p.ray);
  if (!hit) return false;
  const kind = hit.object.userData.kind;
  if (kind === 'card') {
    const card = cards.byMesh(hit.object);
    card.grabbed = true;
    p.grab = { kind: 'card', card, direct: false };
    haptic(p);
  } else if (kind === 'handle') {
    p.grab = { kind: 'handle', dist: hit.distance, offset: world.position.clone().sub(hit.point) };
    haptic(p);
  } else if (kind === 'panel') {
    hit.object.userData.panel.press(hit.object.userData.panel.hitUv(hit.uv));
    haptic(p);
  } else if (kind === 'hire') {
    hireAt(hit.object.userData.seat);
    haptic(p);
  } else if (kind === 'agent') {
    const id = hit.object.userData.agentId;
    selectAgent(selectedId === id ? null : id);
    haptic(p);
  }
  return true;
}

function endSelect(p) {
  const g = p.grab;
  p.grab = null;
  if (!g) return;
  if (g.kind === 'handle' && inXR) anchorPending = true;
  if (g.kind === 'card') {
    const card = g.card;
    card.grabbed = false;
    const local = card.mesh.position;
    const agent = nearestDesk(local);
    clearDeskHighlight();
    if (agent) {
      const s = SEATS[agent.seat];
      card.home.set(s.x, 0.04, s.z);
      card.assigning = true;
      hive.assign(card.task.id, agent.id);
      showToast(`${card.task.key} → ${agent.name}`);
      coach.event('assign');
      haptic(p);
      setTimeout(() => { card.assigning = false; cards.layout(); }, 3000);
    }
    cards.layout();
  }
}

function haptic(p) {
  try { p.inputSource?.gamepad?.hapticActuators?.[0]?.pulse(0.4, 40); } catch { /* */ }
}

let highlighted = null;
function clearDeskHighlight() {
  if (highlighted) { desks.get(highlighted).ring.material.color.set('#ff3b3b'); highlighted = null; }
}

const plane = new THREE.Plane();
function updateGrab(p, dt) {
  const g = p.grab;
  if (!g) return;
  if (g.kind === 'handle') {
    const point = p.ray.origin.clone().addScaledVector(p.ray.direction, g.dist);
    world.position.copy(point.add(g.offset));
  } else if (g.kind === 'card') {
    let worldPoint;
    if (g.direct && p.tip) worldPoint = p.tip.clone();
    else {
      plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), world.localToWorld(new THREE.Vector3(0, 0.04, 0)));
      worldPoint = p.ray.intersectPlane(plane, new THREE.Vector3());
    }
    if (!worldPoint) return;
    const local = world.worldToLocal(worldPoint);
    local.y = Math.max(local.y, 0.03);
    g.card.target.copy(local);
    const agent = nearestDesk(local);
    const seat = agent?.seat || null;
    if (seat !== highlighted) {
      clearDeskHighlight();
      if (seat) { desks.get(seat).ring.material.color.set('#f2b134'); highlighted = seat; }
    }
  }
}

// Mouse pointer
const mouse = { id: 'mouse', ray: new THREE.Ray(), grab: null, ndc: new THREE.Vector2(), inputSource: null };
pointers.push(mouse);
function setMouseRay(e) {
  const r = renderer.domElement.getBoundingClientRect();
  mouse.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(mouse.ndc, camera);
  mouse.ray.copy(raycaster.ray);
}
renderer.domElement.addEventListener('pointermove', e => { setMouseRay(e); mouse.active = true; });
renderer.domElement.addEventListener('pointerdown', e => {
  if (inXR || e.button !== 0) return;
  setMouseRay(e);
  if (pick(mouse.ray)) { controls.enabled = false; beginSelect(mouse); }
});
addEventListener('pointerup', () => { endSelect(mouse); controls.enabled = true; });
renderer.domElement.addEventListener('pointerleave', () => { mouse.active = false; });

// XR controllers and hands
const handFactory = new XRHandModelFactory();
const ctrlFactory = new XRControllerModelFactory();
for (let i = 0; i < 2; i++) {
  const controller = renderer.xr.getController(i);
  const grip = renderer.xr.getControllerGrip(i);
  const hand = renderer.xr.getHand(i);
  const lineGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]);
  const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#f2b134', transparent: true, opacity: 0.7 }));
  line.scale.z = 0.5;
  controller.add(line);
  const cursor = new THREE.Mesh(new THREE.SphereGeometry(0.004, 12, 8), new THREE.MeshBasicMaterial({ color: '#f2b134' }));
  scene.add(cursor);
  scene.add(controller, grip, hand);
  hand.add(handFactory.createHandModel(hand, 'spheres'));
  const p = { id: `xr${i}`, ray: new THREE.Ray(), grab: null, controller, hand, line, cursor, inputSource: null, isHand: false, tip: null, connected: false };
  pointers.push(p);
  controller.addEventListener('connected', e => {
    p.connected = true;
    p.inputSource = e.data;
    p.isHand = !!e.data.hand;
    if (!p.isHand && !grip.children.length) grip.add(ctrlFactory.createControllerModel(grip));
  });
  controller.addEventListener('disconnected', () => { p.connected = false; p.grab = null; });
  controller.addEventListener('selectstart', () => {
    const direct = p.isHand ? pinchPoint(p) : null;
    beginSelect(p, direct);
  });
  controller.addEventListener('selectend', () => endSelect(p));
}

function jointPos(hand, name) {
  const j = hand.joints?.[name];
  if (!j || !j.visible) return null;
  return j.getWorldPosition(new THREE.Vector3());
}
function pinchPoint(p) {
  const a = jointPos(p.hand, 'index-finger-tip');
  const b = jointPos(p.hand, 'thumb-tip');
  return a && b ? a.add(b).multiplyScalar(0.5) : a;
}

const pokeCooldown = new Map();
function updateXRPointers() {
  const hovered = { agent: null, panel: new Map(), card: null, handle: false };
  for (const p of pointers) {
    if (p.id === 'mouse') {
      if (inXR || !mouse.active) continue;
    } else {
      if (!inXR || !p.connected) { if (p.line) p.line.visible = false; if (p.cursor) p.cursor.visible = false; continue; }
      p.controller.updateMatrixWorld();
      p.ray.origin.setFromMatrixPosition(p.controller.matrixWorld);
      p.ray.direction.set(0, 0, -1).applyQuaternion(p.controller.getWorldQuaternion(tmpQ)).normalize();
      p.tip = p.isHand ? pinchPoint(p) : null;

      // Fingertip poke for panels and agents.
      const tip = p.isHand ? jointPos(p.hand, 'index-finger-tip') : null;
      if (tip) {
        consolePanel.poke(p.id, tip);
        if (agentPanel.mesh.visible) agentPanel.poke(p.id, tip);
        for (const d of desks.values()) {
          if (!d.hire.visible) continue;
          const c = d.hire.getWorldPosition(tmpV);
          if (c.distanceTo(tip) < 0.03 && (pokeCooldown.get(d.hire.uuid) || 0) < performance.now()) {
            pokeCooldown.set(d.hire.uuid, performance.now() + 1500);
            hireAt(d.hire.userData.seat);
          }
        }
        for (const av of avatars.values()) {
          const c = av.hit.getWorldPosition(tmpV);
          if (c.distanceTo(tip) < 0.035 && (pokeCooldown.get(av.id) || 0) < performance.now()) {
            pokeCooldown.set(av.id, performance.now() + 900);
            selectAgent(av.id);
          }
        }
      }
    }
    updateGrab(p);
    const hit = p.grab ? null : pick(p.ray);
    if (p.line) {
      p.line.visible = true;
      p.line.scale.z = hit ? hit.distance : 0.4;
      p.cursor.visible = !!hit;
      if (hit) p.cursor.position.copy(hit.point);
    }
    if (!hit) continue;
    const kind = hit.object.userData.kind;
    if (kind === 'agent') hovered.agent = hit.object.userData.agentId;
    else if (kind === 'card') hovered.card = cards.byMesh(hit.object);
    else if (kind === 'handle') hovered.handle = true;
    else if (kind === 'panel') hovered.panel.set(hit.object.userData.panel, hit.object.userData.panel.hitUv(hit.uv));
  }
  for (const av of avatars.values()) av.setHovered(av.id === hovered.agent || (inXR && av.id === gazeId));
  cards.setHover(hovered.card);
  knob.material.emissiveIntensity = hovered.handle ? 0.8 : 0.15;
  for (const panel of [consolePanel, agentPanel]) {
    if (hovered.panel.has(panel)) panel.setHover(hovered.panel.get(panel));
    else if (!inXR) panel.setHover(null);
  }
  renderer.domElement.style.cursor = (hovered.agent || hovered.card || hovered.handle || [...hovered.panel.values()].some(Boolean)) ? 'pointer' : 'default';
}

// ---------------------------------------------------------------- your real desk: planes, place mode, anchors
// In passthrough the HQ snaps onto your real table (WebXR plane detection). You can pinch to move it,
// and it stays there next time (a persistent spatial anchor), so your office lives on your desk.
const ANCHOR_KEY = 'deskhive.anchor';
const planeMeshes = new Map(); // XRPlane -> mesh
const planeMat = new THREE.MeshBasicMaterial({ color: '#8ecae6', transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
let placeMode = false;
let anchor = null; // XRAnchor the HQ follows
let anchorPending = false;
let snapped = false; // already put on a table this session
let snapTries = 0;

function setPlaceMode(on) {
  placeMode = on;
  for (const m of planeMeshes.values()) m.visible = on;
  if (on) showToast(inXR ? 'Point at your table and pinch to put the office there.' : 'Place mode works in the headset.');
  if (on && !inXR) placeMode = false;
  panelDirty = true;
}

function lift() { return showBuilding ? BASE_H * world.scale.y : 0; }
const SCALE_KEY = 'deskhive.scale';
const MIN_FIT = 0.5;

function planeGeometry(plane) {
  const shape = new THREE.Shape(plane.polygon.map(p => new THREE.Vector2(p.x, -p.z)));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(-Math.PI / 2);
  return g;
}

function updatePlanes(frame, ref) {
  const planes = frame.detectedPlanes;
  if (!planes) return;
  for (const [pl, mesh] of planeMeshes) if (!planes.has(pl)) { scene.remove(mesh); mesh.geometry.dispose(); planeMeshes.delete(pl); }
  for (const pl of planes) {
    if (pl.orientation && pl.orientation !== 'horizontal') continue;
    const pose = frame.getPose(pl.planeSpace, ref);
    if (!pose) continue;
    let mesh = planeMeshes.get(pl);
    if (!mesh) {
      mesh = new THREE.Mesh(planeGeometry(pl), planeMat);
      mesh.matrixAutoUpdate = false;
      mesh.userData.kind = 'plane';
      mesh.userData.changed = pl.lastChangedTime;
      mesh.visible = placeMode;
      scene.add(mesh);
      planeMeshes.set(pl, mesh);
    } else if (mesh.userData.changed !== pl.lastChangedTime) {
      mesh.geometry.dispose();
      mesh.geometry = planeGeometry(pl);
      mesh.userData.changed = pl.lastChangedTime;
    }
    mesh.matrix.fromArray(pose.transform.matrix);
    mesh.matrixWorldNeedsUpdate = true;
    mesh.updateMatrixWorld(true);
  }
}

// Put the HQ on a world point (a table top), facing you.
function putWorldAt(point, fit = 1) {
  world.scale.setScalar(fit);
  try { localStorage.setItem(SCALE_KEY, String(fit)); } catch { /* */ }
  const cam = renderer.xr.getCamera();
  const head = cam.getWorldPosition(new THREE.Vector3());
  world.position.set(point.x, point.y + lift(), point.z);
  world.rotation.set(0, Math.atan2(head.x - point.x, head.z - point.z), 0);
  anchorPending = true;
}

// Scale the office down so it fits the real surface (a small desk should not get a 94 cm tower).
function fitFor(mesh) {
  mesh.geometry.computeBoundingBox();
  const bb = mesh.geometry.boundingBox;
  const w = bb.max.x - bb.min.x, d = bb.max.z - bb.min.z;
  const s = Math.min(w / HQ_W, d / HQ_D) * 0.92;
  return THREE.MathUtils.clamp(Number.isFinite(s) ? s : 1, MIN_FIT, 1);
}

// Find a desk height surface in front of you and snap to it, once.
function autoSnap() {
  if (snapped || anchor || !planeMeshes.size || placeMode) return;
  const cam = renderer.xr.getCamera();
  const head = cam.getWorldPosition(new THREE.Vector3());
  const dir = cam.getWorldDirection(new THREE.Vector3()); dir.y = 0; dir.normalize();
  const ray = new THREE.Raycaster();
  let best = null;
  for (const mesh of planeMeshes.values()) {
    const y = new THREE.Vector3().setFromMatrixPosition(mesh.matrixWorld).y;
    if (y < head.y - 0.95 || y > head.y - 0.2) continue; // not desk height (floor or shelf)
    // Aim 55 cm ahead at the table height.
    const probe = new THREE.Vector3(head.x + dir.x * 0.55, y + 0.5, head.z + dir.z * 0.55);
    ray.set(probe, new THREE.Vector3(0, -1, 0));
    mesh.visible = true;
    const hit = ray.intersectObject(mesh, false)[0];
    mesh.visible = placeMode;
    if (hit) { best = { point: hit.point, hit: true, d: 0, fit: fitFor(mesh) }; continue; }
    if (best?.hit) continue;
    // No table right ahead: use the near edge of the closest desk height surface (inset so the HQ fits).
    mesh.geometry.computeBoundingBox();
    const bb = mesh.geometry.boundingBox;
    const local = mesh.worldToLocal(head.clone());
    local.x = THREE.MathUtils.clamp(local.x, bb.min.x + 0.2, Math.max(bb.min.x + 0.2, bb.max.x - 0.2));
    local.z = THREE.MathUtils.clamp(local.z, bb.min.z + 0.2, Math.max(bb.min.z + 0.2, bb.max.z - 0.2));
    local.y = 0;
    const point = mesh.localToWorld(local);
    const flat = Math.hypot(point.x - head.x, point.z - head.z);
    const d = flat + Math.abs(y - (head.y - 0.45)) * 2; // close, and about desk height below your eyes
    if (flat < 2.5 && (!best || d < best.d)) best = { point, hit: false, d, fit: fitFor(mesh) };
  }
  if (best) { snapped = true; putWorldAt(best.point, best.fit); showToast(best.fit < 0.98 ? 'Snapped onto your desk and shrunk to fit. Say place office to move it.' : 'Snapped onto your desk. Say place office to move it.'); clickSound(990, 0.1, 0.08); }
  else if (++snapTries > 240) snapped = true; // about 3 s of looking: keep the default spot
}

// Pinch while in place mode: drop the HQ where the ray hits a table (or the current height).
function placeFromRay(ray) {
  const hitList = [];
  for (const m of planeMeshes.values()) { m.visible = true; }
  raycaster.ray.copy(ray);
  hitList.push(...raycaster.intersectObjects([...planeMeshes.values()], false));
  for (const m of planeMeshes.values()) m.visible = placeMode;
  let point = hitList[0]?.point;
  if (!point) {
    const pl = new THREE.Plane(new THREE.Vector3(0, 1, 0), -(world.position.y - lift()));
    point = ray.intersectPlane(pl, new THREE.Vector3());
  }
  return point || null;
}

async function makeAnchor(frame, ref) {
  anchorPending = false;
  if (!frame.createAnchor) return;
  const q = world.quaternion;
  const pose = new XRRigidTransform({ x: world.position.x, y: world.position.y - lift(), z: world.position.z }, { x: q.x, y: q.y, z: q.z, w: q.w });
  try {
    const old = anchor;
    anchor = await frame.createAnchor(pose, ref);
    try { old?.delete?.(); } catch { /* */ }
    const session = renderer.xr.getSession();
    const oldHandle = localStorage.getItem(ANCHOR_KEY);
    if (anchor.requestPersistentHandle) {
      const h = await anchor.requestPersistentHandle();
      localStorage.setItem(ANCHOR_KEY, h);
      if (oldHandle && oldHandle !== h) session?.deletePersistentAnchor?.(oldHandle).catch(() => {});
    }
  } catch { /* anchors not supported: the office just stays where it is this session */ }
}

function followAnchor(frame, ref) {
  if (!anchor || placeMode || mouse.grab?.kind === 'handle' || pointers.some(p => p.grab?.kind === 'handle')) return;
  const pose = frame.getPose(anchor.anchorSpace, ref);
  if (!pose) return;
  const { position: p, orientation: o } = pose.transform;
  world.position.set(p.x, p.y + lift(), p.z);
  world.quaternion.set(o.x, o.y, o.z, o.w);
}

async function restoreAnchor(session) {
  let h = null;
  try { h = localStorage.getItem(ANCHOR_KEY); } catch { /* */ }
  if (!h || !session.restorePersistentAnchor) return;
  try {
    anchor = await session.restorePersistentAnchor(h);
    snapped = true;
    try { const sc = parseFloat(localStorage.getItem(SCALE_KEY)); if (sc >= MIN_FIT && sc <= 1) world.scale.setScalar(sc); } catch { /* */ }
    showToast('Your office is right where you left it.');
  } catch {
    try { localStorage.removeItem(ANCHOR_KEY); } catch { /* */ }
    session.deletePersistentAnchor?.(h).catch(() => {});
  }
}

// Look to select (accessibility): rest your gaze on a button or an agent and it presses itself.
const dwell = { key: null, since: 0 };
const headRay = new THREE.Ray();
const DWELL_MS = 1400;
function updateDwell(cam, now) {
  if (!access.dwell || !inXR) { dwell.key = null; return; }
  cam.getWorldPosition(headRay.origin);
  cam.getWorldDirection(headRay.direction);
  const hit = pick(headRay);
  let key = null; let fire = null;
  if (hit) {
    const kind = hit.object.userData.kind;
    if (kind === 'panel') {
      const panel = hit.object.userData.panel;
      const id = panel.hitUv(hit.uv);
      if (id) { key = `${panel.mesh.name}:${id}`; fire = () => panel.press(id); panel.setHover(id); }
    } else if (kind === 'agent') {
      const id = hit.object.userData.agentId;
      key = `agent:${id}`; fire = () => selectAgent(id);
    } else if (kind === 'hire') {
      key = `hire:${hit.object.userData.seat}`; fire = () => hireAt(hit.object.userData.seat);
    }
  }
  if (key !== dwell.key) { dwell.key = key; dwell.since = now; return; }
  if (key && now - dwell.since > DWELL_MS) { fire(); dwell.since = now + 1200; }
}

// ---------------------------------------------------------------- XR session
let enteredBefore = false;
async function enterXR(mode) {
  voiceCtl.unlockAudio();
  if (!navigator.xr) return overlay.toast('WebXR is not available here. Open this page on your headset, or add ?emu to the URL.');
  const ok = await navigator.xr.isSessionSupported(mode).catch(() => false);
  if (!ok) return overlay.toast(mode === 'immersive-ar' ? 'Passthrough is not supported here. On a laptop add ?emu to the link to try the Meta emulator.' : 'No headset found. On a laptop add ?emu to the link to try the Meta emulator.');
  let session;
  try {
    session = await navigator.xr.requestSession(mode, { optionalFeatures: ['local-floor', 'hand-tracking', 'plane-detection', 'anchors'] });
    await renderer.xr.setSession(session);
  } catch (e) {
    return overlay.toast(`Could not start the headset session: ${e.message}`);
  }
  inXR = true;
  const ar = mode === 'immersive-ar';
  snapped = !ar; snapTries = 0; anchor = null;
  sun.castShadow = false; // shadows are the most expensive thing here; the headset keeps 72 fps without them
  restoreAnchor(session);
  // Pause and resume cleanly when you open the system menu or take the headset off.
  let pausedHandsFree = false;
  session.addEventListener('visibilitychange', () => {
    if (session.visibilityState === 'visible') {
      voiceCtl.setSpeak(true);
      if (pausedHandsFree) { pausedHandsFree = false; voiceCtl.setHandsFree(true); }
    } else {
      pausedHandsFree = vstate.handsFree;
      if (pausedHandsFree) voiceCtl.setHandsFree(false);
      voiceCtl.setSpeak(false);
    }
  });
  scene.background = ar ? null : BG;
  scene.fog = ar ? null : scene.fog;
  city.visible = !ar && showBuilding;
  voiceCtl.setSpeak(true);
  // Come in talking: turn on hands-free when a speech engine is ready, and say hello.
  if (voiceCtl.canListen) voiceCtl.setHandsFree(true).then(ok => { if (ok) showToast('Hands-free on. Say a name, or look at an agent and talk.'); });
  const nova = [...hive.agents.values()].find(a => a.isBoss);
  if (nova && !enteredBefore) voiceCtl.say(nova, voiceCtl.canListen ? `Welcome in. Just talk. Say a name like ${[...hive.agents.values()].find(a => !a.isBoss)?.name || 'Kai'} first, or look at someone.` : 'Welcome in. Pinch a card and drop it on a desk, or poke a button.');
  enteredBefore = true;
  overlay.setXR(true);
  consolePanel.redraw();
  // Put the office on the desk in front of the user once the head pose is known.
  setTimeout(placeWorldInFront, 400);
  setTimeout(placeWorldInFront, 1500);
  setTimeout(() => coach.start(), 2500);
  session.addEventListener('end', () => {
    inXR = false;
    scene.background = BG; scene.fog = FOG;
    city.visible = showBuilding;
    sun.castShadow = true;
    if (vstate.handsFree) voiceCtl.setHandsFree(false);
    for (const m of planeMeshes.values()) { scene.remove(m); m.geometry.dispose(); }
    planeMeshes.clear();
    anchor = null; placeMode = false;
    world.scale.setScalar(1);
    overlay.setXR(false);
  });
}

function setBuilding(on) {
  showBuilding = on;
  building.visible = on;
  city.visible = on && !(renderer.xr.isPresenting && scene.background === null);
  if (renderer.xr.isPresenting && !anchor) placeWorldInFront();
  consolePanel.redraw();
}

function placeWorldInFront() {
  if (!renderer.xr.isPresenting || anchor || (snapped && planeMeshes.size)) return;
  const cam = renderer.xr.getCamera();
  const pos = cam.getWorldPosition(new THREE.Vector3());
  const dir = cam.getWorldDirection(new THREE.Vector3());
  dir.y = 0;
  if (dir.lengthSq() < 0.01) dir.set(0, 0, -1);
  dir.normalize();
  // The plot sits at desk height (about 42 cm below the eyes), 60 cm ahead, entrance facing the user.
  // With the building hidden, the live floor sits on the desk instead.
  world.scale.setScalar(1);
  const lift = showBuilding ? BASE_H : 0;
  world.position.set(pos.x + dir.x * 0.62, pos.y - 0.42 + lift, pos.z + dir.z * 0.62);
  world.rotation.y = Math.atan2(-dir.x, -dir.z);
}

// ---------------------------------------------------------------- overlay (desktop HTML)
const overlay = initOverlay({
  hive,
  onEnterVR: () => enterXR('immersive-vr'),
  onEnterAR: () => enterXR('immersive-ar'),
  onSelectAgent: id => selectAgent(id),
  onTalk: target => toggleTalk(target),
  onTalkStop: () => { if (!vstate.handsFree) voiceCtl.stop(); },
  onHandsFree: on => setHandsFree(on),
});

const studio = initStudio({ hive, speak: (a, t) => voiceCtl.say(a, t) });
const welcome = initWelcome({ hive, voice: voiceCtl, openConnections: () => studio.openConnections(), onClose: () => setTimeout(() => coach.start(), 400) });
overlay.setHandlers?.({ onHelp: () => welcome.open(0), onEdit: id => studio.openEdit(id), onHire: () => { const free = [...desks.keys()].find(k => k !== 'boss' && !desks.get(k).group.userData.occupied); studio.openHire(free || null); }, onConnections: () => studio.openConnections(), onAccess: () => cycleAccess() });

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
let screenT = 0;
let panelT = 0;
let elapsed = 0;
const camPos = new THREE.Vector3();

// Frame time guard: measure real frame rate and shed cost when it drops (headset only).
const perf = { frames: 0, t: 0, fps: 0, lite: false, low: 0 };
const perfHud = new URLSearchParams(location.search).has('perf') ? Object.assign(document.createElement('div'), { id: 'perf' }) : null;
if (perfHud) { perfHud.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99;font:12px monospace;color:#8ecae6;background:#0008;padding:4px 8px;border-radius:6px'; document.body.appendChild(perfHud); }
function perfTick(rawDt) {
  perf.frames++; perf.t += rawDt;
  if (perf.t < 1) return;
  perf.fps = perf.frames / perf.t; perf.frames = 0; perf.t = 0;
  const session = renderer.xr.getSession?.();
  const target = (session?.frameRate || 72) * 0.85;
  if (inXR) {
    perf.low = perf.fps < target ? perf.low + 1 : 0;
    if (!perf.lite && perf.low >= 3) { perf.lite = true; city.visible = false; panelEvery = 0.4; }
    if (perf.lite && !inXR) perf.lite = false;
  } else if (perf.lite) { perf.lite = false; panelEvery = 0.16; city.visible = showBuilding; }
  if (perfHud) perfHud.textContent = `${perf.fps.toFixed(0)} fps${perf.lite ? ' · lite' : ''}${inXR ? ' · xr' : ''} · scale ${world.scale.x.toFixed(2)}`;
}
let panelEvery = 0.16;

renderer.setAnimationLoop((time, frame) => {
  const rawDt = clock.getDelta();
  perfTick(rawDt);
  const dt = Math.min(rawDt, 0.05);
  elapsed += dt;
  if (frame) {
    const ref = renderer.xr.getReferenceSpace();
    // Real surfaces only matter in passthrough. In VR the HQ lives in its own city.
    if (scene.background === null) { updatePlanes(frame, ref); autoSnap(); }
    if (anchorPending) makeAnchor(frame, ref);
    followAnchor(frame, ref);
    // Place mode preview: the HQ follows where you point.
    if (placeMode) {
      const p = pointers.find(x => x.id !== 'mouse' && x.connected);
      const point = p && placeFromRay(p.ray);
      if (point) { world.position.set(point.x, point.y + lift(), point.z); }
    }
  }
  perks.tick(dt, elapsed);
  coach.tick(elapsed);
  if (!inXR) controls.update();
  updateXRPointers();

  // Who is talking, who is listening, who you look at.
  const camNow = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  if (inXR) { updateGaze(camNow, performance.now()); updateDwell(camNow, performance.now()); }
  const listeningTo = (vstate.state === 'listening' || vstate.state === 'hearing') ? (focusTarget() || 'nova') : null;
  for (const av of avatars.values()) {
    av.talking = voiceCtl.speaking && voiceCtl.speakingId === av.id;
    av.listening = listeningTo === av.id || (vstate.state === 'hearing' && !focusTarget() && av.agent?.isBoss);
    av.tick(dt);
  }
  cards.tick(dt);
  envelopes.tick(dt);

  // Desk screens, LEDs and the "needs you" floor rings.
  screenT += dt;
  if (screenT > 0.12) {
    screenT = 0;
    for (const a of hive.agents.values()) {
      const d = desks.get(a.seat);
      if (!d) continue;
      drawScreen(d.screen, a.status, elapsed, a.color);
      d.ledMat.color.set(statusColor(a.status));
    }
  }
  for (const a of hive.agents.values()) {
    const d = desks.get(a.seat);
    if (!d) continue;
    const ring = d.ring;
    if (highlighted === a.seat) ring.material.opacity = 0.9;
    else ring.material.opacity = a.status === 'blocked' ? 0.45 + Math.sin(elapsed * 6) * 0.4 : 0;
  }

  for (const d of desks.values()) {
    if (!d.hire.visible) continue;
    d.hire.position.y = 0.07 + Math.sin(elapsed * 2 + d.hire.position.x * 40) * 0.003;
    const lp = world.worldToLocal(camPos.clone());
    const wp = d.group.position;
    d.hire.rotation.y = Math.atan2(lp.x - wp.x, lp.z - wp.z);
  }

  // Panels: billboard the agent panel toward the viewer, redraw at most 6 times a second.
  const cam = renderer.xr.isPresenting ? renderer.xr.getCamera() : camera;
  cam.getWorldPosition(camPos);
  if (agentPanel.mesh.visible) {
    const local = world.worldToLocal(camPos.clone());
    agentPanel.mesh.rotation.set(0, Math.atan2(local.x - agentPanel.mesh.position.x, local.z - agentPanel.mesh.position.z), 0);
  }
  panelT += dt;
  if (panelDirty && panelT > panelEvery) {
    panelT = 0; panelDirty = false;
    consolePanel.redraw();
    if (agentPanel.mesh.visible) agentPanel.redraw();
  }

  // Sun follows the HQ so shadows stay right wherever you put it.
  sun.position.copy(world.position).add(SUN_OFFSET);
  sun.target.position.copy(world.position);

  if (!studio.open || inXR) renderer.render(scene, camera);
});

consolePanel.setDraw(drawConsole);
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

await hive.connect();
configureVoice();
setTimeout(() => welcome.maybeOpen(), 600);
overlay.update({ type: 'mode' });
panelDirty = true;
window.__deskhive = {
  // Test helper: what a click at screen x, y would hit.
  pickAt(x, y) {
    const r = renderer.domElement.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), camera);
    const h = pick(raycaster.ray.clone());
    return h ? { kind: h.object.userData.kind, name: h.object.name, d: h.distance } : null;
  },
  perf, get planes() { return planeMeshes.size; }, get snapped() { return snapped; }, welcome, voiceCtl, routeUtterance, coach, uiCommand, perks, access, cycleAccess, setPlaceMode, get placeMode() { return placeMode; }, get anchor() { return anchor; }, Panel3D, get vstate() { return vstate; }, studio, hireAt, setBuilding, building, city, camera, consolePanel, agentPanel, hive, selectAgent, world, avatars, cards, placeWorldInFront, desks, get selectedId() { return selectedId; } };
