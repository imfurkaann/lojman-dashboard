const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db, logActivity, updateRoomStatus, syncRoomKeyStock, recordRoomEntry } = require('../database');
const MIN_ROOM_KEY_COUNT = 0;

// Fotoğraf yükleme ayarları
const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'personnel');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['image/jpeg', 'image/png', 'image/gif'];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Sadece JPEG, PNG ve GIF formatları kabul edilir'));
    }
  },
  limits: { fileSize: 5 * 1024 * 1024 }
});

// Kat etiketleri
const FLOORS = ['Bodrum', 'Zemin Kat', '1. Kat', '2. Kat', '3. Kat', '4. Kat', '5. Kat', '6. Kat', '7. Kat', '8. Kat', '9. Kat', '10. Kat'];
const DEFAULT_ROOM_INVENTORY = [
  { name: 'Yastık', quantity: 1 },
  { name: 'Nevresim Takımı', quantity: 1 },
  { name: 'Oda Anahtarı', quantity: null },
  { name: 'Klima', quantity: 1 },
  { name: 'Klima Kumandası', quantity: 1 },
  { name: 'Televizyon', quantity: 1 },
  { name: 'TV Kumandası', quantity: 1 },
  { name: 'Elbise Dolabı', quantity: 1 }
];

function getRequiredKeyCount(roomNumber) {
  return 3;
}

function getRoomKeyLimit(roomId, fallbackLimit = 3) {
  const keyRow = db.prepare("SELECT max_quantity, quantity FROM room_inventory WHERE room_id = ? AND LOWER(item_name) = LOWER('Oda Anahtarı')").get(roomId);
  if (!keyRow) return Math.max(MIN_ROOM_KEY_COUNT, Number(fallbackLimit || 0));
  const limit = Number(keyRow.max_quantity ?? keyRow.quantity ?? fallbackLimit ?? 0);
  return Math.max(MIN_ROOM_KEY_COUNT, limit);
}

function clampQuantityForItem(roomId, itemName, quantity, fallbackKeyLimit = null) {
  const value = Number(quantity || 0);
  if ((itemName || '').toLowerCase() === 'oda anahtarı') {
    const resolvedLimit = fallbackKeyLimit == null
      ? getRoomKeyLimit(roomId, value)
      : Math.max(MIN_ROOM_KEY_COUNT, Number(fallbackKeyLimit || 0));
    return Math.max(MIN_ROOM_KEY_COUNT, Math.min(resolvedLimit, value));
  }
  return Math.max(0, value);
}

function getSafeUserId(req) {
  const rawUserId = req.session && req.session.user ? req.session.user.id : null;
  if (!rawUserId) return null;
  const user = db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId);
  return user ? user.id : null;
}

function emitReportRefresh(req, roomId) {
  if (!req || !req.app || !req.app.locals || !req.app.locals.io) return;
  req.app.locals.io.emit('report:refresh', {
    source: 'rooms',
    roomId: roomId ? Number(roomId) : null,
    ts: Date.now()
  });
}

function isRoomAtCapacity(roomId, excludePersonnelId = null) {
  const room = db.prepare('SELECT id, capacity FROM rooms WHERE id = ?').get(roomId);
  if (!room) return { exists: false, atCapacity: false };

  let activeCount;
  if (excludePersonnelId) {
    activeCount = db.prepare("SELECT COUNT(*) as count FROM personnel WHERE room_id = ? AND status = 'aktif' AND id != ?").get(roomId, excludePersonnelId).count || 0;
  } else {
    activeCount = db.prepare("SELECT COUNT(*) as count FROM personnel WHERE room_id = ? AND status = 'aktif'").get(roomId).count || 0;
  }

  return {
    exists: true,
    atCapacity: activeCount >= Number(room.capacity || 0)
  };
}

function normalizeIssueStatus(status) {
  return status === 'cozuldu' ? 'cozuldu' : 'acik';
}

function mapIssueTagToCondition(tag) {
  const normalized = (tag || '').toLowerCase();
  if (['eksik', 'arizali', 'kirik', 'calismiyor', 'kayip', 'diger'].includes(normalized)) {
    return normalized;
  }
  return 'saglam';
}

function normalizeIssueTag(tag) {
  const normalized = (tag || '').toLowerCase().trim();
  return ['eksik', 'arizali', 'kirik', 'calismiyor', 'kayip', 'diger'].includes(normalized)
    ? normalized
    : null;
}

function syncInventoryConditionWithOpenIssues(roomId, itemName) {
  if (!roomId || !itemName) return;

  const latestOpenIssue = db.prepare(`
    SELECT issue_tag
    FROM room_issues
    WHERE room_id = ?
      AND COALESCE(issue_type, 'oda') = 'demirbas'
      AND LOWER(COALESCE(inventory_item_name, '')) = LOWER(?)
      AND status != 'cozuldu'
    ORDER BY datetime(COALESCE(created_at, CURRENT_TIMESTAMP)) DESC, id DESC
    LIMIT 1
  `).get(roomId, itemName);

  const nextCondition = normalizeIssueTag(latestOpenIssue ? latestOpenIssue.issue_tag : null) || 'saglam';

  db.prepare('UPDATE room_inventory SET condition = ? WHERE room_id = ? AND LOWER(item_name) = LOWER(?)').run(nextCondition, roomId, itemName);
}

