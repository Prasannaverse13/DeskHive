// DeskHive HQ: an office building you look into from above.
// The top floor is the live office (roof cut away). Below it: glass floors, a lobby,
// a little plaza with trees, and a city around it.
// Units are meters. Local origin is the top of the live office floor.

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SEATS, TRAY, buildDesk, makeLabelPlane } from './office.js';

export const W = 0.94;
export const D = 0.6;
const X0 = -W / 2, X1 = W / 2, Z0 = -D / 2, Z1 = D / 2;
export const WALL_H = 0.075;
export const PLOT_Y = -0.208; // top of the plaza
export const BASE_H = 0.224; // live floor to bottom of the plot

// ---------------------------------------------------------------- static geometry batcher
// Hundreds of little boxes become a handful of meshes, one per material. Kind to a headset.
class Builder {
  constructor() {
    this.buckets = new Map();
    this.stack = [new THREE.Matrix4()];
  }
  get m() { return this.stack[this.stack.length - 1]; }
  at(x, y, z, ry, fn) {
    const local = new THREE.Matrix4().makeRotationY(ry || 0).setPosition(x, y, z);
    this.stack.push(this.m.clone().multiply(local));
    fn();
    this.stack.pop();
  }
  add(geo, color, opts = {}) {
    geo.applyMatrix4(this.m);
    const key = `${color}|${JSON.stringify(opts)}`;
    if (!this.buckets.has(key)) this.buckets.set(key, { color, opts, geos: [] });
    this.buckets.get(key).geos.push(geo);
  }
  box(w, h, d, color, x = 0, y = 0, z = 0, opts) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y + h / 2, z);
    this.add(g, color, opts);
  }
  cyl(rt, rb, h, color, x = 0, y = 0, z = 0, seg = 12, opts) {
    const g = new THREE.CylinderGeometry(rt, rb, h, seg);
    g.translate(x, y + h / 2, z);
    this.add(g, color, opts);
  }
  ball(r, color, x = 0, y = 0, z = 0, seg = 8, opts) {
    const g = new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.7)));
    g.translate(x, y, z);
    this.add(g, color, opts);
  }
  build({ shadows = true } = {}) {
    const group = new THREE.Group();
    for (const { color, opts, geos } of this.buckets.values()) {
      const merged = mergeGeometries(geos, false);
      const { basic, ...rest } = opts;
      const material = basic
        ? new THREE.MeshBasicMaterial({ color, ...rest })
        : new THREE.MeshStandardMaterial({ color, roughness: 0.8, metalness: 0, ...rest });
      const mesh = new THREE.Mesh(merged, material);
      mesh.castShadow = shadows && !rest.transparent;
      mesh.receiveShadow = shadows;
      group.add(mesh);
      geos.forEach(g => g.dispose());
    }
    return group;
  }
}

function canvasTex(w, h, draw, { repeat = false, nearest = false } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (nearest) t.magFilter = THREE.NearestFilter;
  return t;
}

function rand(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

// ---------------------------------------------------------------- furniture
function plant(b, x, z, s = 1, kind = 0) {
  b.at(x, 0, z, 0, () => {
    b.cyl(0.008 * s, 0.006 * s, 0.014 * s, kind ? '#e8e4dc' : '#c96f4a', 0, 0, 0, 10);
    if (kind === 2) { // tall palm
      b.cyl(0.0015, 0.0015, 0.04 * s, '#6b4f2a', 0, 0.012 * s, 0, 5);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        b.ball(0.011 * s, '#3c9a4a', Math.cos(a) * 0.009 * s, 0.05 * s, Math.sin(a) * 0.009 * s, 6, { flatShading: true });
      }
    } else {
      b.ball(0.013 * s, '#3fa34d', 0, 0.026 * s, 0, 7, { flatShading: true });
      b.ball(0.009 * s, '#52b95e', 0.006 * s, 0.036 * s, 0.003 * s, 6, { flatShading: true });
      b.ball(0.008 * s, '#2f8a3d', -0.006 * s, 0.033 * s, -0.004 * s, 6, { flatShading: true });
    }
  });
}

function sofa(b, x, z, ry, color, len = 0.1) {
  b.at(x, 0, z, ry, () => {
    b.box(len, 0.012, 0.036, shade(color, 0.75), 0, 0, 0);
    b.box(len - 0.012, 0.006, 0.03, color, 0, 0.012, 0.003);
    b.box(len, 0.024, 0.009, color, 0, 0.008, -0.0135);
    b.box(0.008, 0.02, 0.036, shade(color, 0.85), -len / 2 + 0.004, 0.008, 0);
    b.box(0.008, 0.02, 0.036, shade(color, 0.85), len / 2 - 0.004, 0.008, 0);
    b.box(0.014, 0.012, 0.004, '#f2b134', -len / 4, 0.018, -0.007); // cushion
  });
}

function armchair(b, x, z, ry, color) {
  b.at(x, 0, z, ry, () => {
    b.box(0.034, 0.012, 0.032, shade(color, 0.75), 0, 0, 0);
    b.box(0.026, 0.005, 0.026, color, 0, 0.012, 0.002);
    b.box(0.034, 0.022, 0.008, color, 0, 0.008, -0.012);
    b.box(0.006, 0.018, 0.032, color, -0.014, 0.008, 0);
    b.box(0.006, 0.018, 0.032, color, 0.014, 0.008, 0);
  });
}

function bookshelf(b, x, z, ry, w = 0.08, h = 0.06, seed = 1) {
  const r = rand(seed);
  const books = ['#c1121f', '#3a86ff', '#06d6a0', '#ffd166', '#7c5cff', '#ef476f', '#264653', '#e76f51', '#8ecae6'];
  b.at(x, 0, z, ry, () => {
    b.box(w, h, 0.018, '#8a5c35', 0, 0, 0);
    b.box(w - 0.006, h - 0.008, 0.002, '#5b3a1e', 0, 0.004, -0.007);
    const shelves = 4;
    for (let i = 0; i < shelves; i++) {
      const y = 0.004 + i * ((h - 0.008) / shelves);
      b.box(w - 0.006, 0.0025, 0.016, '#a87444', 0, y, 0.001);
      let bx = -w / 2 + 0.006;
      while (bx < w / 2 - 0.01) {
        const bw = 0.003 + r() * 0.004;
        const bh = 0.008 + r() * 0.006;
        if (r() > 0.12) b.box(bw, bh, 0.012, books[Math.floor(r() * books.length)], bx + bw / 2, y + 0.0025, 0.001);
        bx += bw + 0.0006;
      }
    }
  });
}

