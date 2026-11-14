// Shared office pieces: seats, desks, labels, screens. The building itself lives in building.js.
// Units are meters. Local origin is the top of the floor plate.

import * as THREE from 'three';

const mats = new Map();
export function mat(color, opts = {}) {
  const key = color + JSON.stringify(opts);
  if (!mats.has(key)) mats.set(key, new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0, ...opts }));
  return mats.get(key);
}

export function box(w, h, d, color, x = 0, y = 0, z = 0, opts) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), typeof color === 'object' ? color : mat(color, opts));
  m.position.set(x, y + h / 2, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

export const PALETTE = {
  plate: '#2a2f3a',
  floor: '#d9d2c3',
  floorAlt: '#cfc7b6',
  wall: '#f3efe6',
  desk: '#b07d4f',
  deskDark: '#8a5c35',
  monitor: '#1d1f24',
  chair: '#3d4452',
  plant: '#3fa34d',
  pot: '#c96f4a',
  glass: '#a8d8ff',
  table: '#5b4636',
  tray: '#41495a',
};

export const SEATS = {
  boss: { x: -0.31, z: -0.17 },
  d0: { x: -0.07, z: -0.17 },
  d1: { x: 0.11, z: -0.17 },
  d2: { x: 0.29, z: -0.17 },
  d3: { x: -0.07, z: -0.025 },
  d4: { x: 0.11, z: -0.025 },
  d5: { x: 0.29, z: -0.025 },
  d6: { x: -0.07, z: 0.12 },
  d7: { x: 0.11, z: 0.12 },
  d8: { x: 0.29, z: 0.12 },
};

export const TRAY = { x: -0.31, z: 0.15, w: 0.24, d: 0.2, y: 0.026 }; // a sorting table in the task inbox room

function makeScreenTexture() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 40;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  return { canvas: c, ctx: c.getContext('2d'), tex, lines: [] };
}