function syncHandoverIssuesForRoom(roomId, handoverItems, safeUserId, reasonText) {
  if (!roomId || !Array.isArray(handoverItems)) return;

  handoverItems.forEach(item => {
    if (!item) return;

    const itemName = String(item.name || '').trim();
    if (!itemName) return;

    const latestOpenIssue = db.prepare(`
      SELECT id
      FROM room_issues
      WHERE room_id = ?
        AND COALESCE(issue_type, 'oda') = 'demirbas'
        AND LOWER(COALESCE(inventory_item_name, '')) = LOWER(?)
        AND status != 'cozuldu'
      ORDER BY datetime(COALESCE(created_at, CURRENT_TIMESTAMP)) DESC, id DESC
      LIMIT 1
    `).get(roomId, itemName);

    if (item.delivered) {
      if (latestOpenIssue && latestOpenIssue.id) {
        db.prepare("UPDATE room_issues SET status = 'cozuldu', resolved_at = CURRENT_TIMESTAMP WHERE id = ?").run(latestOpenIssue.id);
      }
      syncInventoryConditionWithOpenIssues(roomId, itemName);
      return;
    }

    const normalizedTag = normalizeIssueTag(item.tag);
    if (!normalizedTag) {
      syncInventoryConditionWithOpenIssues(roomId, itemName);
      return;
    }

    const description = String(item.description || '').trim();
    const issueDescription = description || `${itemName} ${reasonText || 'sağlam teslim edilmedi.'}`;

    if (latestOpenIssue && latestOpenIssue.id) {
      db.prepare(`
        UPDATE room_issues
        SET title = ?,
            description = ?,
            issue_tag = ?,
            status = 'acik',
            resolved_at = NULL
        WHERE id = ?
      `).run(`${itemName} teslim sorunu`, issueDescription, normalizedTag, latestOpenIssue.id);
    } else {
      db.prepare("INSERT INTO room_issues (room_id, title, description, issue_type, inventory_item_name, issue_tag, reported_by) VALUES (?, ?, ?, 'demirbas', ?, ?, ?)").run(
        roomId,
        `${itemName} teslim sorunu`,
        issueDescription,
        itemName,
        normalizedTag,
        safeUserId
      );
    }

    syncInventoryConditionWithOpenIssues(roomId, itemName);
  });
}

function addDefaultInventoryToRoom(roomId, roomNumber, userId = 1) {
  const safeUser = userId ? db.prepare('SELECT id FROM users WHERE id = ?').get(userId) : null;
  const safeUserId = safeUser ? safeUser.id : null;

  const insertDefaultItem = db.prepare(`
    INSERT INTO room_inventory (room_id, item_name, quantity, max_quantity, condition, notes, added_by)
    SELECT ?, ?, ?, ?, 'saglam', NULL, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM room_inventory
      WHERE room_id = ? AND LOWER(item_name) = LOWER(?)
    )
  `);

  const clampExistingKeyInventoryQuantity = db.prepare(`
    UPDATE room_inventory
    SET max_quantity = MAX(COALESCE(max_quantity, quantity, 0), 0),
        quantity = MAX(0, MIN(COALESCE(quantity, 0), MAX(COALESCE(max_quantity, quantity, 0), 0)))
    WHERE room_id = ? AND LOWER(item_name) = LOWER('Oda Anahtarı')
  `);

  const requiredKeyCount = getRequiredKeyCount(roomNumber);

  DEFAULT_ROOM_INVENTORY.forEach(item => {
    const quantity = item.name === 'Oda Anahtarı' ? requiredKeyCount : item.quantity;
    const maxQuantity = item.name === 'Oda Anahtarı' ? requiredKeyCount : null;
    insertDefaultItem.run(roomId, item.name, quantity, maxQuantity, safeUserId, roomId, item.name);
  });

  clampExistingKeyInventoryQuantity.run(roomId);
}

function addDefaultInventoryToAllRooms() {
  const rooms = db.prepare("SELECT id, room_number FROM rooms WHERE status != 'depo'").all();
  rooms.forEach(room => addDefaultInventoryToRoom(room.id, room.room_number));
}

addDefaultInventoryToAllRooms();