function copier(b, x, z, ry) {
  b.at(x, 0, z, ry, () => {
    b.box(0.034, 0.03, 0.03, '#e4e7ec', 0, 0, 0);
    b.box(0.034, 0.004, 0.03, '#9aa3b2', 0, 0.03, 0);
    b.box(0.02, 0.003, 0.012, '#ffffff', -0.002, 0.034, 0.004);
    b.box(0.008, 0.004, 0.002, '#3a86ff', 0.01, 0.03, 0.0155, { emissive: '#3a86ff', emissiveIntensity: 0.6 });
    b.box(0.03, 0.002, 0.002, '#555c6a', 0, 0.012, 0.0155);
    b.box(0.03, 0.002, 0.002, '#555c6a', 0, 0.02, 0.0155);
  });
}

function waterCooler(b, x, z) {
  b.at(x, 0, z, 0, () => {
    b.box(0.016, 0.03, 0.016, '#e9edf2', 0, 0, 0);
    b.cyl(0.007, 0.007, 0.016, '#7fc8ff', 0, 0.03, 0, 10, { transparent: true, opacity: 0.75, roughness: 0.1 });
    b.box(0.003, 0.003, 0.002, '#3a86ff', -0.003, 0.02, 0.009);
    b.box(0.003, 0.003, 0.002, '#ef476f', 0.003, 0.02, 0.009);
  });
}

function vending(b, x, z, ry) {
  const r = rand(77);
  b.at(x, 0, z, ry, () => {
    b.box(0.036, 0.07, 0.028, '#c1121f', 0, 0, 0);
    b.box(0.024, 0.056, 0.002, '#1d2433', -0.004, 0.008, 0.0145);
    for (let i = 0; i < 5; i++) for (let j = 0; j < 4; j++) {
      const c = ['#ffd166', '#06d6a0', '#3a86ff', '#ef476f', '#ffffff'][Math.floor(r() * 5)];
      b.box(0.004, 0.006, 0.002, c, -0.013 + j * 0.006, 0.012 + i * 0.01, 0.0158, { emissive: c, emissiveIntensity: 0.25 });
    }
    b.box(0.006, 0.012, 0.002, '#e9edf2', 0.012, 0.03, 0.0145);
  });
}

function fridge(b, x, z, ry) {
  b.at(x, 0, z, ry, () => {
    b.box(0.03, 0.068, 0.028, '#dfe4ea', 0, 0, 0);
    b.box(0.03, 0.001, 0.0286, '#9aa3b2', 0, 0.042, 0);
    b.box(0.002, 0.016, 0.002, '#9aa3b2', 0.011, 0.046, 0.0148);
    b.box(0.002, 0.02, 0.002, '#9aa3b2', 0.011, 0.016, 0.0148);
  });
}

function counter(b, x, z, ry, len) {
  b.at(x, 0, z, ry, () => {
    b.box(len, 0.026, 0.026, '#f3efe6', 0, 0, 0);
    b.box(len + 0.002, 0.003, 0.028, '#3d4452', 0, 0.026, 0);
    for (let i = 0; i < Math.floor(len / 0.02); i++) b.box(0.0015, 0.016, 0.001, '#b8b2a6', -len / 2 + 0.01 + i * 0.02, 0.006, 0.0132);
    // sink
    b.box(0.018, 0.002, 0.014, '#9aa3b2', -len / 4, 0.0285, 0);
    b.cyl(0.001, 0.001, 0.01, '#c0c6d0', -len / 4, 0.028, -0.008, 6);
    // coffee machine
    b.box(0.014, 0.022, 0.014, '#1d1f24', len / 4, 0.029, -0.002);
    b.box(0.006, 0.004, 0.002, '#ef476f', len / 4, 0.044, 0.0055, { emissive: '#ef476f', emissiveIntensity: 0.6 });
    b.cyl(0.0025, 0.002, 0.005, '#ffffff', len / 4, 0.029, 0.006, 8);
    // microwave
    b.box(0.022, 0.012, 0.014, '#cfd5dd', len / 2 - 0.016, 0.029, -0.002);
    b.box(0.013, 0.008, 0.001, '#1d2433', len / 2 - 0.018, 0.031, 0.0055);
  });
}

function coffeeTable(b, x, z, w = 0.04, d = 0.024) {
  b.at(x, 0, z, 0, () => {
    b.box(w, 0.003, d, '#5b4636', 0, 0.011, 0);
    for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.002, 0.011, 0.002, '#2b2d42', lx * (w / 2 - 0.003), 0, lz * (d / 2 - 0.003));
    b.box(0.012, 0.004, 0.008, '#3a86ff', -0.008, 0.014, 0.002);
    b.cyl(0.003, 0.0025, 0.006, '#ffffff', 0.01, 0.014, -0.003, 8);
  });
}

function cafeTable(b, x, z) {
  b.at(x, 0, z, 0, () => {
    b.cyl(0.016, 0.016, 0.003, '#f3efe6', 0, 0.024, 0, 16);
    b.cyl(0.002, 0.002, 0.024, '#2b2d42', 0, 0, 0, 6);
    b.cyl(0.008, 0.008, 0.002, '#2b2d42', 0, 0, 0, 10);
    for (const a of [0.3, Math.PI + 0.3]) {
      const sx = Math.cos(a) * 0.026, sz = Math.sin(a) * 0.026;
      b.cyl(0.007, 0.007, 0.003, '#06d6a0', sx, 0.016, sz, 10);
      b.cyl(0.0015, 0.0015, 0.016, '#2b2d42', sx, 0, sz, 5);
    }
    b.cyl(0.003, 0.0025, 0.006, '#ffffff', 0.004, 0.027, 0.003, 8);
  });
}