export function buildDesk(seat) {
  const g = new THREE.Group();
  g.position.set(seat.x, 0, seat.z);
  // Desk (the character sits behind it, at -z, facing the human at +z).
  g.add(box(0.08, 0.004, 0.045, PALETTE.desk, 0, 0.026, 0.012));
  g.add(box(0.004, 0.026, 0.04, PALETTE.deskDark, -0.036, 0, 0.012));
  g.add(box(0.004, 0.026, 0.04, PALETTE.deskDark, 0.036, 0, 0.012));
  // Chair
  g.add(box(0.026, 0.004, 0.024, PALETTE.chair, 0, 0.016, -0.03));
  g.add(box(0.026, 0.026, 0.004, PALETTE.chair, 0, 0.016, -0.044));
  g.add(box(0.003, 0.016, 0.003, '#222', 0, 0, -0.03));
  // Monitor, screen faces the character, back faces the human.
  const monitor = new THREE.Group();
  monitor.position.set(0, 0.03, 0.022);
  monitor.add(box(0.004, 0.012, 0.004, '#333', 0, 0, 0));
  const shell = box(0.05, 0.032, 0.004, PALETTE.monitor, 0, 0.01, 0);
  monitor.add(shell);
  const screen = makeScreenTexture();
  const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(0.046, 0.028), new THREE.MeshBasicMaterial({ map: screen.tex }));
  screenMesh.position.set(0, 0.026, -0.0025);
  screenMesh.rotation.y = Math.PI;
  monitor.add(screenMesh);
  // Status light strip on the back, so the human sees state at a glance.
  const ledMat = new THREE.MeshBasicMaterial({ color: '#666' });
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.004, 0.001), ledMat);
  led.position.set(0, 0.03, 0.0025);
  monitor.add(led);
  g.add(monitor);
  // Keyboard and mug
  g.add(box(0.03, 0.002, 0.01, '#e8e8e8', 0, 0.03, 0.0));
  g.add(box(0.008, 0.01, 0.008, '#ffffff', 0.03, 0.03, 0.02));
  // Status ring on the floor (pulses red when the agent needs you).
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.045, 0.052, 32), new THREE.MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(0, 0.0015, -0.01);
  g.add(ring);

  // "+ HIRE" marker that floats over an empty desk. Pinch it to hire someone here.
  const hc = document.createElement('canvas');
  hc.width = 256; hc.height = 96;
  const hx = hc.getContext('2d');
  hx.fillStyle = 'rgba(242,177,52,0.92)';
  hx.beginPath(); hx.roundRect(6, 8, 244, 80, 30); hx.fill();
  hx.fillStyle = '#1a1405'; hx.font = 'bold 46px system-ui, sans-serif'; hx.textAlign = 'center'; hx.textBaseline = 'middle';
  hx.fillText('+ HIRE', 128, 50);
  const htex = new THREE.CanvasTexture(hc);
  htex.colorSpace = THREE.SRGBColorSpace;
  const hire = new THREE.Mesh(new THREE.PlaneGeometry(0.06, 0.0225), new THREE.MeshBasicMaterial({ map: htex, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  hire.position.set(0, 0.07, -0.02);
  hire.userData.kind = 'hire';
  hire.userData.seat = seat.id;
  hire.visible = false;
  g.add(hire);

  const deskParts = g.children.filter(c => c !== hire && c !== ring);
  const setOccupied = occupied => {
    hire.visible = !occupied;
    for (const part of deskParts) part.visible = true;
    monitor.visible = occupied;
    g.userData.occupied = occupied;
  };
  return { group: g, ledMat, screen, ring, monitor, hire, setOccupied };
}

function plant(x, z, s = 1) {
  const g = new THREE.Group();
  g.position.set(x, 0, z);
  g.add(box(0.016 * s, 0.016 * s, 0.016 * s, PALETTE.pot));
  const leaf = new THREE.Mesh(new THREE.IcosahedronGeometry(0.016 * s, 0), mat(PALETTE.plant, { flatShading: true }));
  leaf.position.y = 0.03 * s;
  leaf.castShadow = true;
  g.add(leaf);
  return g;
}

export function makeLabelPlane(text, w, h, color = '#fff', bg = 'rgba(0,0,0,0.6)') {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = Math.round(1024 * h / w);
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = color;
  ctx.font = `bold ${Math.round(c.height * 0.55)}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, c.width / 2, c.height / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
}

const STATUS_COLOR = { idle: '#8a8f99', thinking: '#ffd166', working: '#3a86ff', blocked: '#ff3b3b', done: '#06d6a0', error: '#9b2226', offline: '#444' };
export function statusColor(s) { return STATUS_COLOR[s] || '#888'; }

// Fake code scrolling on a desk screen.
export function drawScreen(screen, status, t, color) {
  const { ctx, canvas } = screen;
  ctx.fillStyle = '#0b1020';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  if (status === 'idle' || status === 'offline') {
    ctx.fillStyle = '#1b2440';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#3a4a7a';
    ctx.fillRect(26, 14, 12, 12);
  } else if (status === 'blocked') {
    ctx.fillStyle = (Math.floor(t * 3) % 2) ? '#ff3b3b' : '#5a0f0f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 26px monospace'; ctx.textAlign = 'center'; ctx.fillText('?', 32, 30);
  } else if (status === 'done') {
    ctx.fillStyle = '#06d6a0'; ctx.font = 'bold 26px monospace'; ctx.textAlign = 'center'; ctx.fillText('✓', 32, 30);
  } else {
    const off = Math.floor(t * 8);
    for (let i = 0; i < 9; i++) {
      const seed = (i + off) * 9301 % 233;
      const w = 10 + (seed % 40);
      const indent = (seed % 3) * 5;
      ctx.fillStyle = i % 3 === 0 ? color : (seed % 2 ? '#8ecae6' : '#e9edc9');
      ctx.fillRect(3 + indent, 3 + i * 4, w, 2);
    }
  }
  screen.tex.needsUpdate = true;
}