// Odalar listesi
router.get('/', (req, res) => {
  const search = req.query.search || '';
  const statusFilter = req.query.status || '';
  const floorFilter = req.query.floor || '';
  
  let query = `SELECT r.*, 
    (SELECT COUNT(*) FROM personnel p WHERE p.room_id = r.id AND p.status = 'aktif') as occupant_count
    FROM rooms r WHERE 1=1`;
  const params = [];

  if (search) {
    query += ' AND CAST(r.room_number AS TEXT) LIKE ?';
    params.push(`${search}%`);
  }
  if (statusFilter) {
    query += ' AND r.status = ?';
    params.push(statusFilter);
  }
  if (floorFilter) {
    query += ' AND r.floor = ?';
    params.push(floorFilter);
  }
  query += ' ORDER BY r.room_number ASC';

  const rooms = db.prepare(query).all(...params);

  const roomOccupantsMap = {};
  const roomIds = rooms.map(room => room.id);
  if (roomIds.length > 0) {
    const placeholders = roomIds.map(() => '?').join(',');
    const occupants = db.prepare(`
      SELECT id, room_id, first_name, last_name, department, gender
      FROM personnel
      WHERE status = 'aktif' AND room_id IN (${placeholders})
      ORDER BY room_id ASC, check_in_date ASC, id ASC
    `).all(...roomIds);

    occupants.forEach(person => {
      if (!roomOccupantsMap[person.room_id]) {
        roomOccupantsMap[person.room_id] = [];
      }
      roomOccupantsMap[person.room_id].push(person);
    });
  }

  res.render('rooms/index', {
    title: 'Odalar',
    rooms,
    roomOccupantsMap,
    search,
    statusFilter,
    floorFilter,
    floors: FLOORS
  });
});

// Yeni oda ekle
router.post('/', (req, res) => {
  const { room_number, capacity, floor, description, is_storage } = req.body;
  const status = is_storage ? 'depo' : 'bos';
  
  try {
    const insertResult = db.prepare('INSERT INTO rooms (room_number, capacity, floor, description, status) VALUES (?, ?, ?, ?, ?)').run(parseInt(room_number), parseInt(capacity) || 1, floor || null, description || null, status);
    if (!is_storage) {
      addDefaultInventoryToRoom(insertResult.lastInsertRowid, parseInt(room_number), req.session.user.id);
    }
    logActivity('oda_eklendi', `${room_number} numaralı oda eklendi`, `Kapasite: ${capacity}, Kat: ${floor || '-'}${is_storage ? ', Depo' : ''}`, req.session.user.id);
    res.redirect('/odalar');
  } catch (e) {
    res.redirect('/odalar?error=Bu oda numarası zaten mevcut');
  }
});

// Oda detay
router.get('/:id', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.redirect('/odalar');
  const errorMessage = req.query.error || '';

  // Oda detayını gösterirken anahtar adedini her zaman güncel veriye senkronize et.
  syncRoomKeyStock(room.id);

  db.prepare("UPDATE room_issues SET status = 'acik' WHERE status NOT IN ('acik', 'cozuldu')").run();

  const occupants = db.prepare("SELECT * FROM personnel WHERE room_id = ? AND status = 'aktif'").all(room.id);
  const roomIssues = db.prepare("SELECT ri.* FROM room_issues ri WHERE ri.room_id = ? AND COALESCE(ri.issue_type, 'oda') = 'oda' ORDER BY ri.created_at DESC").all(room.id);
  const inventoryIssues = db.prepare("SELECT ri.* FROM room_issues ri WHERE ri.room_id = ? AND COALESCE(ri.issue_type, 'oda') = 'demirbas' ORDER BY ri.created_at DESC").all(room.id);
  const openRoomIssueCount = roomIssues.filter(issue => normalizeIssueStatus(issue.status) === 'acik').length;
  const openInventoryIssueCount = inventoryIssues.filter(issue => normalizeIssueStatus(issue.status) === 'acik').length;
  const inventory = db.prepare('SELECT * FROM room_inventory WHERE room_id = ? ORDER BY item_name').all(room.id);
  const handoverInventoryItems = (() => {
    const seen = new Set();
    const dynamicItems = [];

    inventory.forEach(item => {
      const itemName = String(item.item_name || '').trim();
      const key = itemName.toLocaleLowerCase('tr-TR');
      if (!itemName) return;
      if (key === 'oda anahtarı') return;
      if (seen.has(key)) return;
      seen.add(key);
      dynamicItems.push(itemName);
    });

    if (dynamicItems.length > 0) {
      return dynamicItems;
    }

    // Oda envanteri henüz girilmemişse eski davranışa geri düş
    return DEFAULT_ROOM_INVENTORY
      .map(item => item.name)
      .filter(name => String(name || '').toLocaleLowerCase('tr-TR') !== 'oda anahtarı');
  })();
  const storedEquipmentItems = db.prepare('SELECT name FROM equipment_items ORDER BY name').all().map(row => row.name).filter(Boolean);
  const roomInventoryItemNames = inventory.map(item => item.item_name).filter(Boolean);
  const equipmentItems = Array.from(new Set([...storedEquipmentItems, ...roomInventoryItemNames, ...DEFAULT_ROOM_INVENTORY.map(item => item.name)]))
    .sort((a, b) => a.localeCompare(b, 'tr'));
  const keyInventory = db.prepare("SELECT quantity, max_quantity FROM room_inventory WHERE room_id = ? AND LOWER(item_name) = LOWER('Oda Anahtarı')").get(room.id);
  const keyCountInHand = keyInventory ? (keyInventory.quantity || 0) : 0;
  const requiredKeyCount = keyInventory ? Number(keyInventory.max_quantity ?? keyInventory.quantity ?? 0) : getRequiredKeyCount(room.room_number);
  
  // Oda dolmadığında personel seçilmek üzere hazır personeli getir
  const availablePersonnel = db.prepare(`
    SELECT p.*, r.room_number FROM personnel p 
    LEFT JOIN rooms r ON p.room_id = r.id 
    WHERE p.room_id IS NULL AND p.status IN ('bosta', 'cikis_yapti')
    ORDER BY p.first_name, p.last_name
  `).all();
  
  const departments = db.prepare('SELECT DISTINCT department FROM personnel WHERE department IS NOT NULL ORDER BY department').all();
  const roomHistory = db.prepare(`
    SELECT
      h.id,
      h.personnel_id,
      h.first_name,
      h.last_name,
      h.tc_number,
      h.department,
      h.entry_at,
      h.exit_at
    FROM room_stay_history h
    WHERE h.room_id = ?
    ORDER BY datetime(COALESCE(h.exit_at, h.entry_at, h.created_at, CURRENT_TIMESTAMP)) DESC, h.id DESC
  `).all(room.id);

  res.render('rooms/detail', {
    title: `Oda ${room.room_number}`,
    room,
    occupants,
    roomIssues,
    inventoryIssues,
    openRoomIssueCount,
    openInventoryIssueCount,
    inventory,
    requiredKeyCount,
    keyCountInHand,
    floors: FLOORS,
    availablePersonnel,
    departments,
    roomHistory,
    errorMessage,
    equipmentItems,
    handoverInventoryItems
  });
});

