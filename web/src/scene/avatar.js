// A designable voxel agent. Body language shows state so you can read the room at a glance:
// typing = working, head tilt = thinking, hand up = needs you, hop = done.
// The look (species, hair, outfit, accessory, aura) comes from the Character Studio.

import * as THREE from 'three';
import { box, mat, statusColor } from './office.js';
import { providerById, defaultLook } from '@shared/protocol.js';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { c, ctx: c.getContext('2d'), tex };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const BUBBLE = { thinking: '…', blocked: '!', done: '✓', error: '✗', working: '⌨' };

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

// Build the body parts for a look. Returns the rig the animator uses.
export function buildBody(look, { boss = false } = {}) {
  const L = defaultLook(look || {});
  const root = new THREE.Group();
  root.scale.setScalar(boss ? 1.12 : 1);
  const robot = L.species === 'robot';
  const cat = L.species === 'cat';

  const skin = robot ? mat(L.skin, { metalness: 0.6, roughness: 0.35 }) : mat(L.skin);
  const hair = mat(L.hair);
  const shirt = mat(L.shirt);
  const pants = mat(L.pants || '#2b2d42');
  const dark = mat('#111111');

  // Legs, seated, pointing toward the desk at +z.
  for (const x of [-0.006, 0.006]) {
    root.add(box(0.008, 0.006, 0.02, pants, x, 0.016, 0.006));
    root.add(box(0.008, 0.016, 0.006, pants, x, 0, 0.014));
  }

  const torso = new THREE.Group();
  torso.position.set(0, 0.022, -0.002);
  root.add(torso);
  torso.add(box(0.024, 0.022, 0.014, robot ? mat(L.shirt, { metalness: 0.5, roughness: 0.4 }) : shirt, 0, 0, 0));

  // Outfit details.
  if (L.outfit === 'hoodie') {
    torso.add(box(0.02, 0.008, 0.006, mat(shade(L.shirt, 0.8)), 0, 0.018, -0.009)); // hood
    torso.add(box(0.002, 0.008, 0.001, mat('#ffffff'), -0.004, 0.012, 0.0075));
    torso.add(box(0.002, 0.008, 0.001, mat('#ffffff'), 0.004, 0.012, 0.0075));
  } else if (L.outfit === 'suit') {
    torso.add(box(0.008, 0.02, 0.001, mat('#f5f5f5'), 0, 0.001, 0.0072));
    torso.add(box(0.003, 0.014, 0.0012, mat(boss ? '#b5179e' : '#c1121f'), 0, 0.004, 0.0076));
  } else if (L.outfit === 'labcoat') {
    torso.add(box(0.026, 0.026, 0.004, mat('#f2f2f2'), 0, -0.004, 0.006));
    torso.add(box(0.008, 0.022, 0.0012, shirt, 0, 0.0, 0.0085));
  }

  const head = new THREE.Group();
  head.position.set(0, 0.024, 0);
  torso.add(head);
  head.add(box(0.018, 0.018, 0.018, skin, 0, 0, 0));

  let mouth;
  if (robot) {
    const visor = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.005, 0.001), new THREE.MeshBasicMaterial({ color: L.eyes || '#5ce1e6' }));
    visor.position.set(0, 0.009, 0.0095);
    head.add(visor);
    mouth = box(0.008, 0.0012, 0.001, mat('#333'), 0, 0.003, 0.0095);
    head.add(mouth);
    head.add(box(0.003, 0.006, 0.006, mat('#666', { metalness: 0.7 }), -0.0105, 0.006, 0));
    head.add(box(0.003, 0.006, 0.006, mat('#666', { metalness: 0.7 }), 0.0105, 0.006, 0));
  } else {
    const eye = mat(L.eyes && L.eyes !== '#111111' ? L.eyes : '#111');
    head.add(box(0.003, 0.003, 0.001, eye, -0.004, 0.008, 0.0095));
    head.add(box(0.003, 0.003, 0.001, eye, 0.004, 0.008, 0.0095));
    mouth = box(0.006, 0.0012, 0.001, mat(cat ? '#3b1f1f' : '#7a2e2e'), 0, 0.003, 0.0095);
    head.add(mouth);
  }

  if (cat) {
    const ear = new THREE.ConeGeometry(0.004, 0.008, 4);
    for (const x of [-0.006, 0.006]) {
      const e = new THREE.Mesh(ear, skin);
      e.position.set(x, 0.022, 0);
      e.castShadow = true;
      head.add(e);
      const inner = new THREE.Mesh(new THREE.ConeGeometry(0.002, 0.005, 4), mat('#ff9eb5'));
      inner.position.set(x, 0.021, 0.0015);
      head.add(inner);
    }
    head.add(box(0.003, 0.002, 0.001, mat('#ff9eb5'), 0, 0.005, 0.0096));
    for (const s of [-1, 1]) head.add(box(0.008, 0.0005, 0.0005, mat('#ffffff'), s * 0.009, 0.004, 0.0096));
    // Tail
    const tail = box(0.003, 0.003, 0.02, skin, 0, 0.012, -0.022);
    tail.rotation.x = -0.5;
    root.add(tail);
  } else if (!robot) {
    // Hair styles
    const hs = L.hairStyle;
    if (hs !== 'bald') {
      head.add(box(0.019, 0.005, 0.019, hair, 0, 0.0145, -0.0005));
      head.add(box(0.019, 0.011, 0.004, hair, 0, 0.006, -0.008));
    }
    if (hs === 'long') { head.add(box(0.004, 0.02, 0.016, hair, -0.0105, -0.004, -0.002)); head.add(box(0.004, 0.02, 0.016, hair, 0.0105, -0.004, -0.002)); head.add(box(0.019, 0.02, 0.004, hair, 0, -0.006, -0.009)); }
    if (hs === 'bun') head.add(box(0.008, 0.008, 0.008, hair, 0, 0.02, -0.006));
    if (hs === 'spiky') for (let i = -2; i <= 2; i++) { const sp = box(0.003, 0.007, 0.003, hair, i * 0.0038, 0.017, (i % 2) * 0.002); sp.rotation.z = i * 0.2; head.add(sp); }
    if (hs === 'mohawk') head.add(box(0.004, 0.009, 0.018, hair, 0, 0.018, 0));
  }

  // Accessories
  const acc = L.accessory;
  if (acc === 'glasses') {
    head.add(box(0.006, 0.005, 0.001, mat('#222'), -0.0045, 0.0075, 0.0102));
    head.add(box(0.006, 0.005, 0.001, mat('#222'), 0.0045, 0.0075, 0.0102));
    head.add(box(0.003, 0.001, 0.001, mat('#222'), 0, 0.008, 0.0102));
  } else if (acc === 'shades') {
    head.add(box(0.019, 0.005, 0.001, dark, 0, 0.0075, 0.0102));
  } else if (acc === 'headphones') {
    head.add(box(0.022, 0.003, 0.004, mat('#222'), 0, 0.019, 0));
    head.add(box(0.004, 0.008, 0.008, mat('#e63946'), -0.0115, 0.006, 0));
    head.add(box(0.004, 0.008, 0.008, mat('#e63946'), 0.0115, 0.006, 0));
  } else if (acc === 'cap') {
    head.add(box(0.02, 0.006, 0.02, mat(shade(L.shirt, 0.7)), 0, 0.016, 0));
    head.add(box(0.016, 0.0015, 0.01, mat(shade(L.shirt, 0.7)), 0, 0.016, 0.012));
  } else if (acc === 'crown') {
    const gold = mat('#ffd166', { metalness: 0.8, roughness: 0.25, emissive: '#5a4300', emissiveIntensity: 0.4 });
    head.add(box(0.018, 0.004, 0.018, gold, 0, 0.0185, 0));
    for (const [x, z] of [[-0.007, 0.007], [0.007, 0.007], [0, 0.007], [-0.007, -0.007], [0.007, -0.007]]) head.add(box(0.003, 0.005, 0.003, gold, x, 0.0225, z));
  } else if (acc === 'antenna') {
    head.add(box(0.0015, 0.012, 0.0015, mat('#888'), 0, 0.018, 0));
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.003, 10, 8), new THREE.MeshBasicMaterial({ color: L.eyes && L.eyes !== '#111111' ? L.eyes : '#ff3b3b' }));
    ball.position.set(0, 0.031, 0);
    head.add(ball);
  } else if (acc === 'halo') {
    const halo = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0012, 8, 24), new THREE.MeshBasicMaterial({ color: '#fff3b0' }));
    halo.rotation.x = Math.PI / 2;
    halo.position.set(0, 0.026, 0);
    head.add(halo);
  }

  // Arms pivot at the shoulder.
  const arm = side => {
    const pivot = new THREE.Group();
    pivot.position.set(side * 0.016, 0.019, 0);
    const sleeve = L.outfit === 'labcoat' ? mat('#f2f2f2') : robot ? mat(L.shirt, { metalness: 0.5, roughness: 0.4 }) : shirt;
    pivot.add(box(0.007, 0.02, 0.007, sleeve, 0, -0.02, 0));
    pivot.add(box(0.007, 0.006, 0.007, skin, 0, -0.026, 0));
    torso.add(pivot);
    return pivot;
  };
  const armL = arm(-1);
  const armR = arm(1);

  // Aura
  let aura = null;
  if (L.aura === 'glow') {
    aura = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.034, 32), new THREE.MeshBasicMaterial({ color: L.shirt, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }));
    aura.rotation.x = -Math.PI / 2;
    aura.position.y = 0.002;
    root.add(aura);
  } else if (L.aura === 'sparkle') {
    aura = new THREE.Group();
    const g = new THREE.OctahedronGeometry(0.0022);
    for (let i = 0; i < 6; i++) {
      const sp = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: i % 2 ? '#ffd166' : '#ffffff' }));
      sp.userData.phase = (i / 6) * Math.PI * 2;
      aura.add(sp);
    }
    root.add(aura);
  }

  return { root, torso, head, armL, armR, mouth, aura };
}

