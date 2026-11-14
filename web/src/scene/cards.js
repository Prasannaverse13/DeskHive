// Task cards on the tray. Pinch one, carry it over a desk, let go to assign.

import * as THREE from 'three';
import { TRAY } from './office.js';
import { rr, wrap } from './panel.js';

const CARD_W = 0.105;
const CARD_H = 0.042;

function drawCard(card, task, highlight = false) {
  const { ctx, canvas } = card;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  rr(ctx, 4, 4, canvas.width - 8, canvas.height - 8, 18);
  ctx.fillStyle = highlight ? '#fff7c2' : '#fffdf5';
  ctx.fill();
  ctx.lineWidth = 6; ctx.strokeStyle = highlight ? '#f2b134' : '#d6cfb8'; ctx.stroke();
  ctx.fillStyle = '#f2b134';
  ctx.fillRect(4, 4, 16, canvas.height - 8);
  ctx.fillStyle = '#8a6d1f';
  ctx.font = 'bold 26px system-ui, sans-serif';
  ctx.fillText(task.key || 'TASK', 34, 36);
  ctx.fillStyle = '#1b1b1b';
  ctx.font = '600 32px system-ui, sans-serif';
  const lines = wrap(ctx, task.title, canvas.width - 50).slice(0, 2);
  lines.forEach((l, i) => ctx.fillText(l, 34, 76 + i * 36));
  card.tex.needsUpdate = true;
}

export class CardTray {
  constructor(parent) {
    this.parent = parent;
    this.cards = new Map(); // taskId -> card
    this.group = new THREE.Group();
    parent.add(this.group);
  }

  makeCard(task) {
    const canvas = document.createElement('canvas');
    canvas.width = 420; canvas.height = 168;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(CARD_W, CARD_H, 0.002), [
      new THREE.MeshStandardMaterial({ color: '#e8e2cf' }), new THREE.MeshStandardMaterial({ color: '#e8e2cf' }),
      new THREE.MeshStandardMaterial({ color: '#e8e2cf' }), new THREE.MeshStandardMaterial({ color: '#e8e2cf' }),
      new THREE.MeshBasicMaterial({ map: tex }), new THREE.MeshStandardMaterial({ color: '#d6cfb8' }),
    ]);
    mesh.castShadow = true;
    mesh.rotation.x = -Math.PI / 2;
    mesh.userData.kind = 'card';
    mesh.userData.taskId = task.id;
    const card = { task, mesh, canvas, ctx, tex, grabbed: false, home: new THREE.Vector3(), target: new THREE.Vector3(), hover: false };
    drawCard(card, task);
    this.group.add(mesh);
    return card;
  }

  sync(backlog) {
    const ids = new Set(backlog.map(t => t.id));
    for (const [id, card] of this.cards) {
      if (!ids.has(id) && !card.grabbed) {
        this.group.remove(card.mesh);
        card.mesh.geometry.dispose();
        this.cards.delete(id);
      }
    }
    for (const t of backlog) {
      if (!this.cards.has(t.id)) {
        const c = this.makeCard(t);
        this.cards.set(t.id, c);
        c.mesh.position.set(TRAY.x, 0.2, TRAY.z); // drops in from above
      }
    }
    this.layout();
  }

  layout() {
    const list = [...this.cards.values()].filter(c => !c.grabbed);
    const cols = 2;
    list.forEach((c, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const stack = Math.floor(row / 3);
      const r = row % 3;
      c.home.set(TRAY.x - 0.057 + col * 0.114, TRAY.y + 0.003 + stack * 0.003, TRAY.z - TRAY.d / 2 + 0.03 + r * 0.05);
    });
  }

  meshes() { return [...this.cards.values()].map(c => c.mesh); }
  byMesh(mesh) { return this.cards.get(mesh.userData.taskId); }

  setHover(card) {
    for (const c of this.cards.values()) {
      const h = c === card;
      if (c.hover !== h) { c.hover = h; drawCard(c, c.task, h); }
    }
  }

  tick(dt) {
    for (const c of this.cards.values()) {
      if (c.grabbed) {
        c.mesh.position.lerp(c.target, Math.min(1, dt * 25));
        c.mesh.rotation.x = THREE.MathUtils.lerp(c.mesh.rotation.x, -0.5, Math.min(1, dt * 10));
      } else {
        c.mesh.position.lerp(c.home, Math.min(1, dt * 8));
        c.mesh.rotation.x = THREE.MathUtils.lerp(c.mesh.rotation.x, -Math.PI / 2, Math.min(1, dt * 8));
      }
    }
  }
}
