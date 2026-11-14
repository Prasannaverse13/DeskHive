// A flat 3D panel drawn with canvas 2D. Buttons can be pinched (ray) or poked (fingertip).

import * as THREE from 'three';

export function wrap(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width > maxW && line) { out.push(line); line = word; } else line = test;
    }
    out.push(line);
  }
  return out;
}

export function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// A short click so hands get feedback without haptics.
let audioCtx = null;
export function clickSound(pitch = 880, len = 0.05, vol = 0.08) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(pitch, t);
    o.frequency.exponentialRampToValueAtTime(pitch * 0.6, t + len);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g).connect(audioCtx.destination);
    o.start(t);
    o.stop(t + len + 0.01);
  } catch { /* no audio */ }
}

export class Panel3D {
  static hc = false; // high contrast for everyone
  constructor({ width, height, ppm = 1800, onPress = null, name = 'panel' }) {
    this.width = width; this.height = height;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(width * ppm);
    this.canvas.height = Math.round(height * ppm);
    this.ctx = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, side: THREE.DoubleSide }));
    this.mesh.name = name;
    this.mesh.userData.panel = this;
    this.buttons = [];
    this.hover = null;
    this.pressed = null;
    this.pressedAt = 0;
    this.onPress = onPress;
    this.drawFn = null;
    this.pokeState = new Map();
  }

  setDraw(fn) { this.drawFn = fn; this.redraw(); }

  redraw() {
    if (!this.drawFn) return;
    const { ctx, canvas } = this;
    this.buttons = [];
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.drawFn(ctx, canvas.width, canvas.height, this);
    this.tex.needsUpdate = true;
  }

  // Draw a button and register its hit rect (canvas pixels).
  button(id, x, y, w, h, label, { bg = '#2d3348', fg = '#fff', accent = null, font = null } = {}) {
    const { ctx } = this;
    const isHover = this.hover === id;
    const isPressed = this.pressed === id && performance.now() - this.pressedAt < 250;
    if (Panel3D.hc) { bg = '#000000'; fg = '#ffffff'; accent = '#ffe600'; }
    rr(ctx, x, y, w, h, Math.min(24, h / 3));
    ctx.fillStyle = isPressed ? '#ffffff' : isHover ? (accent || '#4a5578') : bg;
    ctx.fill();
    if (accent) { ctx.lineWidth = 5; ctx.strokeStyle = accent; ctx.stroke(); }
    ctx.fillStyle = isPressed ? '#111' : fg;
    ctx.font = font || `600 ${Math.round(h * 0.42)}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, x + w / 2, y + h / 2 + 2);
    ctx.textAlign = 'left';
    this.buttons.push({ id, x, y, w, h });
  }

  // Where a button is, in world space (for pointers and the coach arrow).
  buttonWorld(id, out = new THREE.Vector3()) {
    const b = this.buttons.find(x => x.id === id);
    if (!b) return null;
    const lx = ((b.x + b.w / 2) / this.canvas.width - 0.5) * this.width;
    const ly = (0.5 - (b.y + b.h / 2) / this.canvas.height) * this.height;
    return this.mesh.localToWorld(out.set(lx, ly, 0));
  }

  hitUv(uv) {
    if (!uv) return null;
    const px = uv.x * this.canvas.width;
    const py = (1 - uv.y) * this.canvas.height;
    return this.buttons.find(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h)?.id || null;
  }

  setHover(id) { if (this.hover !== id) { this.hover = id; this.redraw(); } }

  press(id) {
    if (!id) return;
    this.pressed = id; this.pressedAt = performance.now();
    clickSound();
    this.redraw();
    setTimeout(() => this.redraw(), 260);
    this.onPress?.(id);
  }

  // Poke with a fingertip. Fires on the frame the tip crosses the panel surface.
  poke(key, worldPos) {
    if (!this.mesh.visible) return false;
    const local = this.mesh.worldToLocal(worldPos.clone());
    const inside = Math.abs(local.x) < this.width / 2 && Math.abs(local.y) < this.height / 2;
    const prev = this.pokeState.get(key);
    const front = local.z > 0.006;
    const touching = inside && local.z <= 0.006 && local.z > -0.02;
    let fired = false;
    if (touching && prev === 'front') {
      const uv = new THREE.Vector2(local.x / this.width + 0.5, local.y / this.height + 0.5);
      const id = this.hitUv(uv);
      if (id) { this.press(id); fired = true; }
    }
    if (inside && front) this.setHover(this.hitUv(new THREE.Vector2(local.x / this.width + 0.5, local.y / this.height + 0.5)));
    this.pokeState.set(key, front ? 'front' : touching ? 'touch' : 'away');
    return fired;
  }
}