// Odaya personel ata (mevcut personeli seçerek)
router.post('/:id/personel-ata', (req, res) => {
  const { personnel_id, handover_payload } = req.body;
  const roomId = parseInt(req.params.id);
  
  if (!personnel_id) {
    return res.redirect(`/odalar/${roomId}?error=Personel seçilmedi`);
  }

  try {
    const person = db.prepare('SELECT * FROM personnel WHERE id = ?').get(personnel_id);
    if (!person) {
      return res.redirect(`/odalar/${roomId}?error=Personel bulunamadı`);
    }

    const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(roomId);
    if (!room) {
      return res.status(404).send('Oda bulunamadı.');
    }

    const roomCapacity = isRoomAtCapacity(roomId, Number(personnel_id));
    if (roomCapacity.exists && roomCapacity.atCapacity) {
      return res.redirect(`/odalar/${roomId}?error=Bu oda kapasitesini doldurmuştur.`);
    }

    const rawUserId = req.session && req.session.user ? req.session.user.id : null;
    const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
    const safeUserId = actorUser ? actorUser.id : null;

    let handoverData = null;
    try {
      handoverData = handover_payload ? JSON.parse(handover_payload) : null;
    } catch (_) {
      handoverData = null;
    }

    const keyDeliveredValue = ((handoverData && handoverData.key_delivered) || req.body.key_delivered === '1') ? 1 : 0;
    const safeHandoverData = handoverData || {
      form_signed: req.body.form_signed === 'on' || req.body.form_signed === '1',
      key_delivered: keyDeliveredValue === 1,
      items: []
    };
    const safeHandoverPayload = handover_payload || JSON.stringify(safeHandoverData);

    // 1. Personeli odaya ata ve durumunu güncelle
    const checkInAt = new Date().toISOString();
    db.prepare('UPDATE personnel SET room_id = ?, status = ?, check_in_date = ?, entry_handover_payload = ?, key_delivered = ?, checkout_key_returned = NULL, checkout_room_id = NULL WHERE id = ?').run(roomId, 'aktif', checkInAt, safeHandoverPayload, keyDeliveredValue, personnel_id);
    recordRoomEntry(personnel_id, roomId, checkInAt);
    logActivity('personel_atama', `Oda ${room.room_number}, ${person.first_name} ${person.last_name} adlı personele atandı.`, null, safeUserId);

    // 2. Oda durumunu güncelle
    updateRoomStatus(roomId);

    // 3. Zimmet formunu kaydet
    if (safeHandoverData.form_signed) {
      db.prepare('INSERT INTO handover_forms (personnel_id, room_id, form_type, is_signed, signed_at) VALUES (?, ?, ?, ?, ?)').run(personnel_id, roomId, 'giris', 1, new Date().toISOString());
    }

    // 4. Demirbaşları kaydet
    const handoverItems = Array.isArray(safeHandoverData.items) ? safeHandoverData.items : [];
    handoverItems.forEach(item => {
      db.prepare('INSERT INTO personnel_inventory (personnel_id, room_id, item_name, status, description, handover_date) VALUES (?, ?, ?, ?, ?, ?)').run(
        personnel_id,
        roomId,
        item.name,
        item.delivered ? 'sağlam' : (item.tag || 'teslim edilmedi'),
        item.delivered ? null : item.description,
        new Date().toISOString()
      );
    });
    syncHandoverIssuesForRoom(roomId, handoverItems, safeUserId, 'oda tahsisinde sağlam teslim edilmedi.');

    // 5. Anahtar teslimini yönet
    const syncedKeyQty = syncRoomKeyStock(roomId);
    if (keyDeliveredValue === 1) {
      logActivity('anahtar_teslim', `Oda ${room.room_number} anahtarı ${person.first_name} ${person.last_name} adlı personele teslim edildi.`, null, safeUserId);
    }

    if (req.app.locals.io) {
      req.app.locals.io.emit('personnel:room-update', {
        personnelId: Number(personnel_id),
        roomId,
        room_name: room.room_number,
        anahtar_sayisi: syncedKeyQty
      });
    }

    res.redirect(`/odalar/${roomId}`);
  } catch (error) {
    console.error('Personel atama hatası:', error);
    res.redirect(`/odalar/${roomId}?error=Bir hata oluştu`);
  }
});

