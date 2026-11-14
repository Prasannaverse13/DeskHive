// Keys and endpoints for every brain. Env vars win over the saved file.
// Saved to deskhive.config.json in the project root (git ignored). Keys never leave the server.

import fs from 'node:fs';
import path from 'node:path';
import { PROVIDERS } from '../../shared/protocol.js';

export class BrainConfig {
  constructor(root) {
    this.file = path.join(root, 'deskhive.config.json');
    this.data = { keys: {}, baseUrls: {} };
    try { this.data = { keys: {}, baseUrls: {}, ...JSON.parse(fs.readFileSync(this.file, 'utf8')) }; } catch { /* first run */ }
  }

  save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2));
    try { fs.chmodSync(this.file, 0o600); } catch { /* windows */ }
  }

  key(providerId) {
    const p = PROVIDERS.find(x => x.id === providerId);
    if (!p || !p.keyName) return '';
    for (const name of [p.keyName, ...(p.keyAliases || [])]) if (process.env[name]) return process.env[name];
    return this.data.keys[providerId] || '';
  }

  baseUrl(providerId) {
    const p = PROVIDERS.find(x => x.id === providerId);
    const env = process.env[`${providerId.toUpperCase()}_BASE_URL`];
    return (env || this.data.baseUrls[providerId] || p?.baseUrl || '').replace(/\/+$/, '');
  }

  keySource(providerId) {
    const p = PROVIDERS.find(x => x.id === providerId);
    if (!p?.keyName) return 'none needed';
    const envName = [p.keyName, ...(p.keyAliases || [])].find(n => process.env[n]);
    if (envName) return `env ${envName}`;
    if (this.data.keys[providerId]) return 'saved';
    return '';
  }

  setKeys({ keys = {}, baseUrls = {} } = {}) {
    for (const [id, v] of Object.entries(keys)) {
      if (!PROVIDERS.some(p => p.id === id)) continue;
      if (v === null || v === '') delete this.data.keys[id];
      else if (typeof v === 'string' && v.trim()) this.data.keys[id] = v.trim();
    }
    for (const [id, v] of Object.entries(baseUrls)) {
      if (!PROVIDERS.some(p => p.id === id)) continue;
      if (!v) delete this.data.baseUrls[id];
      else if (/^https?:\/\//i.test(v)) this.data.baseUrls[id] = v.trim();
    }
    this.save();
  }
}