export class Avatar {
  constructor(agent) {
    this.id = agent.id;
    this.agent = agent;
    this.group = new THREE.Group();
    this.group.name = `agent-${agent.id}`;
    this.t = Math.random() * 10;
    this.status = 'idle';
    this.hopT = 0;
    this.lookKey = '';
    this.rebuild(agent);

    this.tag = makeCanvas(320, 96);
    this.tagSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tag.tex, depthWrite: false, transparent: true }));
    this.tagSprite.scale.set(0.08, 0.024, 1);
    this.group.add(this.tagSprite);

    this.bubble = makeCanvas(96, 96);
    this.bubbleSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.bubble.tex, depthWrite: false, transparent: true }));
    this.bubbleSprite.scale.set(0.026, 0.026, 1);
    this.group.add(this.bubbleSprite);

    // Big invisible hit box so pinching a tiny person is easy.
    this.hit = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.11, 0.07), new THREE.MeshBasicMaterial({ visible: false }));
    this.hit.position.set(0, 0.05, 0);
    this.hit.userData.agentId = agent.id;
    this.group.add(this.hit);

    this.selected = false;
    this.hovered = false;
    this.update(agent);
  }

  rebuild(agent) {
    const key = JSON.stringify(agent.look || {}) + (agent.isBoss ? 'B' : '');
    if (key === this.lookKey) return;
    this.lookKey = key;
    if (this.rig) this.group.remove(this.rig.root);
    this.rig = buildBody(agent.look, { boss: agent.isBoss });
    this.group.add(this.rig.root);
    const s = agent.isBoss ? 1.12 : 1;
    this.tagY = 0.1 * s;
    this.bubbleY = 0.082 * s;
  }

  update(agent) {
    const prev = this.status;
    this.agent = agent;
    this.status = agent.status;
    if (prev !== 'done' && this.status === 'done') this.hopT = 1.2;
    this.rebuild(agent);
    this.tagSprite.position.set(0, this.tagY, 0);
    this.drawTag();
    this.drawBubble();
  }

  drawTag() {
    const { ctx, c, tex } = this.tag;
    const a = this.agent;
    const p = providerById(a.provider);
    ctx.clearRect(0, 0, c.width, c.height);
    const col = statusColor(a.status);
    roundRect(ctx, 6, 8, c.width - 12, 80, 22);
    ctx.fillStyle = this.selected ? 'rgba(255,255,255,0.95)' : this.hovered ? 'rgba(40,44,60,0.95)' : 'rgba(20,22,30,0.82)';
    ctx.fill();
    ctx.lineWidth = 6; ctx.strokeStyle = col; ctx.stroke();
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(38, 48, 13, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = this.selected ? '#111' : '#fff';
    ctx.font = 'bold 40px system-ui, sans-serif';
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText((a.name + (a.isBoss ? ' ★' : '')).slice(0, 10), 60, 50);
    // Brain badge.
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(c.width - 40, 48, 24, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = ['#ffffff', '#e5e5e5'].includes(p.color) ? '#111' : '#fff';
    ctx.font = 'bold 28px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(p.badge, c.width - 40, 50);
    ctx.textAlign = 'left';
    tex.needsUpdate = true;
  }

  drawBubble() {
    const { ctx, c, tex } = this.bubble;
    ctx.clearRect(0, 0, c.width, c.height);
    const ch = BUBBLE[this.status];
    const extra = (this.agent.inbox || 0) > 0 && !ch ? '✉' : null;
    const sym = ch || extra;
    this.bubbleSprite.visible = !!sym;
    if (!sym) return;
    const col = this.status === 'blocked' ? '#ff3b3b' : this.status === 'done' ? '#06d6a0' : this.status === 'error' ? '#9b2226' : '#ffffff';
    ctx.fillStyle = col;
    ctx.beginPath(); ctx.arc(48, 44, 40, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(20, 70); ctx.lineTo(10, 94); ctx.lineTo(40, 80); ctx.fill();
    ctx.fillStyle = col === '#ffffff' ? '#222' : '#fff';
    ctx.font = 'bold 52px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(sym, 48, 46);
    tex.needsUpdate = true;
  }

  setSelected(v) { if (this.selected !== v) { this.selected = v; this.drawTag(); } }
  setHovered(v) { if (this.hovered !== v) { this.hovered = v; this.drawTag(); } }

  tick(dt) {
    this.t += dt;
    animate(this.rig, this.status, this.t, dt, this);
    this.bubbleSprite.position.set(0.03, this.bubbleY + Math.sin(this.t * 3) * 0.003, 0);
    if (this.status === 'blocked') this.bubbleSprite.scale.setScalar(0.026 + Math.abs(Math.sin(this.t * 5)) * 0.008);
    else this.bubbleSprite.scale.setScalar(0.026);
  }
}

// Shared animator so the Studio preview moves exactly like the office.
export function animate(rig, st, t, dt, state = {}) {
  const { armL, armR, head, torso, mouth, root, aura } = rig;
  armL.rotation.set(0, 0, 0);
  armR.rotation.set(0, 0, 0);
  head.rotation.set(0, 0, 0);
  torso.rotation.set(0, 0, 0);
  torso.scale.y = 1;
  root.position.y = 0;
  mouth.scale.y = 1;

  if (st === 'working') {
    armL.rotation.x = -1.1 + Math.sin(t * 22) * 0.18;
    armR.rotation.x = -1.1 + Math.sin(t * 22 + 1.7) * 0.18;
    head.rotation.x = 0.12 + Math.sin(t * 2) * 0.03;
    torso.rotation.x = 0.08;
  } else if (st === 'thinking') {
    head.rotation.z = Math.sin(t * 1.6) * 0.22;
    armR.rotation.x = -2.2; armR.rotation.z = 0.5;
    armL.rotation.x = -0.9;
  } else if (st === 'blocked') {
    armR.rotation.z = 2.7 + Math.sin(t * 8) * 0.25;
    armL.rotation.x = -0.6;
    head.rotation.y = Math.sin(t * 2) * 0.2;
    root.position.y = Math.abs(Math.sin(t * 4)) * 0.004;
    mouth.scale.y = 3;
  } else if (st === 'done' || st === 'wave') {
    armL.rotation.z = st === 'wave' ? -0.3 : -2.6;
    armR.rotation.z = 2.6 + (st === 'wave' ? Math.sin(t * 7) * 0.35 : 0);
    mouth.scale.y = 2.5;
  } else if (st === 'error') {
    torso.rotation.x = 0.35;
    head.rotation.x = 0.4;
    armL.rotation.z = -0.2; armR.rotation.z = 0.2;
  } else {
    torso.scale.y = 1 + Math.sin(t * 2) * 0.015;
    head.rotation.y = Math.sin(t * 0.5) > 0.85 ? 0.5 : (Math.sin(t * 0.37) > 0.9 ? -0.5 : 0);
    armL.rotation.x = -0.5; armR.rotation.x = -0.5;
  }
  // Looking up at you while you talk to it, and lips moving while it speaks.
  if (state.listening) { head.rotation.x = -0.28; head.rotation.y = 0; head.rotation.z = 0; }
  if (state.talking) { mouth.scale.y = 1.2 + Math.abs(Math.sin(t * 17)) * 2.4; head.rotation.x += Math.sin(t * 5) * 0.04 - 0.1; }
  if (state.hopT > 0) {
    state.hopT -= dt;
    root.position.y = Math.abs(Math.sin(state.hopT * 9)) * 0.018;
  }
  if (aura) {
    if (aura.isMesh) aura.material.opacity = 0.35 + Math.sin(t * 3) * 0.2;
    else aura.children.forEach(sp => {
      const a = t * 1.5 + sp.userData.phase;
      sp.position.set(Math.cos(a) * 0.028, 0.02 + Math.sin(t * 2 + sp.userData.phase) * 0.02 + 0.02, Math.sin(a) * 0.028);
      sp.rotation.y = t * 4;
    });
  }
}
