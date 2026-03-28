const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db, logActivity } = require('../database');

// Kullanıcı yönetimi

// Kullanıcı listesi
router.get('/', (req, res) => {
  const users = db.prepare('SELECT id, username, full_name, role, created_at FROM users ORDER BY created_at DESC').all();
  res.render('users', { title: 'Kullanıcılar', users });
});

// Kullanıcı ekle
router.post('/ekle', (req, res) => {
  const { username, password, full_name, role } = req.body;
  
  try {
    const hashedPassword = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (username, password, full_name, role) VALUES (?, ?, ?, ?)').run(username, hashedPassword, full_name, role || 'user');
    logActivity('kullanici_eklendi', `Yeni kullanıcı eklendi: ${full_name} (${username})`, null, req.session.user.id);
    res.redirect('/kullanicilar');
  } catch (e) {
    res.redirect('/kullanicilar?error=Bu kullanıcı adı zaten mevcut');
  }
});

// Şifre değiştir
router.post('/:id/sifre-degistir', (req, res) => {
  const { new_password } = req.body;
  if (new_password && new_password.length >= 4) {
    const hashedPassword = bcrypt.hashSync(new_password, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashedPassword, req.params.id);
    const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.params.id);
    logActivity('sifre_degistirildi', `${user.full_name} kullanıcısının şifresi değiştirildi`, null, req.session.user.id);
  }
  res.redirect('/kullanicilar');
});

// Kullanıcı sil
router.post('/:id/sil', (req, res) => {
  if (parseInt(req.params.id) === req.session.user.id) {
    return res.redirect('/kullanicilar?error=Kendinizi silemezsiniz');
  }
  const user = db.prepare('SELECT full_name FROM users WHERE id = ?').get(req.params.id);
  if (user) {
    db.prepare('DELETE FROM users WHERE id = ?').run(req.params.id);
    logActivity('kullanici_silindi', `${user.full_name} kullanıcısı silindi`, null, req.session.user.id);
  }
  res.redirect('/kullanicilar');
});

module.exports = router;
