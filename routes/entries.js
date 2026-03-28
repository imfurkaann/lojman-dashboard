const express = require('express');
const router = express.Router();
const { db, logActivity } = require('../database');

function getSafeUserId(req) {
  const rawUserId = req.session && req.session.user ? req.session.user.id : null;
  const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
  return actorUser ? actorUser.id : null;
}

// Giriş/Çıkış listesi
router.get('/', (req, res) => {
  const typeFilter = req.query.type || '';

  let activeQuery = "SELECT el.*, u.full_name as added_by_name FROM entry_exit_list el LEFT JOIN users u ON el.added_by = u.id WHERE el.status = 'bekliyor'";
  let completedQuery = "SELECT el.*, u.full_name as added_by_name FROM entry_exit_list el LEFT JOIN users u ON el.added_by = u.id WHERE el.status IN ('tamamlandi', 'iptal')";
  const activeParams = [];
  const completedParams = [];

  if (typeFilter) {
    activeQuery += ' AND el.type = ?';
    completedQuery += ' AND el.type = ?';
    activeParams.push(typeFilter);
    completedParams.push(typeFilter);
  }
  activeQuery += " ORDER BY datetime(COALESCE(el.entry_date, el.exit_date, el.planned_date, el.created_at)) ASC, el.created_at DESC";
  completedQuery += " ORDER BY datetime(COALESCE(el.entry_date, el.exit_date, el.created_at)) DESC LIMIT 50";

  const activeEntries = db.prepare(activeQuery).all(...activeParams);
  const completedEntries = db.prepare(completedQuery).all(...completedParams);
  res.render('entries', { title: 'Giriş/Çıkış Listesi', activeEntries, completedEntries, typeFilter });
});

// Yeni kayıt ekle
router.post('/ekle', (req, res) => {
  const { person_name, type, notes, expected_date } = req.body;
  const safeUserId = getSafeUserId(req);

  const normalizedExpectedDate = expected_date && /^\d{4}-\d{2}-\d{2}$/.test(expected_date)
    ? expected_date
    : null;
  const normalizedEntryDate = type === 'giris' ? normalizedExpectedDate : null;
  const normalizedExitDate = type === 'cikis' ? normalizedExpectedDate : null;

  const plannedDate = normalizedExpectedDate || new Date().toISOString().slice(0, 10);

  db.prepare("INSERT INTO entry_exit_list (person_name, type, planned_date, notes, added_by, entry_date, exit_date) VALUES (?, ?, ?, ?, ?, ?, ?)").run(
    person_name,
    type,
    plannedDate,
    notes || null,
    safeUserId,
    normalizedEntryDate,
    normalizedExitDate
  );
  const typeText = type === 'giris' ? 'giriş' : 'çıkış';
  logActivity('giris_cikis_planlandi', `${person_name} için ${typeText} kaydedildi`, null, safeUserId);
  res.redirect('/giris-cikis');
});

// Durum güncelle
router.post('/:id/guncelle', (req, res) => {
  const { status } = req.body;
  const safeUserId = getSafeUserId(req);
  const entry = db.prepare('SELECT * FROM entry_exit_list WHERE id = ?').get(req.params.id);
  if (entry) {
    db.prepare('UPDATE entry_exit_list SET status = ? WHERE id = ?').run(status, req.params.id);
    const statusText = status === 'tamamlandi' ? 'tamamlandı' : status === 'iptal' ? 'iptal edildi' : 'bekliyor';
    const typeText = entry.type === 'giris' ? 'giriş' : 'çıkış';
    logActivity('giris_cikis_guncellendi', `${entry.person_name} - ${typeText} ${statusText}`, null, safeUserId);
  }
  res.redirect('/giris-cikis');
});

// Sil
router.post('/:id/sil', (req, res) => {
  const safeUserId = getSafeUserId(req);
  const entry = db.prepare('SELECT * FROM entry_exit_list WHERE id = ?').get(req.params.id);
  if (entry) {
    db.prepare('DELETE FROM entry_exit_list WHERE id = ?').run(req.params.id);
    logActivity('giris_cikis_silindi', `${entry.person_name} - kayıt silindi`, null, safeUserId);
  }
  res.redirect('/giris-cikis');
});

module.exports = router;