function filing(b, x, z, ry) {
  b.at(x, 0, z, ry, () => {
    b.box(0.022, 0.04, 0.022, '#7a8597', 0, 0, 0);
    for (let i = 0; i < 3; i++) {
      b.box(0.02, 0.001, 0.0005, '#4a5263', 0, 0.012 + i * 0.012, 0.0112);
      b.box(0.006, 0.0015, 0.001, '#d6dbe3', 0, 0.007 + i * 0.012, 0.0115);
    }
  });
}

function bin(b, x, z) { b.cyl(0.005, 0.004, 0.01, '#5b6475', x, 0, z, 8); }

function shade(hex, k) {
  const c = new THREE.Color(hex);
  c.multiplyScalar(k);
  return `#${c.getHexString()}`;
}

// ---------------------------------------------------------------- textures
function floorTexture() {
  const PX = 1000; // pixels per meter
  return canvasTex(Math.round(W * PX), Math.round(D * PX), (ctx, w, h) => {
    const X = x => (x - X0) * PX;
    const Z = z => (z - Z0) * PX;
    const rect = (x0, z0, x1, z1) => [X(x0), Z(z0), X(x1) - X(x0), Z(z1) - Z(z0)];
    // Workspace: carpet tiles.
    ctx.fillStyle = '#9aa5b4'; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < w; i += 40) for (let j = 0; j < h; j += 40) {
      ctx.fillStyle = ((i + j) / 40) % 2 ? '#a3adbb' : '#97a2b1';
      ctx.fillRect(i, j, 40, 40);
    }
    // Aisle stripe toward the front.
    ctx.fillStyle = '#c9cdd3'; ctx.fillRect(...rect(-0.18, 0.205, 0.345, Z1));
    // Boss cabin: wood planks.
    const [bx, by, bw, bh] = rect(X0, Z0, -0.18, -0.03);
    ctx.fillStyle = '#b07d4f'; ctx.fillRect(bx, by, bw, bh);
    for (let j = by; j < by + bh; j += 18) {
      const off = ((j / 18) % 3) * 50;
      ctx.fillStyle = (j / 18) % 2 ? '#a8744a' : '#b9875a'; ctx.fillRect(bx, j, bw, 18);
      ctx.fillStyle = '#8a5c35';
      for (let i = bx - off; i < bx + bw; i += 150) ctx.fillRect(i, j, 2, 18);
      ctx.fillRect(bx, j, bw, 1);
    }
    // Boss rug.
    ctx.fillStyle = '#7b2d26'; ctx.fillRect(...rect(-0.41, -0.235, -0.21, -0.065));
    ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 5; ctx.strokeRect(...rect(-0.4, -0.225, -0.22, -0.075));
    // Task inbox room: big light tiles.
    const [mx, my, mw, mh] = rect(X0, -0.03, -0.18, Z1);
    ctx.fillStyle = '#e9e4d8'; ctx.fillRect(mx, my, mw, mh);
    ctx.strokeStyle = '#d3ccbc'; ctx.lineWidth = 2;
    for (let i = mx; i < mx + mw; i += 60) { ctx.beginPath(); ctx.moveTo(i, my); ctx.lineTo(i, my + mh); ctx.stroke(); }
    for (let j = my; j < my + mh; j += 60) { ctx.beginPath(); ctx.moveTo(mx, j); ctx.lineTo(mx + mw, j); ctx.stroke(); }
    // Lounge and kitchen: warm wood and a rug.
    const [lx, ly, lw, lh] = rect(0.345, Z0, X1, Z1);
    ctx.fillStyle = '#d8b98c'; ctx.fillRect(lx, ly, lw, lh);
    ctx.fillStyle = '#c9a676';
    for (let j = ly; j < ly + lh; j += 22) ctx.fillRect(lx, j, lw, 2);
    ctx.fillStyle = '#e9e4d8'; ctx.fillRect(...rect(0.345, Z0, X1, -0.24)); // kitchen tiles
    ctx.fillStyle = '#2a9d8f'; ctx.fillRect(...rect(0.36, 0.13, 0.455, 0.25));
    ctx.strokeStyle = '#e9c46a'; ctx.lineWidth = 4; ctx.strokeRect(...rect(0.367, 0.137, 0.448, 0.243));
    // Cubicle floor mats under each desk.
    for (const [id, s] of Object.entries(SEATS)) {
      if (id === 'boss') continue;
      ctx.fillStyle = 'rgba(40,55,80,0.16)';
      ctx.fillRect(...rect(s.x - 0.045, s.z - 0.055, s.x + 0.045, s.z + 0.04));
    }
    // Doorway thresholds.
    ctx.fillStyle = '#6b7280';
    ctx.fillRect(...rect(-0.183, -0.1, -0.177, -0.05));
  });
}

function windowStrip(seed, { lobby = false, top = '#5aa9e6', bottom = '#2f6db3', frame = '#e9edf2', lit = 0.45 } = {}) {
  // One storey of facade, 8 window bays, some lit with people at desks.
  return canvasTex(512, lobby ? 96 : 72, (ctx, w, h) => {
    const r = rand(seed);
    const bay = w / 8;
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, top); g.addColorStop(1, bottom);
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      const x = i * bay;
      if (r() < (lobby ? 0.8 : lit)) {
        ctx.fillStyle = 'rgba(255,233,168,0.55)'; ctx.fillRect(x + 4, 6, bay - 8, h - 14);
        if (r() < 0.7) { // a person at a desk
          ctx.fillStyle = 'rgba(40,40,60,0.55)';
          const px = x + 10 + r() * (bay - 30);
          ctx.fillRect(px, h - 26, 10, 14); ctx.fillRect(px + 2, h - 34, 6, 7);
          ctx.fillRect(px + 14, h - 20, 18, 6);
        }
      }
      ctx.fillStyle = 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.moveTo(x + 6, 6); ctx.lineTo(x + 24, 6); ctx.lineTo(x + 8, h - 10); ctx.lineTo(x + 6, h - 10); ctx.fill();
      ctx.fillStyle = frame; ctx.fillRect(x, 0, 4, h);
    }
    ctx.fillStyle = frame; ctx.fillRect(0, 0, w, 5); ctx.fillRect(0, h - 6, w, 6);
  }, { repeat: true });
}

