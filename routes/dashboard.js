const express = require('express');
const router = express.Router();
const { db } = require('../database');

router.get('/', (req, res) => {
  // Oda istatistikleri (depo odaları hariç)
  const totalRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status != 'depo'").get().count;
  const emptyRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status = 'bos'").get().count;
  const fullRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status = 'dolu'").get().count;
  const partialRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status = 'kismi_dolu'").get().count;
  const availableRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status != 'depo' AND COALESCE(availability_status, 'musait') = 'musait'").get().count;
  const cleaningNeededRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status != 'depo' AND COALESCE(availability_status, 'musait') = 'temizlenmeli'").get().count;
  const unavailableRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status != 'depo' AND COALESCE(availability_status, 'musait') = 'kullanilamaz'").get().count;
  const storageRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status = 'depo'").get().count;

  // Personel istatistikleri
  // Çıkış yapmış (status = 'cikis_yapti') personel sayısı
  const exitedPersonnel = db.prepare("SELECT COUNT(*) as count FROM personnel WHERE status = 'cikis_yapti'").get().count;

  // Lojmanda konaklayan personel (odası olan ve aktif)
  const occupiedPersonnel = db.prepare("SELECT COUNT(*) as count FROM personnel WHERE room_id IS NOT NULL AND status = 'aktif'").get().count;

  const todayEntries = db.prepare(`
    SELECT COUNT(*) as count
    FROM room_stay_history
    WHERE entry_at IS NOT NULL
      AND date(entry_at, 'localtime') = date('now', 'localtime')
  `).get().count;

  const todayExits = db.prepare(`
    SELECT COUNT(*) as count
    FROM room_stay_history
    WHERE exit_at IS NOT NULL
      AND date(exit_at, 'localtime') = date('now', 'localtime')
  `).get().count;

  // Açık sorunlar
  const openIssues = db.prepare("SELECT COUNT(*) as count FROM room_issues WHERE status = 'acik'").get().count;

  // İade edilmemiş eşyalar
  const unreturned = db.prepare("SELECT COUNT(*) as count FROM shared_equipment WHERE status = 'teslim_edildi'").get().count;

  // Son 10 hareket
  const recentActivity = db.prepare(`
    SELECT al.*, u.full_name as user_name 
    FROM activity_log al 
    LEFT JOIN users u ON al.performed_by = u.id 
    ORDER BY al.created_at DESC 
    LIMIT 10
  `).all();

  res.render('dashboard', {
    title: 'Ana Sayfa',
    totalRooms, emptyRooms, fullRooms, partialRooms, availableRooms, cleaningNeededRooms, unavailableRooms, storageRooms,
    exitedPersonnel, occupiedPersonnel, todayEntries, todayExits,
    openIssues, unreturned, recentActivity
  });
});

module.exports = router;
