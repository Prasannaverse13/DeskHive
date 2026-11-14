// Envelopes that fly desk to desk when agents message each other.

import * as THREE from 'three';

const ACT_COLOR = { request: '#ffd166', query: '#8ecae6', inform: '#ffffff', done: '#06d6a0', agree: '#06d6a0', refuse: '#ef476f' };

export class Envelopes {
  constructor(parent) {
    this.parent = parent;
    this.live = [];
    this.geo = new THREE.BoxGeometry(0.026, 0.004, 0.018);
    this.sealGeo = new THREE.BoxGeometry(0.007, 0.0045, 0.007);
  }

  send(from, to, act) {
    if (!from || !to) return;
    const g = new THREE.Group();
    const env = new THREE.Mesh(this.geo, new THREE.MeshStandardMaterial({ color: ACT_COLOR[act] || '#fff', emissive: ACT_COLOR[act] || '#fff', emissiveIntensity: 0.35 }));
    const seal = new THREE.Mesh(this.sealGeo, new THREE.MeshBasicMaterial({ color: '#c1121f' }));
    seal.position.y = 0.0005;
    g.add(env, seal);
    g.position.copy(from);
    this.parent.add(g);
    const dist = from.distanceTo(to);
    this.live.push({ g, from: from.clone(), to: to.clone(), t: 0, dur: 0.8 + dist * 1.6, h: 0.08 + dist * 0.25 });
  }

  tick(dt) {
    for (let i = this.live.length - 1; i >= 0; i--) {
      const e = this.live[i];
      e.t += dt / e.dur;
      const t = Math.min(1, e.t);
      const p = new THREE.Vector3().lerpVectors(e.from, e.to, t);
      p.y += Math.sin(Math.PI * t) * e.h;
      e.g.position.copy(p);
      e.g.rotation.y += dt * 6;
      e.g.rotation.z = Math.sin(t * Math.PI * 4) * 0.3;
      if (t >= 1) {
        e.g.scale.multiplyScalar(0.8);
        if (e.g.scale.x < 0.2) { this.parent.remove(e.g); this.live.splice(i, 1); }
      }
    }
  }
}