function facadePlane(tex, len, h, bayW = 0.058) {
  const t = tex.clone();
  t.needsUpdate = true;
  t.repeat.set(len / (8 * bayW), 1);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h), new THREE.MeshStandardMaterial({ map: t, roughness: 0.25, metalness: 0.1 }));
  m.receiveShadow = true;
  return m;
}

function whiteboardTex() {
  return canvasTex(256, 128, (ctx, w, h) => {
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = '#3a86ff'; ctx.lineWidth = 3;
    ctx.strokeRect(14, 16, 54, 28); ctx.strokeRect(100, 16, 54, 28); ctx.strokeRect(186, 16, 54, 28);
    ctx.beginPath(); ctx.moveTo(68, 30); ctx.lineTo(100, 30); ctx.moveTo(154, 30); ctx.lineTo(186, 30); ctx.stroke();
    ctx.fillStyle = '#c1121f'; ctx.font = 'bold 15px sans-serif'; ctx.fillText('SHIP IT', 20, 74);
    ctx.fillStyle = '#06d6a0'; ctx.fillRect(110, 64, 22, 12); ctx.fillStyle = '#ffd166'; ctx.fillRect(140, 64, 22, 12); ctx.fillStyle = '#ef476f'; ctx.fillRect(170, 64, 22, 12);
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.moveTo(20, 92 + i * 9); ctx.lineTo(20 + 60 + (i * 37) % 70, 92 + i * 9); ctx.stroke(); }
    ctx.strokeStyle = '#9aa3b2'; ctx.lineWidth = 6; ctx.strokeRect(0, 0, w, h);
  });
}

function chartTex() {
  return canvasTex(256, 144, (ctx, w, h) => {
    ctx.fillStyle = '#0b1020'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#8ecae6'; ctx.font = 'bold 14px sans-serif'; ctx.fillText('SHIPPED / WEEK', 12, 22);
    const vals = [3, 5, 4, 7, 6, 9, 12];
    vals.forEach((v, i) => { ctx.fillStyle = i === vals.length - 1 ? '#f2b134' : '#3a86ff'; ctx.fillRect(16 + i * 33, h - 14 - v * 8, 22, v * 8); });
    ctx.strokeStyle = '#06d6a0'; ctx.lineWidth = 3; ctx.beginPath();
    vals.forEach((v, i) => { const x = 27 + i * 33, y = h - 24 - v * 8; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.stroke();
  });
}

function signTex(text, { bg = '#ffffff', fg = '#1d2433', w = 512, h = 96, font = 'bold 64px system-ui, sans-serif', glow = false } = {}) {
  return canvasTex(w, h, (ctx) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg; ctx.font = font; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (glow) { ctx.shadowColor = fg; ctx.shadowBlur = 12; }
    ctx.fillText(text, w / 2, h / 2 + 3);
  });
}

function texPlane(tex, w, h, { basic = false, transparent = false } = {}) {
  const material = basic ? new THREE.MeshBasicMaterial({ map: tex, transparent }) : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.5, transparent });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
}

