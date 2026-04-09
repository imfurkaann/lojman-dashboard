const express = require('express');
const router = express.Router();
const { db } = require('../database');

// Geçmiş hareketler
router.get('/', (req, res) => {
  const search = req.query.search || '';
  const dateFilter = req.query.date || '';
  const typeFilter = req.query.type || '';

  let query = 'SELECT al.*, u.full_name as user_name FROM activity_log al LEFT JOIN users u ON al.performed_by = u.id WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (al.description LIKE ? OR al.details LIKE ?)';
    params.push(`%${search}%`, `%${search}%`);
  }
  if (dateFilter) {
    query += " AND date(al.created_at, 'localtime') = ?";
    params.push(dateFilter);
  }
  if (typeFilter) {
    query += ' AND al.action_type = ?';
    params.push(typeFilter);
  }
  query += ' ORDER BY al.created_at DESC LIMIT 200';

  const activities = db.prepare(query).all(...params);
  const actionTypes = db.prepare('SELECT DISTINCT action_type FROM activity_log ORDER BY action_type').all();

  res.render('history', { title: 'Geçmiş Hareketler', activities, actionTypes, search, dateFilter, typeFilter });
});

module.exports = router;
