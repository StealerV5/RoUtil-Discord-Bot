const fs   = require('fs');
const path = require('path');

const DIR = path.join(__dirname, 'db');
if (!fs.existsSync(DIR)) fs.mkdirSync(DIR, { recursive: true });

function load(name, defaults = {}) {
    const file = path.join(DIR, `${name}.json`);
    if (fs.existsSync(file)) {
        try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* fall through */ }
    }
    return JSON.parse(JSON.stringify(defaults));
}

function save(name, data) {
    fs.writeFileSync(path.join(DIR, `${name}.json`), JSON.stringify(data, null, 2));
}

// Get or init a guild's sub-object inside a DB file
function guild(name, gid, defaults = {}) {
    const db = load(name, {});
    if (!db[gid]) db[gid] = JSON.parse(JSON.stringify(defaults));
    return { data: db[gid], commit: () => save(name, db) };
}

module.exports = { load, save, guild };