// ---------------------------------------------------------------- the live office floor
export function buildOffice() {
  const root = new THREE.Group();
  root.name = 'office';
  const b = new Builder();
  const glass = { transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, color: '#a8d8ff', side: THREE.DoubleSide, depthWrite: false };

  // Floor (one texture for the whole plan).
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.0005;
  floor.receiveShadow = true;
  floor.name = 'floor';
  root.add(floor);

  // ---- Shell: solid back wall, glass curtain walls on the sides, a low glass rail at the front.
  b.box(W, WALL_H, 0.008, '#f3efe6', 0, 0, Z0 + 0.004);
  b.box(W + 0.012, 0.008, 0.016, '#ffffff', 0, WALL_H, Z0 + 0.004); // cornice
  for (const sx of [X0 + 0.004, X1 - 0.004]) {
    b.box(0.008, 0.01, D, '#e9edf2', sx, 0, 0); // sill
    b.box(0.01, 0.008, D + 0.012, '#ffffff', sx, WALL_H, 0); // cornice
    for (let z = Z0; z <= Z1 + 0.001; z += D / 8) b.box(0.006, WALL_H, 0.004, '#ffffff', sx, 0, Math.min(Math.max(z, Z0 + 0.003), Z1 - 0.003));
  }
  for (const [x, z] of [[X0, Z0], [X1, Z0], [X0, Z1], [X1, Z1]]) b.box(0.016, WALL_H + 0.008, 0.016, '#ffffff', x + Math.sign(-x) * 0.004, 0, z + Math.sign(-z) * 0.004);
  // front rail
  b.box(W, 0.004, 0.004, '#ffffff', 0, 0.02, Z1 - 0.002);
  for (let x = X0 + 0.06; x < X1; x += 0.12) b.box(0.003, 0.02, 0.003, '#ffffff', x, 0, Z1 - 0.002);

  // Glass panes for the side walls and front rail (transparent bucket).
  for (const sx of [X0 + 0.004, X1 - 0.004]) b.box(0.002, WALL_H - 0.01, D - 0.01, '#a8d8ff', sx, 0.01, 0, glass);
  b.box(W - 0.02, 0.018, 0.0015, '#a8d8ff', 0, 0.002, Z1 - 0.002, glass);

  // Back wall windows (look out to the city) with frames.
  for (const [x, w] of [[-0.245, 0.08], [0.29, 0.085], [0.405, 0.06]]) {
    b.box(w + 0.006, 0.042, 0.003, '#ffffff', x, 0.02, Z0 + 0.0095);
    b.box(w, 0.036, 0.002, '#9fd3f5', x, 0.023, Z0 + 0.0105, { emissive: '#6fb7e8', emissiveIntensity: 0.55, roughness: 0.1 });
    b.box(0.002, 0.036, 0.003, '#ffffff', x, 0.023, Z0 + 0.011);
  }
  // AC units, clock, pictures.
  for (const x of [-0.05, 0.4]) {
    b.box(0.05, 0.012, 0.012, '#f7f8fa', x, 0.06, Z0 + 0.014);
    b.box(0.044, 0.002, 0.001, '#b8c0cc', x, 0.063, Z0 + 0.0205);
  }
  b.at(0.075, 0.058, Z0 + 0.0095, 0, () => {
    const g = new THREE.CylinderGeometry(0.008, 0.008, 0.002, 16);
    g.rotateX(Math.PI / 2); b.add(g, '#ffffff');
    const r = new THREE.TorusGeometry(0.008, 0.0012, 6, 20); b.add(r, '#2b2d42');
    b.box(0.001, 0.006, 0.0005, '#111', 0, -0.0005, 0.0012);
    b.box(0.005, 0.001, 0.0005, '#111', 0.0025, 0, 0.0012);
  });

  // Whiteboard and a wall TV with a chart.
  const wb = texPlane(whiteboardTex(), 0.1, 0.05);
  wb.position.set(-0.05, 0.03, Z0 + 0.0095);
  root.add(wb);
  b.box(0.104, 0.003, 0.006, '#9aa3b2', -0.05, 0.004, Z0 + 0.011);
  const tv = texPlane(chartTex(), 0.08, 0.045, { basic: true });
  tv.position.set(0.16, 0.032, Z0 + 0.012);
  root.add(tv);
  b.box(0.086, 0.051, 0.004, '#1d1f24', 0.16, 0.0065, Z0 + 0.0098);

  // Big gold sign on the back wall, over the boss cabin.
  const hq = texPlane(signTex('DESKHIVE HQ', { bg: '#1d2433', fg: '#f2b134', font: 'bold 60px system-ui, sans-serif' }), 0.12, 0.022, { basic: true });
  hq.position.set(-0.33, 0.064, Z0 + 0.0095);
  root.add(hq);

  // ---- Boss cabin (Nova): glass walls, wood floor, bookshelf, sofa, plants.
  b.box(0.003, WALL_H - 0.012, 0.18, '#a8d8ff', -0.18, 0, -0.205, glass);
  b.box(0.003, WALL_H - 0.012, 0.04, '#a8d8ff', -0.18, 0, -0.05, glass);
  b.box(0.22, WALL_H - 0.012, 0.003, '#a8d8ff', X0 + 0.004 + 0.11, 0, -0.03, glass);
  b.box(0.006, WALL_H - 0.012, 0.006, '#ffffff', -0.18, 0, -0.03);
  b.box(0.006, WALL_H - 0.012, 0.006, '#ffffff', -0.18, 0, -0.115);
  b.box(0.006, WALL_H - 0.012, 0.006, '#ffffff', -0.18, 0, -0.07);
  b.box(0.29, 0.004, 0.004, '#ffffff', -0.325, WALL_H - 0.012, -0.03);
  b.box(0.004, 0.004, 0.27, '#ffffff', -0.18, WALL_H - 0.012, -0.165);
  bookshelf(b, -0.4, Z0 + 0.018, 0, 0.09, 0.062, 3);
  bookshelf(b, -0.21, Z0 + 0.018, 0, 0.04, 0.062, 9);
  sofa(b, X0 + 0.028, -0.13, Math.PI / 2, '#3a5bbf', 0.09);
  coffeeTable(b, -0.395, -0.13, 0.024, 0.04);
  plant(b, X0 + 0.02, Z0 + 0.04, 1.2, 2);
  plant(b, -0.2, -0.05, 0.9, 1);
  b.box(0.008, 0.016, 0.008, '#d9a441', -0.27, 0.03, -0.185, { metalness: 0.7, roughness: 0.3 }); // trophy on the boss desk
  b.ball(0.006, '#d9a441', -0.27, 0.05, -0.185, 8, { metalness: 0.7, roughness: 0.3 });

  // ---- Workspace: cubicle walls, drawers, desk clutter.
  const deskProps = ['lamp', 'plant', 'papers', 'books', 'lamp', 'plant', 'papers', 'books', 'plant'];
  Object.entries(SEATS).filter(([id]) => id !== 'boss').forEach(([id, s], i) => {
    b.at(s.x, 0, s.z, 0, () => {
      for (const side of [-1, 1]) {
        b.box(0.003, 0.034, 0.088, '#8fa3b8', side * 0.048, 0, -0.006);
        b.box(0.0045, 0.002, 0.09, '#e9edf2', side * 0.048, 0.034, -0.006);
      }
      b.box(0.014, 0.022, 0.03, '#d6dbe3', 0.025, 0, 0.012); // drawer pedestal
      b.box(0.012, 0.0008, 0.0005, '#7a8597', 0.025, 0.014, 0.0272);
      bin(b, -0.038, -0.045);
      const prop = deskProps[i % deskProps.length];
      if (prop === 'lamp') { b.cyl(0.004, 0.004, 0.002, '#2b2d42', -0.03, 0.03, 0.006, 8); b.cyl(0.001, 0.001, 0.014, '#2b2d42', -0.03, 0.032, 0.006, 5); b.cyl(0.002, 0.005, 0.005, '#f2b134', -0.026, 0.044, 0.006, 8, { emissive: '#ffd166', emissiveIntensity: 0.4 }); }
      if (prop === 'plant') plant(b, -0.03, 0.006, 0.45, 1);
      if (prop === 'papers') { b.box(0.012, 0.004, 0.016, '#ffffff', -0.026, 0.03, 0.002); b.box(0.012, 0.001, 0.016, '#ffd166', -0.025, 0.034, 0.003); }
      if (prop === 'books') { b.box(0.016, 0.003, 0.011, '#c1121f', -0.026, 0.03, 0.004); b.box(0.015, 0.003, 0.01, '#3a86ff', -0.026, 0.033, 0.004); }
    });
  });
  // Printer corner and plants in the workspace.
  plant(b, -0.16, Z0 + 0.03, 1.1, 0);
  plant(b, 0.335, Z0 + 0.03, 1.0, 2);
  plant(b, 0.02, 0.255, 0.9, 1);
  plant(b, 0.2, 0.255, 0.9, 1);

  // ---- Task inbox room (front left): the sorting table where task cards lie.
  b.box(TRAY.w + 0.012, 0.004, TRAY.d + 0.012, '#c49a6c', TRAY.x, TRAY.y - 0.004, TRAY.z);
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(0.006, TRAY.y - 0.004, 0.006, '#5b4636', TRAY.x + lx * (TRAY.w / 2 - 0.006), 0, TRAY.z + lz * (TRAY.d / 2 - 0.006));
  copier(b, X0 + 0.024, 0.0, Math.PI / 2);
  filing(b, -0.395, -0.016, 0);
  filing(b, -0.37, -0.016, 0);
  waterCooler(b, -0.33, -0.018);
  plant(b, -0.2, -0.01, 0.9, 0);
  plant(b, X0 + 0.02, Z1 - 0.025, 1.0, 1);
  const inbox = texPlane(signTex('TASK INBOX', { bg: '#f2b134', fg: '#1a1405', font: 'bold 62px system-ui, sans-serif' }), 0.09, 0.017, { basic: true });
  inbox.position.set(-0.27, 0.05, -0.0285);
  root.add(inbox);
  const tray = new THREE.Mesh(new THREE.BoxGeometry(TRAY.w, 0.002, TRAY.d), new THREE.MeshStandardMaterial({ color: '#41495a', roughness: 0.9 }));
  tray.position.set(TRAY.x, TRAY.y + 0.001, TRAY.z);
  tray.receiveShadow = true;
  tray.name = 'tray';
  root.add(tray);
  const trayLabel = makeLabelPlane('pinch a card, drop it on a desk', 0.2, 0.014, '#ffffff', 'rgba(0,0,0,0)');
  trayLabel.rotation.x = -Math.PI / 2;
  trayLabel.position.set(TRAY.x, TRAY.y + 0.0025, TRAY.z + TRAY.d / 2 - 0.01);
  root.add(trayLabel);

  // ---- Lounge and kitchen (right strip).
  counter(b, 0.398, Z0 + 0.021, 0, 0.1);
  fridge(b, X1 - 0.022, -0.235, -Math.PI / 2);
  vending(b, X1 - 0.022, -0.16, -Math.PI / 2);
  waterCooler(b, X1 - 0.016, -0.105);
  cafeTable(b, 0.4, -0.04);
  sofa(b, X1 - 0.026, 0.19, -Math.PI / 2, '#3a5bbf', 0.1);
  armchair(b, 0.37, 0.27, Math.PI * 0.85, '#f2b134');
  coffeeTable(b, 0.4, 0.19, 0.022, 0.04);
  plant(b, 0.36, 0.1, 0.9, 0);
  plant(b, X1 - 0.02, Z1 - 0.02, 1.1, 2);
  const cafe = texPlane(signTex('CAFE', { bg: '#2a9d8f', fg: '#ffffff', w: 256, font: 'bold 60px system-ui, sans-serif' }), 0.04, 0.015, { basic: true });
  cafe.position.set(0.4, 0.062, Z0 + 0.0095);
  root.add(cafe);

  root.add(b.build());

  // Desks (dynamic parts: screens, LEDs, rings, hire markers).
  const desks = new Map();
  for (const [id, seat] of Object.entries(SEATS)) {
    const d = buildDesk({ ...seat, id });
    root.add(d.group);
    desks.set(id, { ...d, seat });
  }
  return { root, desks };
}

