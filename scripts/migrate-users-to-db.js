const fs = require('fs');
const path = require('path');
const { db } = require('../database');

const USERS_FILE = path.join(__dirname, '..', 'data', 'users.json');

function normalizeStr(v) {
  if (typeof v !== 'string') return v;
  try { return v.normalize('NFC'); } catch (e) { return v; }
}

function backupFile(filePath) {
  try {
    const target = filePath + '.bak';
    fs.copyFileSync(filePath, target);
    console.log('Backup created:', target);
  } catch (e) {
    console.warn('Backup failed or not needed:', e.message);
  }
}

function migrate() {
  if (!fs.existsSync(USERS_FILE)) {
    console.log('No users.json found, nothing to migrate.');
    return;
  }

  const raw = fs.readFileSync(USERS_FILE, 'utf8');
  let users = [];
  try { users = JSON.parse(raw || '[]'); } catch (e) { console.error('Invalid JSON in users file'); return; }
  if (!Array.isArray(users) || users.length === 0) { console.log('No users to migrate.'); return; }

  // Backup first
  backupFile(USERS_FILE);

  const insert = db.prepare('INSERT OR IGNORE INTO users (username, password, full_name, role, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)');

  let migrated = 0;
  for (const u of users) {
    const username = normalizeStr(String(u.username || ''));
    const password = String(u.passwordHash || u.password || '');
    const fullName = u.fullName || u.full_name || username;
    const role = u.role || 'user';
    if (!username || !password) continue;
    try {
      insert.run(username, password, fullName, role);
      migrated++;
    } catch (e) {
      console.error('Failed to insert user', username, e.message);
    }
  }

  console.log(`Migrated ${migrated} users to DB (users table).`);
}

migrate();
