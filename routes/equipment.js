const express = require('express');
const router = express.Router();
const { db, logActivity } = require('../database');

function getSafeUserId(req) {
  const rawUserId = req.session && req.session.user ? req.session.user.id : null;
  const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
  return actorUser ? actorUser.id : null;
}

// Eşya listesi
router.get('/', (req, res) => {
  const statusFilter = req.query.status || '';
  const search = req.query.search || '';

  let query = 'SELECT se.*, u.full_name as recorder_name FROM shared_equipment se LEFT JOIN users u ON se.recorded_by = u.id WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (se.item_name LIKE ? OR se.given_to LIKE ? OR se.room_number LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (statusFilter) {
    query += ' AND se.status = ?';
    params.push(statusFilter);
  }
  query += ' ORDER BY se.created_at DESC';

  const equipment = db.prepare(query).all(...params);
  const personnel = db.prepare(`
    SELECT
      p.id,
      (p.first_name || ' ' || p.last_name) AS full_name,
      p.status,
      r.room_number
    FROM personnel p
    LEFT JOIN rooms r ON r.id = p.room_id
    WHERE COALESCE(p.status, '') != 'cikis_yapti'
    ORDER BY
      CASE
        WHEN COALESCE(p.status, '') = 'aktif' THEN 0
        WHEN COALESCE(p.status, '') = 'ayrilacak' THEN 1
        ELSE 2
      END,
      p.first_name,
      p.last_name
  `).all();
  const rooms = db.prepare("SELECT id, room_number, floor FROM rooms WHERE status != 'bakimda' ORDER BY room_number").all();
  const savedItems = db.prepare('SELECT name FROM equipment_items ORDER BY name').all();
  res.render('equipment', { title: 'Eşya Takip', equipment, statusFilter, search, personnel, rooms, savedItems });
});

// Eşya teslim
router.post('/ekle', (req, res) => {
  const { item_name, given_to, room_number, notes } = req.body;
  const safeUserId = getSafeUserId(req);
  const givenAt = new Date().toISOString();
  db.prepare('INSERT INTO shared_equipment (item_name, given_to, room_number, notes, status, given_at, returned_at, recorded_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    item_name,
    given_to,
    room_number ? parseInt(room_number) : null,
    notes || null,
    'teslim_edildi',
    givenAt,
    null,
    safeUserId
  );
  // Eşya adını kayıtlı listeye ekle (varsa atla)
  db.prepare('INSERT OR IGNORE INTO equipment_items (name) VALUES (?)').run(item_name);
  logActivity('esya_teslim', `${item_name} - ${given_to} kişisine teslim edildi (Oda: ${room_number || '-'})`, null, safeUserId);
  res.redirect('/esya-takip');
});

// Durum güncelle
router.post('/:id/durum', (req, res) => {
  const safeUserId = getSafeUserId(req);
  const { status } = req.body;
  const allowedStatuses = new Set(['iade_edildi', 'kayip']);
  if (!allowedStatuses.has(status)) {
    return res.redirect('/esya-takip');
  }

  const item = db.prepare('SELECT * FROM shared_equipment WHERE id = ?').get(req.params.id);
  if (!item) {
    return res.redirect('/esya-takip');
  }

  const returnedAt = status === 'iade_edildi' ? new Date().toISOString() : null;
  db.prepare('UPDATE shared_equipment SET status = ?, returned_at = ? WHERE id = ?').run(status, returnedAt, req.params.id);

  if (status === 'iade_edildi') {
    logActivity('esya_iade', `${item.item_name} - ${item.given_to} tarafından teslim alındı`, null, safeUserId);
  } else {
    logActivity('esya_kayip', `${item.item_name} - ${item.given_to} kaydında eşya bozuldu`, null, safeUserId);
  }

  res.redirect('/esya-takip');
});

// Eşya listesine yeni eşya ekle
router.post('/esya-ekle', (req, res) => {
  const { name } = req.body;
  if (name && name.trim()) {
    db.prepare('INSERT OR IGNORE INTO equipment_items (name) VALUES (?)').run(name.trim());
  }
  res.redirect('/esya-takip');
});

// Eşya listesinden sil
router.post('/esya-sil', (req, res) => {
  const { name } = req.body;
  if (name) {
    db.prepare('DELETE FROM equipment_items WHERE name = ?').run(name);
  }
  res.redirect('/esya-takip');
});

// İade et
router.post('/:id/iade', (req, res) => {
  const safeUserId = getSafeUserId(req);
  const item = db.prepare('SELECT * FROM shared_equipment WHERE id = ?').get(req.params.id);
  if (item) {
    db.prepare("UPDATE shared_equipment SET status = 'iade_edildi', returned_at = CURRENT_TIMESTAMP WHERE id = ?").run(req.params.id);
    logActivity('esya_iade', `${item.item_name} - ${item.given_to} tarafından iade edildi`, null, safeUserId);
  }
  res.redirect('/esya-takip');
});

// Kayıp bildir
router.post('/:id/kayip', (req, res) => {
  const safeUserId = getSafeUserId(req);
  const item = db.prepare('SELECT * FROM shared_equipment WHERE id = ?').get(req.params.id);
  if (item) {
    db.prepare("UPDATE shared_equipment SET status = 'kayip' WHERE id = ?").run(req.params.id);
    logActivity('esya_kayip', `${item.item_name} - ${item.given_to} kişisinde kayıp bildirildi`, null, safeUserId);
  }
  res.redirect('/esya-takip');
});

// Sil
router.post('/:id/sil', (req, res) => {
  db.prepare('DELETE FROM shared_equipment WHERE id = ?').run(req.params.id);
  res.redirect('/esya-takip');
});

module.exports = router;
