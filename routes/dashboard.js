const express = require('express');
const router = express.Router();
const { db } = require('../database');

router.get('/', (req, res) => {
  // Oda istatistikleri (depo odaları hariç)
  const totalRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status != 'depo'").get().count;
  const emptyRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status = 'bos'").get().count;
  const fullRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status = 'dolu'").get().count;
  const partialRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status = 'kismi_dolu'").get().count;
  const maintenanceRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status = 'bakimda'").get().count;
  const storageRooms = db.prepare("SELECT COUNT(*) as count FROM rooms WHERE status = 'depo'").get().count;

  // Personel istatistikleri
  const registeredPersonnel = db.prepare('SELECT COUNT(*) as count FROM personnel').get().count;

  // Bugünkü giriş/çıkış (bekleyenler)
  const pendingEntries = db.prepare("SELECT COUNT(*) as count FROM entry_exit_list WHERE status = 'bekliyor' AND type = 'giris'").get().count;
  const pendingExits = db.prepare("SELECT COUNT(*) as count FROM entry_exit_list WHERE status = 'bekliyor' AND type = 'cikis'").get().count;

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
    totalRooms, emptyRooms, fullRooms, partialRooms, maintenanceRooms, storageRooms,
    registeredPersonnel, pendingEntries, pendingExits,
    openIssues, unreturned, recentActivity
  });
});

module.exports = router;
