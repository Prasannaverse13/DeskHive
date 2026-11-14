// Things you unlock by shipping work. Each office level adds one you can see.
//   2 trophy on Nova's desk   3 neon sign   4 rooftop garden   5 delivery drone   6 helipad + city lights

import * as THREE from 'three';
import { SEATS } from './office.js';
import { W, D } from './building.js';

const m = (color, opts = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, ...opts });

function neonTexture(text) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 128;
  const ctx = c.getContext('2d');
  ctx.fillStyle = 'rgba(10,12,24,0.85)';
  ctx.fillRect(0, 0, 512, 128);
  ctx.font = 'bold 76px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = '#ff4fd8';
  ctx.shadowBlur = 24;
  ctx.fillStyle = '#ffd6f6';
  ctx.fillText(text, 256, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Perks {
  constructor(world, city) {
    this.city = city;
    this.level = 1;
    this.items = new Map();
    this.pop = new Map(); // level -> seconds since it appeared (for a little pop animation)

    // 2: gold trophy
    const trophy = new THREE.Group();
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.006, 0.02, 16), m('#f2b134', { metalness: 0.8, roughness: 0.25, emissive: '#5a3a00' }));
    cup.position.y = 0.03;
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.012, 8), cup.material);
    stem.position.y = 0.014;
    const base = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.008, 0.018), m('#3b2a1a'));
    base.position.y = 0.004;
    trophy.add(cup, stem, base);
    trophy.position.set(SEATS.boss.x + 0.06, 0.045, SEATS.boss.z - 0.02);
    this.items.set(2, trophy);

    // 3: neon sign floating behind the office
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.075), new THREE.MeshBasicMaterial({ map: neonTexture('DESKHIVE'), transparent: true, toneMapped: false }));
    sign.position.set(0, 0.16, -D / 2 - 0.01);
    this.items.set(3, sign);

    // 4: planters with little trees on the four corners
    const garden = new THREE.Group();
    for (const [x, z] of [[-W / 2 + 0.03, -D / 2 + 0.03], [W / 2 - 0.03, -D / 2 + 0.03], [-W / 2 + 0.03, D / 2 - 0.03], [W / 2 - 0.03, D / 2 - 0.03]]) {
      const pot = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.02, 0.03), m('#8a5c35'));
      pot.position.set(x, 0.01, z);
      const tree = new THREE.Mesh(new THREE.IcosahedronGeometry(0.022, 0), m('#3fa34d', { flatShading: true }));
      tree.position.set(x, 0.045, z);
      garden.add(pot, tree);
    }
    this.items.set(4, garden);

    // 5: a drone that circles the office
    const drone = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.008, 0.03), m('#2b2d42'));
    drone.add(body);
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const rotor = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.002, 12), m('#8ecae6', { transparent: true, opacity: 0.6 }));
      rotor.position.set(x * 0.017, 0.006, z * 0.017);
      drone.add(rotor);
    }
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.012, 0.012), m('#f2b134'));
    box.position.y = -0.012;
    drone.add(box);
    this.drone = drone;
    this.items.set(5, drone);

    // 6: helipad hovering above the office
    const pad = new THREE.Group();
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.004, 32), m('#3a3f4b'));
    const hTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const x = c.getContext('2d');
      x.strokeStyle = '#ffd166'; x.lineWidth = 8; x.beginPath(); x.arc(64, 64, 54, 0, Math.PI * 2); x.stroke();
      x.fillStyle = '#fff'; x.font = 'bold 72px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('H', 64, 68);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.058, 32), new THREE.MeshBasicMaterial({ map: hTex, transparent: true }));
    top.rotation.x = -Math.PI / 2;
    top.position.y = 0.0025;
    pad.add(disc, top);
    pad.position.set(W / 2 - 0.08, 0.2, -D / 2 + 0.08);
    this.items.set(6, pad);

    for (const [lvl, obj] of this.items) { obj.visible = false; obj.userData.perk = lvl; world.add(obj); }
  }

  setLevel(level) {
    if (level === this.level && this.items.get(2)?.visible === (level >= 2)) return;
    for (const [lvl, obj] of this.items) {
      const on = level >= lvl;
      if (on && !obj.visible) this.pop.set(lvl, 0);
      obj.visible = on;
    }
    // Level 6: the city at night, windows on.
    if (this.city) this.city.traverse(o => { if (o.isMesh && o.material?.emissive) o.material.emissiveIntensity = level >= 6 ? 0.35 : (o.userData.baseEmissive ?? o.material.emissiveIntensity); });
    this.level = level;
  }

  tick(dt, t) {
    for (const [lvl, age] of this.pop) {
      const obj = this.items.get(lvl);
      const a = age + dt;
      const s = a < 0.6 ? 1 + Math.sin((a / 0.6) * Math.PI) * 0.6 : 1;
      obj.scale.setScalar(s);
      if (a > 0.6) this.pop.delete(lvl); else this.pop.set(lvl, a);
    }
    if (this.drone.visible) {
      const r = 0.42;
      this.drone.position.set(Math.cos(t * 0.5) * r, 0.14 + Math.sin(t * 1.3) * 0.01, Math.sin(t * 0.5) * r * 0.75);
      this.drone.rotation.y = -t * 0.5;
      for (const c of this.drone.children) if (c.geometry?.type === 'CylinderGeometry') c.rotation.y += dt * 40;
    }
    const sign = this.items.get(3);
    if (sign.visible) sign.material.opacity = 0.85 + Math.sin(t * 7) * 0.05 + (Math.random() < 0.01 ? -0.4 : 0);
  }
}
