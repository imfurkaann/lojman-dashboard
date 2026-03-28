const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { db, logActivity } = require('../database');

// Giriş sayfası
router.get('/giris', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('login', { error: null });
});

// Giriş işlemi
router.post('/giris', (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.render('login', { error: 'Kullanıcı adı ve şifre gerekli.' });
  }

  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.render('login', { error: 'Kullanıcı adı veya şifre hatalı.' });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    fullName: user.full_name,
    role: user.role
  };

  logActivity('giris', `${user.full_name} sisteme giriş yaptı`, null, user.id);
  res.redirect('/dashboard');
});

// Çıkış işlemi
router.get('/cikis', (req, res) => {
  if (req.session.user) {
    logActivity('cikis', `${req.session.user.fullName} sistemden çıkış yaptı`, null, req.session.user.id);
  }
  req.session.destroy();
  res.redirect('/giris');
});

module.exports = router;
