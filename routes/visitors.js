const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { db, logActivity, formatLocalTimestamp } = require('../database');

function isValidDateInput(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function buildVisitorsFilters(query) {
  const search = String(query.search || '').trim();
  const dateFilter = isValidDateInput(query.date) ? String(query.date) : '';
  const dateFrom = isValidDateInput(query.date_from) ? String(query.date_from) : '';
  const dateTo = isValidDateInput(query.date_to) ? String(query.date_to) : '';

  return {
    search,
    dateFilter,
    dateFrom,
    dateTo
  };
}

function getVisitorsByFilters(filters) {
  const { search, dateFilter, dateFrom, dateTo } = filters;
  let query = 'SELECT v.*, u.full_name as recorder_name FROM visitors v LEFT JOIN users u ON v.recorded_by = u.id WHERE 1=1';
  const params = [];

  if (search) {
    query += ' AND (v.visitor_name LIKE ? OR v.purpose LIKE ? OR v.company LIKE ?)';
    params.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }

  if (dateFilter) {
    query += " AND date(v.visit_date, 'localtime') = ?";
    params.push(dateFilter);
  } else {
    if (dateFrom) {
      query += " AND date(v.visit_date, 'localtime') >= ?";
      params.push(dateFrom);
    }
    if (dateTo) {
      query += " AND date(v.visit_date, 'localtime') <= ?";
      params.push(dateTo);
    }
  }

  query += ' ORDER BY v.visit_date DESC';
  return db.prepare(query).all(...params);
}

function getSafeUserId(req) {
  const rawUserId = req.session && req.session.user ? req.session.user.id : null;
  const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
  return actorUser ? actorUser.id : null;
}

// Ziyaretçi listesi
router.get('/', (req, res) => {
  const filters = buildVisitorsFilters(req.query || {});
  const visitors = getVisitorsByFilters(filters);
  res.render('visitors', {
    title: 'Ziyaretçiler',
    visitors,
    search: filters.search,
    dateFilter: filters.dateFilter,
    dateFrom: filters.dateFrom,
    dateTo: filters.dateTo
  });
});

router.get('/excel', async (req, res, next) => {
  try {
    const filters = buildVisitorsFilters(req.query || {});
    const visitors = getVisitorsByFilters(filters);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Ziyaretçiler');

    sheet.columns = [
      { header: 'Ziyaretçi', key: 'visitor_name', width: 28 },
      { header: 'Amaç', key: 'purpose', width: 28 },
      { header: 'Firma', key: 'company', width: 24 },
      { header: 'Telefon', key: 'phone', width: 18 },
      { header: 'Giriş Saati', key: 'visit_date', width: 24 },
      { header: 'Çıkış Saati', key: 'departure_time', width: 24 },
      { header: 'Not', key: 'notes', width: 36 },
      { header: 'Durum', key: 'status', width: 14 }
    ];

    sheet.getRow(1).font = { bold: true };

    visitors.forEach(v => {
      sheet.addRow({
        visitor_name: v.visitor_name || '-',
        purpose: v.purpose || '-',
        company: v.company || '-',
        phone: v.phone || '-',
        visit_date: v.visit_date || '-',
        departure_time: v.departure_time || '-',
        notes: v.notes || '-',
        status: v.deleted_at ? 'Soft Silindi' : (v.departure_time ? 'Çıkış Yaptı' : 'İçeride')
      });
    });

    const now = new Date();
    const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="ziyaretciler-${stamp}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
});

// Ziyaretçi ekle
router.post('/ekle', (req, res) => {
  const { visitor_name, purpose, company, phone, notes } = req.body;
  const safeUserId = getSafeUserId(req);
  db.prepare('INSERT INTO visitors (visitor_name, purpose, company, phone, notes, recorded_by, visit_date) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    visitor_name, purpose, company || null, phone || null, notes || null, safeUserId, formatLocalTimestamp()
  );
  logActivity('ziyaretci_giris', `Ziyaretçi: ${visitor_name} - Amaç: ${purpose}`, company ? `Firma: ${company}` : null, safeUserId);
  res.redirect('/ziyaretciler');
});

// Ziyaretçi çıkış
router.post('/:id/cikis', (req, res) => {
  const safeUserId = getSafeUserId(req);
  const visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(req.params.id);
  if (visitor) {
    db.prepare('UPDATE visitors SET departure_time = ? WHERE id = ?').run(formatLocalTimestamp(), req.params.id);
    logActivity('ziyaretci_cikis', `Ziyaretçi çıkış: ${visitor.visitor_name}`, null, safeUserId);
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

// Soft sil
router.post('/:id/sil', (req, res) => {
  const safeUserId = getSafeUserId(req);
  const visitor = db.prepare('SELECT * FROM visitors WHERE id = ?').get(req.params.id);
  if (visitor && !visitor.deleted_at) {
    db.prepare('UPDATE visitors SET deleted_at = ? WHERE id = ?').run(formatLocalTimestamp(), req.params.id);
    logActivity('ziyaretci_sil_soft', `Ziyaretçi kaydı soft silindi: ${visitor.visitor_name}`, null, safeUserId);
  }
  res.redirect('/ziyaretciler');
});

module.exports = router;