// ---------------------------------------------------------------- the building under the live floor
export function buildBuilding() {
  const g = new THREE.Group();
  g.name = 'building';
  const b = new Builder();
  const IN = 0.008; // facade inset from the slab edge
  const FW = W - IN * 2, FD = D - IN * 2;

  // Slabs (white bands like a modern tower).
  b.box(W + 0.012, 0.016, D + 0.012, '#f4f6f8', 0, -0.016, 0);
  b.box(W + 0.008, 0.012, D + 0.008, '#f4f6f8', 0, -0.113, 0);
  // Corner columns.
  for (const [x, z] of [[X0, Z0], [X1, Z0], [X0, Z1], [X1, Z1]]) b.box(0.02, -0.016 - PLOT_Y, 0.02, '#ffffff', x + Math.sign(-x) * 0.004, PLOT_Y, z + Math.sign(-z) * 0.004);
  // Core behind the facades.
  b.box(FW - 0.004, -0.016 - PLOT_Y, FD - 0.004, '#22324a', 0, PLOT_Y, 0);

  // Storey 2 facades on all four sides.
  const tex2 = windowStrip(11);
  const h2 = 0.085, y2 = -0.016 - h2 / 2;
  const addFacade = (tex, y, h, faces) => {
    for (const f of faces) {
      const len = f.axis === 'x' ? FW : FD;
      const p = facadePlane(tex, len, h);
      p.position.set(f.x, y, f.z);
      p.rotation.y = f.ry;
      g.add(p);
    }
  };
  const sides = [
    { axis: 'x', x: 0, z: FD / 2, ry: 0 },
    { axis: 'x', x: 0, z: -FD / 2, ry: Math.PI },
    { axis: 'z', x: FW / 2, z: 0, ry: Math.PI / 2 },
    { axis: 'z', x: -FW / 2, z: 0, ry: -Math.PI / 2 },
  ];
  addFacade(tex2, y2, h2, sides);

  // Lobby storey: glass on the back and sides, an entrance on the front.
  const texL = windowStrip(23, { lobby: true });
  const hL = -0.113 - PLOT_Y, yL = PLOT_Y + hL / 2;
  addFacade(texL, yL, hL, sides.slice(1));
  // Front: two glass wings and a recessed entrance.
  const doorW = 0.16;
  const wingW = (FW - doorW) / 2;
  for (const s of [-1, 1]) {
    const p = facadePlane(texL, wingW, hL);
    p.position.set(s * (doorW / 2 + wingW / 2), yL, FD / 2);
    g.add(p);
  }
  const doorTex = canvasTex(256, 96, (ctx, w, h) => {
    const gr = ctx.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#ffe7a8'); gr.addColorStop(1, '#f2c66b');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#8a5c35'; ctx.fillRect(70, 52, 116, 30); // reception desk
    ctx.fillStyle = '#f2b134'; ctx.fillRect(70, 48, 116, 6);
    ctx.fillStyle = '#2b2d42'; ctx.fillRect(120, 30, 14, 22); ctx.fillRect(122, 22, 10, 9); // receptionist
    ctx.fillStyle = 'rgba(80,160,220,0.35)'; ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#e9edf2';
    for (const x of [0, 64, 128, 192, 252]) ctx.fillRect(x, 0, 4, h);
    ctx.fillRect(0, 0, w, 4);
  });
  const door = texPlane(doorTex, doorW, hL - 0.004);
  door.position.set(0, yL - 0.002, FD / 2 - 0.03);
  g.add(door);
  b.box(doorW, hL, 0.03, '#22324a', 0, PLOT_Y, FD / 2 - 0.045); // recess back
  for (const s of [-1, 1]) b.box(0.006, hL, 0.032, '#f4f6f8', s * doorW / 2, PLOT_Y, FD / 2 - 0.014);
  // Canopy and sign.
  b.box(doorW + 0.05, 0.006, 0.06, '#f4f6f8', 0, -0.15, FD / 2 + 0.01);
  for (const s of [-1, 1]) b.cyl(0.0025, 0.0025, -0.15 - PLOT_Y, '#c0c6d0', s * (doorW / 2 + 0.018), PLOT_Y, FD / 2 + 0.036, 6);
  const sign = texPlane(signTex('DESKHIVE', { bg: '#1d2433', fg: '#f2b134', glow: true }), doorW + 0.04, 0.02, { basic: true });
  sign.position.set(0, -0.137, FD / 2 + 0.0405);
  g.add(sign);
  b.box(doorW + 0.044, 0.024, 0.004, '#1d2433', 0, -0.149, FD / 2 + 0.038);
  // Blade sign on the corner.
  const blade = texPlane(signTex('HQ', { bg: '#f2b134', fg: '#1d2433', w: 128, h: 128, font: 'bold 80px system-ui, sans-serif' }), 0.03, 0.03, { basic: true });
  blade.position.set(X1 + 0.012, -0.06, Z1 - 0.03);
  blade.rotation.y = Math.PI / 2;
  g.add(blade);
  blade.material.side = THREE.DoubleSide;

  // ---- Plot: sidewalk, grass, path, steps, trees, lamps, benches, flags.
  const PW = 1.3, PD = 1.0, PZ = 0.06;
  b.box(PW, 0.016, PD, '#c9cdd3', 0, PLOT_Y - 0.016, PZ);
  const grass = '#7cc36a';
  // Grass beds around the building, leaving a front plaza and a path.
  b.box(PW - 0.06, 0.004, 0.17, grass, 0, PLOT_Y, Z0 - 0.105); // back
  b.box(0.13, 0.004, D + 0.03, grass, X0 - 0.085, PLOT_Y, 0); // left
  b.box(0.13, 0.004, D + 0.03, grass, X1 + 0.085, PLOT_Y, 0); // right
  for (const s of [-1, 1]) b.box(0.42, 0.004, 0.2, grass, s * 0.39, PLOT_Y, Z1 + 0.12);
  // Path and steps to the door.
  b.box(0.2, 0.002, 0.24, '#e4ded2', 0, PLOT_Y, Z1 + 0.11);
  for (let i = 0; i < 3; i++) b.box(doorW + 0.02, 0.004 * (3 - i), 0.012, '#f4f6f8', 0, PLOT_Y, FD / 2 + 0.006 + i * 0.012);
  // Bushes hugging the facade.
  for (let x = X0 + 0.04; x < X1 - 0.02; x += 0.07) {
    if (Math.abs(x) < 0.12) continue;
    b.ball(0.018, '#4f9f45', x, PLOT_Y + 0.012, Z1 + 0.025, 7, { flatShading: true });
  }
  for (let z = Z0 + 0.05; z < Z1; z += 0.08) {
    b.ball(0.016, '#4f9f45', X0 - 0.03, PLOT_Y + 0.011, z, 7, { flatShading: true });
    b.ball(0.016, '#4f9f45', X1 + 0.03, PLOT_Y + 0.011, z, 7, { flatShading: true });
  }
  // Round trees like a model city.
  const tree = (x, z, s = 1) => {
    b.cyl(0.004 * s, 0.005 * s, 0.05 * s, '#7a5230', x, PLOT_Y, z, 6);
    b.ball(0.035 * s, '#5cb85c', x, PLOT_Y + 0.07 * s, z, 9, { flatShading: true });
    b.ball(0.024 * s, '#6fcf6a', x + 0.012 * s, PLOT_Y + 0.088 * s, z + 0.006 * s, 8, { flatShading: true });
  };
  for (const [x, z, s] of [[-0.56, -0.3, 1.2], [0.56, -0.28, 1.1], [-0.56, 0.12, 1], [0.57, 0.08, 1.15], [-0.42, 0.47, 1], [0.44, 0.48, 1.1], [-0.2, -0.37, 0.9], [0.2, -0.38, 1]]) tree(x, z, s);
  // Lamps along the plaza.
  for (const x of [-0.14, 0.14]) {
    b.cyl(0.0018, 0.0022, 0.07, '#2b2d42', x, PLOT_Y, Z1 + 0.2, 6);
    b.ball(0.006, '#fff3c4', x, PLOT_Y + 0.072, Z1 + 0.2, 8, { emissive: '#ffe08a', emissiveIntensity: 1.2 });
  }
  // Benches.
  for (const s of [-1, 1]) {
    b.at(s * 0.24, PLOT_Y, Z1 + 0.18, 0, () => {
      b.box(0.05, 0.003, 0.014, '#a8744a', 0, 0.01, 0);
      b.box(0.05, 0.01, 0.003, '#a8744a', 0, 0.013, -0.006);
      for (const lx of [-0.02, 0.02]) b.box(0.003, 0.01, 0.012, '#2b2d42', lx, 0, 0);
    });
  }
  // Flags.
  ['#3a86ff', '#f2b134', '#06d6a0'].forEach((c, i) => {
    const x = 0.12 + i * 0.03;
    b.cyl(0.0012, 0.0012, 0.11, '#e9edf2', x, PLOT_Y, Z1 + 0.06, 5);
    b.box(0.022, 0.014, 0.001, c, x + 0.011, PLOT_Y + 0.094, Z1 + 0.06);
  });
  // A parked scooter and a planter for charm.
  b.box(0.06, 0.016, 0.02, '#8a8f99', -0.15, PLOT_Y, Z1 + 0.06);
  b.at(0, PLOT_Y + 0.016, 0, 0, () => { plant(b, -0.17, Z1 + 0.06, 0.8, 0); plant(b, -0.13, Z1 + 0.06, 0.8, 1); });

  g.add(b.build());
  return g;
}