// Oda güncelle
router.post('/:id/guncelle', (req, res) => {
  const { capacity, floor, description, status } = req.body;
  db.prepare('UPDATE rooms SET capacity = ?, floor = ?, description = ?, status = ? WHERE id = ?').run(parseInt(capacity) || 1, floor || null, description || null, status, req.params.id);
  const room = db.prepare('SELECT room_number FROM rooms WHERE id = ?').get(req.params.id);
  logActivity('oda_guncellendi', `${room.room_number} numaralı oda güncellendi`, null, req.session.user.id);
  res.redirect(`/odalar/${req.params.id}`);
});

// Oda sil
router.post('/:id/sil', (req, res) => {
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room) return res.redirect('/odalar');
  
  const occupants = db.prepare("SELECT COUNT(*) as count FROM personnel WHERE room_id = ? AND status = 'aktif'").get(req.params.id);
  if (occupants.count > 0) {
    return res.redirect(`/odalar/${req.params.id}?error=Odada personel var, önce personelleri çıkarın`);
  }

  db.prepare('DELETE FROM room_issues WHERE room_id = ?').run(req.params.id);
  db.prepare('DELETE FROM room_inventory WHERE room_id = ?').run(req.params.id);
  db.prepare('DELETE FROM rooms WHERE id = ?').run(req.params.id);
  logActivity('oda_silindi', `${room.room_number} numaralı oda silindi`, null, req.session.user.id);
  res.redirect('/odalar');
});

// Oda sorunu ekle
router.post('/:id/sorun-ekle', (req, res) => {
  const { title, description } = req.body;
  const safeUserId = getSafeUserId(req);
  db.prepare("INSERT INTO room_issues (room_id, title, description, issue_type, reported_by) VALUES (?, ?, ?, 'oda', ?)").run(req.params.id, title, description || null, safeUserId);
  const room = db.prepare('SELECT room_number FROM rooms WHERE id = ?').get(req.params.id);
  logActivity('sorun_eklendi', `${room.room_number} odasına sorun eklendi: ${title}`, null, safeUserId);
  emitReportRefresh(req, req.params.id);
  res.redirect(`/odalar/${req.params.id}`);
});

// Demirbaş sorunu ekle
router.post('/:id/demirbas-sorun-ekle', (req, res) => {
  const { inventory_item_name, inventory_item_id, title, description, issue_tag } = req.body;
  const rawUserId = req.session && req.session.user ? req.session.user.id : null;
  const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
  const safeUserId = actorUser ? actorUser.id : null;

  let resolvedItemName = (inventory_item_name || '').trim();
  const parsedItemId = Number.parseInt(inventory_item_id, 10);
  if ((!resolvedItemName || !resolvedItemName.trim()) && Number.isInteger(parsedItemId)) {
    const inventoryRow = db.prepare('SELECT item_name FROM room_inventory WHERE id = ? AND room_id = ?').get(parsedItemId, req.params.id);
    resolvedItemName = inventoryRow && inventoryRow.item_name ? String(inventoryRow.item_name).trim() : '';
  }

  if (!resolvedItemName || !resolvedItemName.trim()) {
    return res.redirect(`/odalar/${req.params.id}?error=${encodeURIComponent('Demirbaş seçimi zorunludur.')}`);
  }

  const validTags = ['eksik', 'arizali', 'kirik', 'calismiyor', 'kayip', 'diger'];
  if (!issue_tag || !validTags.includes((issue_tag || '').toLowerCase())) {
    return res.redirect(`/odalar/${req.params.id}?error=${encodeURIComponent('Demirbaş sorunu için etiket seçimi zorunludur.')}`);
  }

  const normalizedTag = issue_tag.toLowerCase();
  const sorunBasligi = `${resolvedItemName} - ${normalizedTag}`;
  db.prepare("INSERT INTO room_issues (room_id, title, description, issue_type, inventory_item_name, issue_tag, reported_by) VALUES (?, ?, ?, 'demirbas', ?, ?, ?)")
    .run(req.params.id, sorunBasligi, description || null, resolvedItemName, normalizedTag, safeUserId);

  const mappedCondition = mapIssueTagToCondition(normalizedTag);
  db.prepare('UPDATE room_inventory SET condition = ? WHERE room_id = ? AND LOWER(item_name) = LOWER(?)').run(mappedCondition, req.params.id, resolvedItemName);

  const room = db.prepare('SELECT room_number FROM rooms WHERE id = ?').get(req.params.id);
  logActivity('demirbas_sorunu_eklendi', `${room.room_number} odasında demirbaş sorunu eklendi: ${resolvedItemName} (${normalizedTag})`, description || null, safeUserId);
  emitReportRefresh(req, req.params.id);
  res.redirect(`/odalar/${req.params.id}#sorunlar`);
});

