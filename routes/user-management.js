const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../database');

const router = express.Router();

function normalizeStr(v) {
  if (typeof v !== 'string') return v;
  try { return v.normalize('NFC'); } catch (e) { return v; }
}

router.get('/', (req, res) => {
  const users = db.prepare('SELECT id, username, full_name as fullName, role, created_at FROM users ORDER BY id ASC').all();
  res.render('users', { users });
});

router.get('/create', (req, res) => {
  res.render('users_create', { error: null });
});

router.post('/create', (req, res) => {
  const { username, fullName, password, role } = req.body || {};
  const normUsername = normalizeStr(String(username || ''));
  const normPassword = normalizeStr(String(password || ''));

  if (!normUsername || !normPassword) {
    return res.render('users_create', { error: 'Kullanıcı adı ve şifre gerekli' });
  }

  const exists = db.prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE').get(normUsername);
  if (exists) {
    return res.render('users_create', { error: 'Bu kullanıcı adı zaten var' });
  }

  const passwordHash = bcrypt.hashSync(normPassword, 10);
  db.prepare('INSERT INTO users (username, password, full_name, role, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)').run(normUsername, passwordHash, fullName || username, role || 'user');
  res.redirect('/users');
});

router.post('/delete', (req, res) => {
  const { id } = req.body || {};
  const numId = Number(id);
  if (!numId) return res.redirect('/users');

  const target = db.prepare('SELECT id, role FROM users WHERE id = ?').get(numId);
  if (!target) return res.redirect('/users');

  const adminCountRow = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'admin'").get();
  const adminCount = adminCountRow ? Number(adminCountRow.count || 0) : 0;

  if (String(target.role) === 'admin' && adminCount <= 1) {
    const users = db.prepare('SELECT id, username, full_name as fullName, role, created_at FROM users ORDER BY id ASC').all();
    return res.status(400).render('users', { users, error: 'Sistemde en az bir admin olmalıdır. Son admin silinemez.' });
  }

  const isSelf = req.session && req.session.user && Number(req.session.user.id) === numId;
  console.log(`[USER-MGMT] delete requested: targetId=${numId}, sessionUserId=${req.session && req.session.user ? req.session.user.id : 'none'}, isSelf=${isSelf}`);

  db.prepare('DELETE FROM users WHERE id = ?').run(numId);

  if (isSelf) {
    const anotherAdmin = db.prepare("SELECT id, username, full_name as fullName, role FROM users WHERE role = 'admin' LIMIT 1").get();
    if (anotherAdmin) {
      req.session.user = { id: anotherAdmin.id, username: anotherAdmin.username, fullName: anotherAdmin.fullName || anotherAdmin.username, role: anotherAdmin.role || 'admin' };
      console.log(`[USER-MGMT] self-deleted; switched session to admin id=${anotherAdmin.id}`);
      return res.redirect('/users');
    }

    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      return res.redirect('/login');
    });
    return;
  }

  res.redirect('/users');
});

module.exports = router;
