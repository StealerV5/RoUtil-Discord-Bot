// utils/jtcManager.js
const fs = require('fs').promises;
const path = require('path');
const CFG = path.join(__dirname, '..', 'data', 'jtc.json');
const CREATED = path.join(__dirname, '..', 'data', 'jtc_created.json');

async function _read(file, fallback = {}) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    if (e.code === 'ENOENT') return fallback;
    throw e;
  }
}

async function _write(file, obj) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(obj, null, 2), 'utf8');
}

module.exports = {
  async getConfig(guildId) {
    const conf = await _read(CFG, {});
    return conf[guildId] || null;
  },
  async setConfig(guildId, data) {
    const conf = await _read(CFG, {});
    conf[guildId] = data;
    await _write(CFG, conf);
  },
  async deleteConfig(guildId) {
    const conf = await _read(CFG, {});
    delete conf[guildId];
    await _write(CFG, conf);
  },

  // created channels tracking
  async addCreated(guildId, channelId) {
    const map = await _read(CREATED, {});
    map[guildId] = map[guildId] || [];
    if (!map[guildId].includes(channelId)) map[guildId].push(channelId);
    await _write(CREATED, map);
  },
  async removeCreated(guildId, channelId) {
    const map = await _read(CREATED, {});
    if (!map[guildId]) return;
    map[guildId] = map[guildId].filter(id => id !== channelId);
    if (map[guildId].length === 0) delete map[guildId];
    await _write(CREATED, map);
  },
  async isCreated(guildId, channelId) {
    const map = await _read(CREATED, {});
    return Array.isArray(map[guildId]) && map[guildId].includes(channelId);
  }
};
