'use strict';

// Tiny JSON-file data store. State lives in data/db.json:
//   { mandates: [...], ledger: [...] }
// Loaded once at boot, saved after every mutation. Good enough for a demo
// and trivially inspectable.

const fs = require('fs');
const path = require('path');

const DATA_FILE =
  process.env.DATA_FILE || path.join(__dirname, '..', 'data', 'db.json');

function emptyDb() {
  return { mandates: [], ledger: [] };
}

function load() {
  try {
    const db = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    if (!Array.isArray(db.mandates)) db.mandates = [];
    if (!Array.isArray(db.ledger)) db.ledger = [];
    return db;
  } catch {
    return emptyDb();
  }
}

function save(db) {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DATA_FILE);
}

module.exports = { load, save, DATA_FILE };