// ---------------------------------------------------------------- the city around it (VR and laptop, not passthrough)
export function buildCity() {
  const g = new THREE.Group();
  g.name = 'city';
  g.position.y = PLOT_Y - 0.016;
  const b = new Builder();

  // Ground, roads, sidewalks.
  const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshStandardMaterial({ color: '#8fc97a', roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.002;
  ground.receiveShadow = true;
  g.add(ground);
  const asphalt = '#3d4250';
  b.box(18, 0.002, 0.26, asphalt, 0, 0, 0.72); // front street (under the viewer)
  b.box(18, 0.002, 0.26, asphalt, 0, 0, -0.72);
  b.box(0.26, 0.002, 18, asphalt, -0.95, 0, 0);
  b.box(0.26, 0.002, 18, asphalt, 0.95, 0, 0);
  for (const z of [0.72, -0.72]) for (let x = -8.8; x < 9; x += 0.16) b.box(0.08, 0.003, 0.008, '#f4f6f8', x, 0, z);
  for (const x of [0.95, -0.95]) for (let z = -8.8; z < 9; z += 0.16) if (Math.abs(z) > 0.85) b.box(0.008, 0.003, 0.08, '#f4f6f8', x, 0, z);
  // Zebra crossings near the HQ.
  for (let i = 0; i < 6; i++) b.box(0.02, 0.003, 0.2, '#f4f6f8', -0.06 + i * 0.026, 0, 0.72);
  // Sidewalk rims.
  for (const z of [0.58, -0.58, 0.86, -0.86]) b.box(18, 0.012, 0.03, '#c9cdd3', 0, 0, z);

  // Surrounding towers. Front (where the viewer sits) stays open.
  const r = rand(5);
  const towers = [];
  const spots = [];
  for (let x = -4.5; x <= 4.5; x += 0.55) for (let z = -4.5; z <= 4.5; z += 0.55) {
    if (Math.abs(x) < 1.25 && z > -1.0 && z < 1.4) continue; // HQ block and the viewer
    if (Math.abs(z - 0.72) < 0.32 || Math.abs(z + 0.72) < 0.32 || Math.abs(x - 0.95) < 0.3 || Math.abs(x + 0.95) < 0.3) continue;
    if (z > 0.9 && Math.abs(x) < 2.2) continue; // keep the view behind the user low
    if (r() < 0.45) continue;
    spots.push([x + (r() - 0.5) * 0.12, z + (r() - 0.5) * 0.12]);
  }
  const tints = [
    windowStrip(101, { top: '#7cc0ea', bottom: '#3b7fc4', lit: 0.2 }),
    windowStrip(202, { top: '#7fd1c7', bottom: '#2a8c8f', frame: '#f4f1ea', lit: 0.15 }),
    windowStrip(303, { top: '#e8d9bf', bottom: '#c9b28c', frame: '#8a6d4f', lit: 0.25 }),
  ];
  const geoms = [[], [], []];
  for (const [x, z] of spots) {
    const dist = Math.hypot(x, z);
    const h = 0.2 + r() * (dist < 2 ? 0.5 : 1.2) + (dist > 3 ? 0.3 : 0);
    const w = 0.22 + r() * 0.2, d = 0.22 + r() * 0.2;
    const geo = new THREE.BoxGeometry(w, h, d);
    // Scale UVs so windows keep their size on every face.
    const uv = geo.attributes.uv;
    const faceW = [d, d, w, w, w, w];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (f === 2 || f === 3) { uv.setXY(i, 0.01, 0.5); continue; } // roof and bottom: flat color pixel
      uv.setXY(i, uv.getX(i) * faceW[f] / 0.46, uv.getY(i) * h / 0.08);
    }
    geo.translate(x, h / 2, z);
    const t = Math.floor(r() * 3);
    geoms[t].push(geo);
    towers.push({ x, z, w, d, h });
    // Roof details.
    b.box(w + 0.01, 0.01, d + 0.01, '#e9edf2', x, h, z);
    if (r() < 0.5) b.box(w * 0.4, 0.03, d * 0.4, '#b8c0cc', x, h + 0.01, z);
    if (r() < 0.25) b.cyl(0.003, 0.003, 0.12, '#c0c6d0', x + w * 0.2, h + 0.01, z, 5);
  }
  geoms.forEach((list, i) => {
    if (!list.length) return;
    const mesh = new THREE.Mesh(mergeGeometries(list, false), new THREE.MeshStandardMaterial({ map: tints[i], roughness: 0.35, metalness: 0.1 }));
    list.forEach(x => x.dispose());
    g.add(mesh);
  });
  // Street trees and cars.
  for (let x = -8; x < 8; x += 0.4) {
    if (Math.abs(x) < 0.7) continue;
    for (const z of [0.52, -0.52]) {
      b.cyl(0.004, 0.005, 0.04, '#7a5230', x, 0, z, 5);
      b.ball(0.03, '#5cb85c', x, 0.06, z, 7, { flatShading: true });
    }
  }
  const carColors = ['#ef476f', '#3a86ff', '#ffd166', '#f4f6f8', '#06d6a0', '#2b2d42'];
  for (let i = 0; i < 14; i++) {
    const along = (r() - 0.5) * 12;
    const lane = r() < 0.5 ? 1 : -1;
    const onX = r() < 0.6;
    const c = carColors[Math.floor(r() * carColors.length)];
    const [x, z, ry] = onX ? [along, (r() < 0.5 ? 0.72 : -0.72) + lane * 0.055, 0] : [(r() < 0.5 ? 0.95 : -0.95) + lane * 0.055, along, Math.PI / 2];
    if (Math.abs(x) < 1.2 && Math.abs(z) < 1.2 && onX && z > 0) continue;
    b.at(x, 0, z, ry, () => {
      b.box(0.09, 0.022, 0.042, c, 0, 0.006, 0);
      b.box(0.05, 0.016, 0.038, '#2b3a55', -0.004, 0.028, 0);
      for (const wx of [-0.03, 0.03]) for (const wz of [-0.021, 0.021]) b.cyl(0.008, 0.008, 0.006, '#111', wx, 0.0, wz, 8);
    });
  }
  g.add(b.build({ shadows: false }));
  return g;
}
