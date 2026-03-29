const express = require('express');
const router = express.Router();
const { db, logActivity } = require('../database');

function getSafeUserId(req) {
  const rawUserId = req.session && req.session.user ? req.session.user.id : null;
  const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
  return actorUser ? actorUser.id : null;
}

// Ziyaretçi listesi
router.get('/', (req, res) => {
  const search = req.query.search || '';
  const dateFilter = req.query.date || '';

  let query = 'SELECT v.*, u.full_name as recorder_name FROM visitors v LEFT JOIN users u ON v.recorded_by = u.id WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (v.visitor_name LIKE ? OR v.purpose LIKE ? OR v.company LIKE ?)';
    params.push(`${search}%`, `${search}%`, `${search}%`);
  }
  if (dateFilter) {
    query += ' AND date(v.visit_date) = ?';
    params.push(dateFilter);
  }
  query += ' ORDER BY v.visit_date DESC';

  const visitors = db.prepare(query).all(...params);
  res.render('visitors', { title: 'Ziyaretçiler', visitors, search, dateFilter });
});

// Ziyaretçi ekle
router.post('/ekle', (req, res) => {
  const { visitor_name, purpose, company, phone, notes } = req.body;
  const safeUserId = getSafeUserId(req);
  db.prepare('INSERT INTO visitors (visitor_name, purpose, company, phone, notes, recorded_by, visit_date) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)').run(
    visitor_name, purpose, company || null, phone || null, notes || null, safeUserId
  );
  logActivity('ziyaretci_giris', `Ziyaretçi: ${visitor_name} - Amaç: ${purpose}`, company ? `Firma: ${company}` : null, safeUserId);
  res.redirect('/ziyaretciler');
});

// Ziyaretçi çıkış
router.post('/:id/cikis', (req, res) => {
  const visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(req.params.id);
  if (visitor) {
    db.prepare('UPDATE visitors SET departure_time = CURRENT_TIMESTAMP WHERE id = ?').run(req.params.id);
    logActivity('ziyaretci_cikis', `Ziyaretçi çıkış: ${visitor.visitor_name}`, null, req.session.user.id);
  }
  res.redirect('/ziyaretciler');
});

// Düzenle
router.post('/:id/guncelle', (req, res) => {
  const { visitor_name, purpose, company, phone, notes } = req.body;
  const safeUserId = getSafeUserId(req);
  const visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(req.params.id);
  if (visitor) {
    db.prepare('UPDATE visitors SET visitor_name = ?, purpose = ?, company = ?, phone = ?, notes = ? WHERE id = ?').run(
      visitor_name, purpose, company || null, phone || null, notes || null, req.params.id
    );
    logActivity('ziyaretci_guncelle', `Ziyaretçi: ${visitor_name} - Amaç: ${purpose}`, company ? `Firma: ${company}` : null, safeUserId);
  }
  res.redirect('/ziyaretciler');
});

module.exports = router;
