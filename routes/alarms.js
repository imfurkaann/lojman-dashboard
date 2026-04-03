const express = require('express');
const router = express.Router();
const { db, logActivity } = require('../database');

function getSafeUserId(req) {
  const rawUserId = req && req.session && req.session.user ? req.session.user.id : null;
  const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
  return actorUser ? actorUser.id : null;
}

// Yangın alarm listesi
router.get('/', (req, res) => {
  const dateFilter = req.query.date || '';

  let query = 'SELECT fa.*, u.full_name as recorder_name FROM fire_alarms fa LEFT JOIN users u ON fa.recorded_by = u.id WHERE 1=1';
  const params = [];

  if (dateFilter) {
    query += ' AND date(fa.alarm_time) = ?';
    params.push(dateFilter);
  }
  query += ' ORDER BY fa.alarm_time DESC';

  const alarms = db.prepare(query).all(...params);
  res.render('alarms', { title: 'Yangın Alarm', alarms, dateFilter });
});

// Alarm ekle
router.post('/ekle', (req, res) => {
  const { location, is_real, description, action_taken } = req.body;
  const safeUserId = getSafeUserId(req);
  db.prepare('INSERT INTO fire_alarms (location, is_real, description, action_taken, recorded_by) VALUES (?, ?, ?, ?, ?)').run(
    location, is_real === 'true' ? 1 : 0, description || null, action_taken || null, safeUserId
  );
  const alarmType = is_real === 'true' ? 'GERÇEK' : 'YANLIŞ';
  logActivity('yangin_alarm', `Yangın alarmı: ${location} - ${alarmType} ALARM`, description || null, safeUserId);
  res.redirect('/yangin-alarm');
});

// Sil
router.post('/:id/sil', (req, res) => {
  db.prepare('DELETE FROM fire_alarms WHERE id = ?').run(req.params.id);
  res.redirect('/yangin-alarm');
});

module.exports = router;