// Demirbaş sorununu arka planda çöz (tahsis modalları için)
router.post('/:id/demirbas-sorun-coz', (req, res) => {
  const roomId = Number.parseInt(req.params.id, 10);
  const itemName = String(req.body && req.body.item_name ? req.body.item_name : '').trim();
  if (!Number.isInteger(roomId) || !itemName) {
    return res.status(400).json({ ok: false, error: 'Geçersiz oda veya demirbaş bilgisi.' });
  }

  const room = db.prepare('SELECT room_number FROM rooms WHERE id = ?').get(roomId);
  if (!room) {
    return res.status(404).json({ ok: false, error: 'Oda bulunamadı.' });
  }

  const safeUserId = getSafeUserId(req);

  const tx = db.transaction(() => {
    const latestOpenIssue = db.prepare(`
      SELECT id
      FROM room_issues
      WHERE room_id = ?
        AND COALESCE(issue_type, 'oda') = 'demirbas'
        AND LOWER(COALESCE(inventory_item_name, '')) = LOWER(?)
        AND status != 'cozuldu'
      ORDER BY datetime(COALESCE(created_at, CURRENT_TIMESTAMP)) DESC, id DESC
      LIMIT 1
    `).get(roomId, itemName);

    let changes = 0;
    if (latestOpenIssue && latestOpenIssue.id) {
      const result = db.prepare(`
        UPDATE room_issues
        SET status = 'cozuldu',
            resolved_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(latestOpenIssue.id);
      changes = result.changes || 0;
    }

    syncInventoryConditionWithOpenIssues(roomId, itemName);
    return changes;
  });

  const resolvedCount = tx();

  logActivity(
    'demirbas_sorunu_cozuldu',
    `${room.room_number} odasında demirbaş sorunu çözüldü olarak işaretlendi: ${itemName}`,
    `Çözülen kayıt adedi: ${resolvedCount}`,
    safeUserId
  );

  emitReportRefresh(req, roomId);

  return res.json({ ok: true, resolvedCount, itemName, roomId });
});

// Sorun durumu güncelle
router.post('/:id/sorun/:issueId/guncelle', (req, res) => {
  const { status } = req.body;
  const issue = db.prepare('SELECT * FROM room_issues WHERE id = ? AND room_id = ?').get(req.params.issueId, req.params.id);
  if (!issue) return res.redirect(`/odalar/${req.params.id}`);

  const normalizedStatus = normalizeIssueStatus(status);
  db.prepare("UPDATE room_issues SET status = ?, resolved_at = CASE WHEN ? = 'cozuldu' THEN CURRENT_TIMESTAMP ELSE NULL END WHERE id = ?").run(normalizedStatus, normalizedStatus, req.params.issueId);

  const isInventoryIssue = (issue.issue_type === 'demirbas') || !!issue.inventory_item_name;
  if (isInventoryIssue) {
    const itemName = (issue.inventory_item_name || '').trim();
    if (itemName) {
      syncInventoryConditionWithOpenIssues(req.params.id, itemName);
    }
  }

  const room = db.prepare('SELECT room_number FROM rooms WHERE id = ?').get(req.params.id);
  logActivity('sorun_guncellendi', `${room.room_number} odasında sorun durumu güncellendi`, `Yeni durum: ${normalizedStatus}`, req.session.user.id);
  emitReportRefresh(req, req.params.id);
  res.redirect(`/odalar/${req.params.id}`);
});

// Sorun sil
router.post('/:id/sorun/:issueId/sil', (req, res) => {
  const issue = db.prepare('SELECT * FROM room_issues WHERE id = ? AND room_id = ?').get(req.params.issueId, req.params.id);
  if (!issue) return res.redirect(`/odalar/${req.params.id}`);

  db.prepare('DELETE FROM room_issues WHERE id = ? AND room_id = ?').run(req.params.issueId, req.params.id);

  if ((issue.issue_type === 'demirbas' || issue.inventory_item_name) && issue.inventory_item_name) {
    syncInventoryConditionWithOpenIssues(req.params.id, issue.inventory_item_name);
  }

  const room = db.prepare('SELECT room_number FROM rooms WHERE id = ?').get(req.params.id);
  logActivity('sorun_silindi', `${room.room_number} odasında sorun silindi`, issue.title || null, req.session.user.id);
  emitReportRefresh(req, req.params.id);
  res.redirect(`/odalar/${req.params.id}`);
});

// Demirbaş ekle
router.post('/:id/envanter-ekle', (req, res) => {
  const { item_name, item_name_select, item_name_manual, quantity, condition, notes } = req.body;
  const safeUserId = getSafeUserId(req);
  const directName = (item_name || '').trim();
  const selectedName = (item_name_select || '').trim();
  const manualName = (item_name_manual || '').trim();
  const resolvedItemName = directName || (selectedName === '__manual__' ? manualName : selectedName);
  if (!resolvedItemName) {
    return res.redirect(`/odalar/${req.params.id}?error=${encodeURIComponent('Demirbaş adı zorunludur.')}`);
  }

  const parsedQty = Number.parseInt(quantity, 10) || 1;
  const safeQty = clampQuantityForItem(req.params.id, resolvedItemName, parsedQty, parsedQty);
  const maxQuantity = (resolvedItemName || '').toLowerCase() === 'oda anahtarı' ? safeQty : null;

  db.prepare('INSERT OR IGNORE INTO equipment_items (name) VALUES (?)').run(resolvedItemName);
  db.prepare('INSERT INTO room_inventory (room_id, item_name, quantity, max_quantity, condition, notes, added_by) VALUES (?, ?, ?, ?, ?, ?, ?)').run(req.params.id, resolvedItemName, safeQty, maxQuantity, condition || 'saglam', notes || null, safeUserId);
  const room = db.prepare('SELECT room_number FROM rooms WHERE id = ?').get(req.params.id);
  logActivity('envanter_eklendi', `${room.room_number} odasına eşya eklendi: ${resolvedItemName}`, null, safeUserId);
  emitReportRefresh(req, req.params.id);
  res.redirect(`/odalar/${req.params.id}`);
});

// Demirbaş güncelle
router.post('/:id/envanter/:itemId/guncelle', (req, res) => {
  const { quantity, condition, notes } = req.body;
  const item = db.prepare('SELECT item_name, max_quantity FROM room_inventory WHERE id = ? AND room_id = ?').get(req.params.itemId, req.params.id);
  if (!item) return res.redirect(`/odalar/${req.params.id}`);

  const parsedQty = Number.parseInt(quantity, 10) || 1;
  const isRoomKey = (item.item_name || '').toLowerCase() === 'oda anahtarı';
  const safeQty = clampQuantityForItem(req.params.id, item.item_name, parsedQty, parsedQty);
  if (isRoomKey) {
    db.prepare('UPDATE room_inventory SET quantity = ?, max_quantity = ?, condition = ?, notes = ? WHERE id = ?').run(safeQty, safeQty, condition, notes || null, req.params.itemId);
  } else {
    db.prepare('UPDATE room_inventory SET quantity = ?, condition = ?, notes = ? WHERE id = ?').run(safeQty, condition, notes || null, req.params.itemId);
  }
  emitReportRefresh(req, req.params.id);
  res.redirect(`/odalar/${req.params.id}`);
});

// Demirbaş sil
router.post('/:id/envanter/:itemId/sil', (req, res) => {
  const item = db.prepare('SELECT item_name FROM room_inventory WHERE id = ?').get(req.params.itemId);
  db.prepare('DELETE FROM room_inventory WHERE id = ?').run(req.params.itemId);
  const room = db.prepare('SELECT room_number FROM rooms WHERE id = ?').get(req.params.id);
  if (item) {
    logActivity('envanter_silindi', `${room.room_number} odasından eşya silindi: ${item.item_name}`, null, req.session.user.id);
  }
  emitReportRefresh(req, req.params.id);
  res.redirect(`/odalar/${req.params.id}`);
});

// Demirbaş eksik bildir (adet düşür + sorun kaydı aç)
router.post('/:id/envanter/:itemId/eksik', (req, res) => {
  const item = db.prepare('SELECT * FROM room_inventory WHERE id = ? AND room_id = ?').get(req.params.itemId, req.params.id);
  const room = db.prepare('SELECT room_number FROM rooms WHERE id = ?').get(req.params.id);
  if (!item || !room) return res.redirect(`/odalar/${req.params.id}`);

  const rawUserId = req.session && req.session.user ? req.session.user.id : null;
  const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
  const safeUserId = actorUser ? actorUser.id : null;

  const newQuantity = Math.max((item.quantity || 1) - 1, 0);
  if (newQuantity > 0) {
    db.prepare('UPDATE room_inventory SET quantity = ? WHERE id = ?').run(newQuantity, item.id);
  } else {
    db.prepare('DELETE FROM room_inventory WHERE id = ?').run(item.id);
  }

  const issueTitle = `${item.item_name} eksik`;
  const issueDescription = `Demirbaş eksikliği bildirildi. Kalan adet: ${newQuantity}`;
  db.prepare("INSERT INTO room_issues (room_id, title, description, issue_type, inventory_item_name, issue_tag, reported_by) VALUES (?, ?, ?, 'demirbas', ?, 'eksik', ?)").run(
    req.params.id,
    issueTitle,
    issueDescription,
    item.item_name,
    safeUserId
  );

  logActivity('envanter_eksik_bildirildi', `${room.room_number} odasında demirbaş eksik bildirildi: ${item.item_name}`, issueDescription, safeUserId);
  emitReportRefresh(req, req.params.id);
  res.redirect(`/odalar/${req.params.id}#sorunlar`);
});

// Odaya personel ekle
router.post('/:id/personel-ekle', upload.single('photo'), (req, res) => {
  const { first_name, last_name, gender, phone, department, tc_number, form_signed, handover_payload, key_delivered, action } = req.body;
  const safeUserId = getSafeUserId(req);
  const normalizedTc = (tc_number || '').trim();
  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(req.params.id);
  if (!room || room.status === 'depo') return res.redirect('/odalar');

  const photoPath = req.file ? `/uploads/personnel/${req.file.filename}` : null;
  const isFormSigned = form_signed === 'on' ? 1 : 0;

  // TC kimlik numarası zorunludur
  if (!normalizedTc) {
    if (req.file) {
      const path = require('path');
      const fs = require('fs');
      fs.unlink(path.join(__dirname, '..', 'public', photoPath), () => {});
    }
    return res.status(400).send('TC kimlik no zorunludur.');
  }

  // TC numarası kontrolü (tum personellerde)
  let existingPerson = null;
  existingPerson = db.prepare('SELECT * FROM personnel WHERE tc_number = ?').get(normalizedTc);

  // Mevcut kimse varsa ve action belirtilmediyse, o kişinin bilgilerini gönder
  if (existingPerson && !action) {
    // Fotoğraf yüklendiyse ancak kayıt mevcut ise, yüklenen fotoğrafı sil
    if (req.file) {
      const path = require('path');
      const fs = require('fs');
      fs.unlink(path.join(__dirname, '..', 'public', photoPath), () => {});
    }
    return res.json({ duplicate: true, existingPerson, message: 'Bu kişi zaten sistemde kayıtlıdır.' });
  }

  // Eğer action="update" ise, mevcut kaydı güncelle
  if (action === 'update' && existingPerson) {
    const previousRoomId = existingPerson.room_id ? Number(existingPerson.room_id) : null;
    const roomCapacity = isRoomAtCapacity(Number(req.params.id), Number(existingPerson.id));
    if (roomCapacity.exists && roomCapacity.atCapacity) {
      if (req.file) {
        const path = require('path');
        const fs = require('fs');
        fs.unlink(path.join(__dirname, '..', 'public', photoPath), () => {});
      }
      return res.status(400).send('Bu oda kapasitesini doldurmuştur.');
    }
    const keyDeliveredValue = key_delivered === '1' ? 1 : 0;
    db.prepare('UPDATE personnel SET first_name = ?, last_name = ?, gender = ?, phone = ?, department = ?, room_id = ?, status = ?, check_in_date = ?, photo_path = ?, form_signed = ? WHERE id = ?').run(
      first_name, last_name, gender, phone || null, department || null, req.params.id, 'aktif', new Date().toISOString(), photoPath || existingPerson.photo_path, isFormSigned, existingPerson.id
    );
    db.prepare('UPDATE personnel SET key_delivered = ?, checkout_key_returned = NULL WHERE id = ?').run(keyDeliveredValue, existingPerson.id);
    db.prepare('UPDATE personnel SET checkout_room_id = NULL WHERE id = ?').run(existingPerson.id);
    [previousRoomId, Number(req.params.id)].filter(Boolean).forEach(syncRoomKeyStock);
    logActivity('personel_guncellendi', `${first_name} ${last_name} (TC: ${tc_number}) verilerine dayalı güncellendi - ${room.room_number}`, `Departman: ${department || '-'}`, safeUserId);
    if (handover_payload) {
      db.prepare('UPDATE personnel SET entry_handover_payload = ? WHERE id = ?').run(handover_payload, existingPerson.id);
    }
    // Fall through to handover processing
  } else {
    // Normal flow: yeni kayıt oluştur
    const roomCapacity = isRoomAtCapacity(Number(req.params.id));
    if (roomCapacity.exists && roomCapacity.atCapacity) {
      if (req.file) {
        const path = require('path');
        const fs = require('fs');
        fs.unlink(path.join(__dirname, '..', 'public', photoPath), () => {});
      }
      return res.status(400).send('Bu oda kapasitesini doldurmuştur.');
    }
    const keyDeliveredValue = key_delivered === '1' ? 1 : 0;
    const result = db.prepare('INSERT INTO personnel (first_name, last_name, gender, phone, department, room_id, status, tc_number, photo_path, form_signed, entry_handover_payload, key_delivered, check_in_date, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      first_name, last_name, gender, phone || null, department || null, req.params.id, 'aktif', normalizedTc, photoPath, isFormSigned, handover_payload || null, keyDeliveredValue, new Date().toISOString(), safeUserId
    );
  }

  // Demirbaş teslim checklist işlemleri
  let handoverItems = [];
  if (handover_payload) {
    try {
      const parsedPayload = JSON.parse(handover_payload);
      if (Array.isArray(parsedPayload.items)) {
        handoverItems = parsedPayload.items;
      }
    } catch (e) {
      handoverItems = [];
    }
  }

  syncHandoverIssuesForRoom(Number(req.params.id), handoverItems, safeUserId, 'oda tahsisinde sağlam teslim edilmedi.');

  // Oda anahtar adedini güncelle ve UI'a canlı olarak yayınla
  const roomId = Number(req.params.id);
  const syncedKeyQty = syncRoomKeyStock(roomId);

  if (req.app.locals.io) {
    req.app.locals.io.emit('personnel:room-update', {
      roomId,
      room_name: room.room_number,
      anahtar_sayisi: syncedKeyQty
    });
  }

  updateRoomStatus(parseInt(req.params.id));
  logActivity('personel_yerlesti', `${first_name} ${last_name} - ${room.room_number} numaralı odaya yerleştirildi`, `Departman: ${department || '-'}`, safeUserId);
  res.redirect(`/odalar/${req.params.id}`);
});

module.exports = router;
