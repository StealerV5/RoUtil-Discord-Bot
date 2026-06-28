// utils/prefixManager.js
const fs = require('fs').promises;
const path = require('path');
const FILE = path.join(__dirname, '..', 'data', 'prefixes.json');

async function _read() {
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    if (e.code === 'ENOENT') return {};
    throw e;
  }
}

async function _write(obj) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(obj, null, 2), 'utf8');
}

module.exports = {
  async getPrefix(guildId) {
    if (!guildId) return '!';
    const data = await _read();
    return data[guildId] || '!';
  },
  async setPrefix(guildId, prefix) {
    if (!guildId) throw new Error('Guild ID required');
    const data = await _read();
    data[guildId] = prefix;
    await _write(data);
  }
};
