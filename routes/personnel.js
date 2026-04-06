const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { db, logActivity, updateRoomStatus, syncRoomKeyStock, recordRoomEntry, recordRoomExit } = require('../database');
const { encryptTcNumber, createTcFingerprint, verifyTcNumber, blurTcNumber } = require('../middleware/tc-encryption');

const INVENTORY_ISSUE_TAGS = ['eksik', 'arizali', 'kirik', 'calismiyor', 'kayip', 'diger'];
const ROOM_AVAILABILITY_STATUSES = ['musait', 'temizlenmeli', 'kullanilamaz'];
const MIN_ROOM_KEY_COUNT = 0;

function normalizeRoomAvailabilityStatus(value) {
  const normalized = String(value || '').toLowerCase().trim();
  return ROOM_AVAILABILITY_STATUSES.includes(normalized) ? normalized : 'musait';
}

function parseBooleanFlag(value) {
  return value === true || value === '1' || value === 'true' || value === 'on';
}

function validateRoomAssignmentAvailability(room, allowCleaningOverride = false) {
  const availability = normalizeRoomAvailabilityStatus(room && room.availability_status ? room.availability_status : 'musait');

  if (availability === 'kullanilamaz') {
    return {
      ok: false,
      message: 'Bu oda kullanılamaz durumda olduğu için personel atanamaz.'
    };
  }

  if (availability === 'temizlenmeli' && !allowCleaningOverride) {
    return {
      ok: false,
      message: 'Bu oda temizlenmesi gerekiyor durumunda. Devam etmek için onay vermelisiniz.'
    };
  }

  return { ok: true };
}

async function findDuplicatePersonnelByTc(normalizedTc, excludePersonnelId = null) {
  const tcFingerprint = createTcFingerprint(normalizedTc);
  if (tcFingerprint) {
    const fingerprintMatch = excludePersonnelId
      ? db.prepare('SELECT id, tc_number_encrypted, tc_number_fingerprint FROM personnel WHERE id != ? AND tc_number_fingerprint = ? LIMIT 1').get(excludePersonnelId, tcFingerprint)
      : db.prepare('SELECT id, tc_number_encrypted, tc_number_fingerprint FROM personnel WHERE tc_number_fingerprint = ? LIMIT 1').get(tcFingerprint);

    if (fingerprintMatch) {
      return fingerprintMatch;
    }
  }

  const legacyEncryptedRows = excludePersonnelId
    ? db.prepare("SELECT id, tc_number_encrypted FROM personnel WHERE id != ? AND (tc_number_fingerprint IS NULL OR tc_number_fingerprint = '') AND tc_number_encrypted IS NOT NULL").all(excludePersonnelId)
    : db.prepare("SELECT id, tc_number_encrypted FROM personnel WHERE (tc_number_fingerprint IS NULL OR tc_number_fingerprint = '') AND tc_number_encrypted IS NOT NULL").all();

  for (const person of legacyEncryptedRows) {
    const isMatch = await verifyTcNumber(normalizedTc, person.tc_number_encrypted);
    if (isMatch) {
      return person;
    }
  }

  return null;
}

function getRoomKeyLimit(roomId, fallbackLimit = 0) {
  const keyRow = db.prepare("SELECT max_quantity, quantity FROM room_inventory WHERE room_id = ? AND LOWER(item_name) = LOWER('Oda Anahtarı')").get(roomId);
  if (!keyRow) return Math.max(MIN_ROOM_KEY_COUNT, Number(fallbackLimit || 0));
  const limit = Number(keyRow.max_quantity ?? keyRow.quantity ?? fallbackLimit ?? 0);
  return Math.max(MIN_ROOM_KEY_COUNT, limit);
}

function normalizeInventoryName(name) {
  return String(name || '').trim().toLocaleLowerCase('tr-TR');
}

function getRoomInventoryItemNames(roomId) {
  const numericRoomId = Number(roomId || 0);
  if (!numericRoomId) return [];

  const rows = db.prepare(`
    SELECT item_name
    FROM room_inventory
    WHERE room_id = ?
      AND item_name IS NOT NULL
    ORDER BY id ASC
  `).all(numericRoomId);

  const seen = new Set();
  const items = [];

  rows.forEach(row => {
    const itemName = String(row.item_name || '').trim();
    const key = normalizeInventoryName(itemName);
    if (!itemName) return;
    if (key === normalizeInventoryName('Oda Anahtarı')) return;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(itemName);
  });

  return items;
}

// Fotoğraf yükleme ayarları
const uploadDir = path.join(__dirname, '..', 'public', 'uploads', 'personnel');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

function normalizePhotoPath(photoPath) {
  const rawPath = String(photoPath || '').trim();
  if (!rawPath) return null;

  const normalizedSeparators = rawPath.replace(/\\/g, '/');
  const lowerValue = normalizedSeparators.toLowerCase();

  const uploadsWithLeadingSlashIndex = lowerValue.indexOf('/uploads/');
  if (uploadsWithLeadingSlashIndex >= 0) {
    return normalizedSeparators.slice(uploadsWithLeadingSlashIndex);
  }

  const uploadsIndex = lowerValue.indexOf('uploads/');
  if (uploadsIndex >= 0) {
    return `/${normalizedSeparators.slice(uploadsIndex)}`;
  }

  const publicIndex = lowerValue.indexOf('public/');
  if (publicIndex >= 0) {
    const afterPublic = normalizedSeparators.slice(publicIndex + 'public/'.length);
    return afterPublic.startsWith('/') ? afterPublic : `/${afterPublic}`;
  }

  const fileName = path.basename(normalizedSeparators);
  if (!fileName || fileName === '.' || fileName === '/') {
    return null;
  }

  return `/uploads/personnel/${fileName}`;
}

function getPhotoFileSystemPath(photoPath) {
  const normalizedPath = normalizePhotoPath(photoPath);
  if (!normalizedPath) return null;
  const relativePath = normalizedPath.replace(/^\/+/, '');
  return path.join(__dirname, '..', 'public', relativePath);
}

function saveCapturedPhotoData(dataUrl) {
  const raw = String(dataUrl || '').trim();
  if (!raw) return null;

  const match = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return null;

  const mimeType = String(match[1] || '').toLowerCase();
  const payload = match[2] || '';
  const extByMime = {
    'image/jpeg': '.jpg',
    'image/jpg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp'
  };

  const ext = extByMime[mimeType] || null;
  if (!ext) return null;

  try {
    const fileName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    const targetPath = path.join(uploadDir, fileName);
    const fileBuffer = Buffer.from(payload, 'base64');
    fs.writeFileSync(targetPath, fileBuffer);
    return `/uploads/personnel/${fileName}`;
  } catch (_) {
    return null;
  }
}

function decrementRoomKeyStock(roomId) {
  return syncRoomKeyStock(roomId);
}

function incrementRoomKeyStock(roomId) {
  return syncRoomKeyStock(roomId);
}

function normalizeIssueTag(tag) {
  const normalized = (tag || '').toLowerCase().trim();
  return INVENTORY_ISSUE_TAGS.includes(normalized) ? normalized : null;
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


const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    // Klasör yoksa oluştur
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
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

// Personel listesi
router.get('/', (req, res) => {
  const search = req.query.search || '';
  const department = req.query.department || '';
  const status = req.query.status || '';
  const createdAtFrom = req.query.created_at_from || '';
  const createdAtTo = req.query.created_at_to || '';
  const checkInFrom = req.query.check_in_from || '';
  const checkInTo = req.query.check_in_to || '';
  const checkOutFrom = req.query.check_out_from || '';
  const checkOutTo = req.query.check_out_to || '';
  const errorMessage = req.query.error || '';
  
  let query = `SELECT p.*, r.room_number FROM personnel p 
    LEFT JOIN rooms r ON p.room_id = r.id WHERE 1=1`;
  const params = [];

  if (search) {
    query += " AND (p.first_name LIKE ? OR p.last_name LIKE ? OR p.phone LIKE ?)";
    params.push(`${search}%`, `${search}%`, `${search}%`);
  }
  if (department) {
    query += ' AND p.department = ?';
    params.push(department);
  }
  if (status === 'aktif' || status === 'cikis_yapti' || status === 'bosta') {
    query += ' AND p.status = ?';
    params.push(status);
  }
  if (createdAtFrom) {
    query += ' AND DATE(p.created_at) >= DATE(?)';
    params.push(createdAtFrom);
  }
  if (createdAtTo) {
    query += ' AND DATE(p.created_at) <= DATE(?)';
    params.push(createdAtTo);
  }
  if (checkInFrom) {
    query += ' AND p.check_in_date IS NOT NULL AND DATE(p.check_in_date) >= DATE(?)';
    params.push(checkInFrom);
  }
  if (checkInTo) {
    query += ' AND p.check_in_date IS NOT NULL AND DATE(p.check_in_date) <= DATE(?)';
    params.push(checkInTo);
  }
  if (checkOutFrom) {
    query += ' AND p.check_out_date IS NOT NULL AND DATE(p.check_out_date) >= DATE(?)';
    params.push(checkOutFrom);
  }
  if (checkOutTo) {
    query += ' AND p.check_out_date IS NOT NULL AND DATE(p.check_out_date) <= DATE(?)';
    params.push(checkOutTo);
  }
  query += ' ORDER BY p.first_name, p.last_name';

  const personnel = db.prepare(query).all(...params);
  const departments = db.prepare('SELECT DISTINCT department FROM personnel WHERE department IS NOT NULL ORDER BY department').all();
  const rooms = db.prepare("SELECT id, room_number, capacity, availability_status, (SELECT COUNT(*) FROM personnel pp WHERE pp.room_id = rooms.id AND pp.status = 'aktif') as occupant_count FROM rooms WHERE status NOT IN ('bakimda', 'depo') AND COALESCE(availability_status, 'musait') != 'kullanilamaz' ORDER BY room_number").all();
  const availableRooms = rooms.filter(r => r.occupant_count < r.capacity);
  const roomAvailabilityMap = {};
  rooms.forEach(room => {
    roomAvailabilityMap[room.id] = normalizeRoomAvailabilityStatus(room.availability_status);
  });

  const inventoryRows = db.prepare("SELECT room_id, item_name, quantity, max_quantity FROM room_inventory WHERE room_id IN (SELECT id FROM rooms WHERE status NOT IN ('bakimda', 'depo'))").all();
  const roomInventoryMap = {};
  const roomInventoryItemsMap = {};
  const roomKeyLimitMap = {};
  inventoryRows.forEach(row => {
    if (!roomInventoryMap[row.room_id]) roomInventoryMap[row.room_id] = {};
    roomInventoryMap[row.room_id][row.item_name] = row.quantity || 0;

    const normalizedName = normalizeInventoryName(row.item_name);
    if (!roomInventoryItemsMap[row.room_id]) roomInventoryItemsMap[row.room_id] = [];
    if (normalizedName && normalizedName !== normalizeInventoryName('Oda Anahtarı')) {
      const hasItem = roomInventoryItemsMap[row.room_id].some(existing => normalizeInventoryName(existing) === normalizedName);
      if (!hasItem) {
        roomInventoryItemsMap[row.room_id].push(String(row.item_name || '').trim());
      }
    }

    if ((row.item_name || '').toLowerCase() === 'oda anahtarı') {
      roomKeyLimitMap[row.room_id] = Number(row.max_quantity ?? row.quantity ?? 0);
    }
  });

  const validIssueTags = ['eksik', 'arizali', 'kirik', 'calismiyor', 'kayip', 'diger'];
  const openInventoryIssues = db.prepare(`
    SELECT room_id, inventory_item_name, issue_tag, description, created_at
    FROM room_issues
    WHERE COALESCE(issue_type, 'oda') = 'demirbas'
      AND status != 'cozuldu'
      AND inventory_item_name IS NOT NULL
      AND issue_tag IS NOT NULL
    ORDER BY created_at DESC
  `).all();

  const roomOpenIssueMap = {};
  openInventoryIssues.forEach(issue => {
    const roomId = String(issue.room_id || '');
    const itemName = String(issue.inventory_item_name || '').trim();
    const tag = String(issue.issue_tag || '').toLowerCase().trim();
    if (!roomId || !itemName || !validIssueTags.includes(tag)) return;

    const itemKey = normalizeInventoryName(itemName);
    if (!roomOpenIssueMap[roomId]) roomOpenIssueMap[roomId] = {};

    if (roomOpenIssueMap[roomId][itemKey]) return;

    roomOpenIssueMap[roomId][itemKey] = {
      itemName,
      tag,
      description: issue.description || ''
    };
  });

  res.render('personnel/index', {
    title: 'Personel',
    personnel,
    departments,
    availableRooms,
    roomInventoryMap,
    roomInventoryItemsMap,
    roomKeyLimitMap,
    roomOpenIssueMap,
    roomAvailabilityMap,
    search,
    department,
    statusFilter: status,
    createdAtFrom,
    createdAtTo,
    checkInFrom,
    checkInTo,
    checkOutFrom,
    checkOutTo,
    errorMessage
  });
});

// Personel oda atama
router.post('/:id/oda-ata', (req, res) => {
  const personnelId = req.params.id;
  const { room_id, handover_payload, allow_cleaning_override } = req.body;
  const rawUserId = req.session && req.session.user ? req.session.user.id : null;
  const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
  const safeUserId = actorUser ? actorUser.id : null;

  if (!room_id) {
    return res.status(400).send('Oda seçimi zorunludur.');
  }

  const personnel = db.prepare('SELECT * FROM personnel WHERE id = ?').get(personnelId);
  if (!personnel) {
    return res.status(404).send('Personel bulunamadı.');
  }

  const room = db.prepare('SELECT * FROM rooms WHERE id = ?').get(room_id);
  if (!room) {
    return res.status(404).send('Oda bulunamadı.');
  }

  const availabilityCheck = validateRoomAssignmentAvailability(room, parseBooleanFlag(allow_cleaning_override));
  if (!availabilityCheck.ok) {
    return res.status(400).send(availabilityCheck.message);
  }

  const roomCapacity = isRoomAtCapacity(Number(room_id), Number(personnelId));
  if (roomCapacity.exists && roomCapacity.atCapacity) {
    return res.status(400).send('Bu oda kapasitesini doldurmuştur.');
  }

  try {
    let handoverData = null;
    try {
      handoverData = handover_payload ? JSON.parse(handover_payload) : null;
    } catch (_) {
      handoverData = null;
    }
    const handoverItems = handoverData && Array.isArray(handoverData.items) ? handoverData.items : [];
    const keyDeliveredValue = handoverData && handoverData.key_delivered ? 1 : 0;

    // 1. Personelin odasını güncelle
    const checkInAt = new Date().toISOString();
    db.prepare('UPDATE personnel SET room_id = ?, status = ?, check_in_date = ?, entry_handover_payload = ?, key_delivered = ?, checkout_key_returned = NULL, checkout_room_id = NULL WHERE id = ?').run(room_id, 'aktif', checkInAt, handover_payload || null, keyDeliveredValue, personnelId);
    recordRoomEntry(personnelId, room_id, checkInAt);
    logActivity('personel_atama', `Oda ${room.room_number}, ${personnel.first_name} ${personnel.last_name} adlı personele atandı.`, null, safeUserId);

    // 2. Oda durumunu güncelle
    updateRoomStatus(room_id);

    // 3. Zimmet formunu kaydet
    if (handoverData && handoverData.form_signed) {
      db.prepare('INSERT INTO handover_forms (personnel_id, room_id, form_type, is_signed, signed_at) VALUES (?, ?, ?, ?, ?)').run(personnelId, room_id, 'giris', 1, new Date().toISOString());
    }

    // 4. Demirbaşları kaydet
    handoverItems.forEach(item => {
      db.prepare('INSERT INTO personnel_inventory (personnel_id, room_id, item_name, status, description, handover_date) VALUES (?, ?, ?, ?, ?, ?)').run(
        personnelId,
        room_id,
        item.name,
        item.delivered ? 'sağlam' : (item.tag || 'teslim edilmedi'),
        item.delivered ? null : item.description,
        new Date().toISOString()
      );
    });
    syncHandoverIssuesForRoom(Number(room_id), handoverItems, safeUserId, 'oda tahsisinde sağlam teslim edilmedi.');

    // 5. Anahtar teslimini yönet
    if (handoverData && handoverData.key_delivered) {
      decrementRoomKeyStock(room_id);
      logActivity('anahtar_teslim', `Oda ${room.room_number} anahtarı ${personnel.first_name} ${personnel.last_name} adlı personele teslim edildi.`, null, safeUserId);
    } else {
      syncRoomKeyStock(room_id);
    }

    res.redirect('/personel');
  } catch (err) {
    console.error("Oda atama hatası:", err);
    res.status(500).send('Oda atama sırasında bir hata oluştu.');
  }
});

// Yeni personel ekle
router.post('/ekle', (req, res, next) => {
  upload.single('photo')(req, res, function (err) {
    if (err) {
      console.error('Personel ekleme hatası:', err);
      return res.status(500).send('Personel eklenirken sunucu hatası oluştu.');
    }
    next();
  });
});

// Personel ekle
router.post('/ekle', async (req, res) => {
  try {
    const { first_name, last_name, gender, phone, department, room_id, handover_payload, key_delivered, tc_number, form_signed, action, allow_cleaning_override } = req.body;
    const normalizedTc = (tc_number || '').trim();
    const uploadedPhotoPath = req.file ? `/uploads/personnel/${req.file.filename}` : null;
    const capturedPhotoPath = uploadedPhotoPath ? null : saveCapturedPhotoData(req.body.captured_photo_data);
    const photoPath = uploadedPhotoPath || capturedPhotoPath;
    const isFormSigned = form_signed === 'on' ? 1 : 0;
    const rawUserId = req.session && req.session.user ? req.session.user.id : null;
    const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
    const safeUserId = actorUser ? actorUser.id : null;
    const wantsJson = (req.headers.accept || '').includes('application/json') || req.xhr;

  // TC kimlik numarası zorunludur
    if (!normalizedTc) {
      if (req.file) {
        fs.unlink(path.join(uploadDir, req.file.filename), () => {});
      }
      if (wantsJson) {
        return res.status(400).json({ error: 'TC kimlik no zorunludur.' });
      }
      return res.status(400).send('TC kimlik no zorunludur.');
    }

    // TC numarasını şifrele
    let encryptedTc;
    try {
      encryptedTc = await encryptTcNumber(normalizedTc);
    } catch (error) {
      console.error('TC şifreleme hatası:', error);
      if (req.file) {
        fs.unlink(path.join(uploadDir, req.file.filename), () => {});
      }
      if (wantsJson) {
        return res.status(500).json({ error: 'Sistem hatası' });
      }
      return res.status(500).send('TC kaydı sırasında hata oluştu.');
    }
    const tcFingerprint = createTcFingerprint(normalizedTc);

  // TC numarası kontrolü - tüm personelleri getir ve şifreli TC ile eşleştir
    const duplicatePerson = await findDuplicatePersonnelByTc(normalizedTc);
    const existingPerson = duplicatePerson ? db.prepare('SELECT * FROM personnel WHERE id = ?').get(duplicatePerson.id) : null;

  // Mevcut kimse varsa ve action belirtilmediyse, o kişinin bilgilerini gönder
    if (existingPerson && !action) {
    // Fotoğraf yüklendiyse ancak kayıt mevcut ise, yüklenen fotoğrafı sil
    if (req.file) {
      fs.unlink(path.join(uploadDir, req.file.filename), () => {});
    }
      res.set('X-Skip-Live-Refresh', '1');
      return res.json({ duplicate: true, existingPerson, message: 'Bu kişi zaten sistemde kayıtlıdır.' });
    }

  // Eğer action="update" ise, mevcut kaydı güncelle
    if (action === 'update' && existingPerson) {
    const previousRoomId = existingPerson.room_id ? Number(existingPerson.room_id) : null;
    const nextRoomId = room_id ? parseInt(room_id) : null;
    if (nextRoomId) {
      const nextRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(nextRoomId);
      const availabilityCheck = validateRoomAssignmentAvailability(nextRoom, parseBooleanFlag(allow_cleaning_override));
      if (!availabilityCheck.ok) {
        if (req.file) {
          fs.unlink(path.join(uploadDir, req.file.filename), () => {});
        }
        if (wantsJson) {
          return res.status(400).json({ error: availabilityCheck.message });
        }
        return res.redirect('/personel?error=' + encodeURIComponent(availabilityCheck.message));
      }

      const roomCapacity = isRoomAtCapacity(nextRoomId, Number(existingPerson.id));
      if (roomCapacity.exists && roomCapacity.atCapacity) {
        if (req.file) {
          fs.unlink(path.join(uploadDir, req.file.filename), () => {});
        }
        if (wantsJson) {
          return res.status(400).json({ error: 'Bu oda kapasitesini doldurmuştur.' });
        }
        return res.redirect('/personel?error=' + encodeURIComponent('Bu oda kapasitesini doldurmuştur.'));
      }
    }
    const nextStatus = nextRoomId ? 'aktif' : 'bosta';
    const nextCheckInDate = nextRoomId ? new Date().toISOString() : null;
    const roomChangeAt = new Date().toISOString();
    const tcLastFour = normalizedTc.slice(-4);
    db.prepare('UPDATE personnel SET first_name = ?, last_name = ?, gender = ?, phone = ?, department = ?, room_id = ?, status = ?, check_in_date = ?, photo_path = ?, form_signed = ?, entry_handover_payload = ?, key_delivered = ?, tc_number_encrypted = ?, tc_number_fingerprint = ?, tc_last_four = ? WHERE id = ?').run(
      first_name, last_name, gender, phone || null, department || null,
      nextRoomId,
      nextStatus,
      nextCheckInDate,
      photoPath || normalizePhotoPath(existingPerson.photo_path),
      isFormSigned,
      handover_payload || null,
      key_delivered === '1' ? 1 : 0,
      encryptedTc,
      tcFingerprint,
      tcLastFour,
      existingPerson.id
    );
      if (previousRoomId && previousRoomId !== nextRoomId) {
        recordRoomExit(existingPerson.id, previousRoomId, roomChangeAt);
      }
      if (nextRoomId) {
        recordRoomEntry(existingPerson.id, nextRoomId, nextCheckInDate || roomChangeAt);
      }
      [previousRoomId, nextRoomId].filter(Boolean).forEach(syncRoomKeyStock);
      logActivity('personel_guncellendi', `${first_name} ${last_name} verilerine dayalı güncellendi`, `Departman: ${department || '-'}`, safeUserId);
      if (wantsJson) return res.json({ ok: true, redirect: '/personel', updated: true });
      return res.redirect('/personel');
    }

  // Normal flow: yeni kayıt oluştur
    const parsedRoomId = room_id ? parseInt(room_id) : null;
    if (parsedRoomId) {
      const selectedRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(parsedRoomId);
      const availabilityCheck = validateRoomAssignmentAvailability(selectedRoom, parseBooleanFlag(allow_cleaning_override));
      if (!availabilityCheck.ok) {
        if (req.file) {
          fs.unlink(path.join(uploadDir, req.file.filename), () => {});
        }
        if (wantsJson) {
          return res.status(400).json({ error: availabilityCheck.message });
        }
        return res.redirect('/personel?error=' + encodeURIComponent(availabilityCheck.message));
      }

      const roomCapacity = isRoomAtCapacity(parsedRoomId);
      if (roomCapacity.exists && roomCapacity.atCapacity) {
        if (req.file) {
          fs.unlink(path.join(uploadDir, req.file.filename), () => {});
        }
        if (wantsJson) {
          return res.status(400).json({ error: 'Bu oda kapasitesini doldurmuştur.' });
        }
        return res.redirect('/personel?error=' + encodeURIComponent('Bu oda kapasitesini doldurmuştur.'));
      }
    }
    const nextStatus = parsedRoomId ? 'aktif' : 'bosta';
    const checkInDate = parsedRoomId ? new Date().toISOString() : null;
    const tcLastFour = normalizedTc.slice(-4);
    const result = db.prepare('INSERT INTO personnel (first_name, last_name, gender, phone, department, room_id, status, tc_number_encrypted, tc_number_fingerprint, tc_last_four, photo_path, form_signed, entry_handover_payload, key_delivered, check_in_date, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      first_name, last_name, gender, phone || null, department || null,
      parsedRoomId,
      nextStatus,
      encryptedTc,
      tcFingerprint,
      tcLastFour,
      photoPath,
      isFormSigned,
      handover_payload || null,
      key_delivered === '1' ? 1 : 0,
      checkInDate,
      safeUserId
    );
    if (parsedRoomId) {
      recordRoomEntry(result.lastInsertRowid, parsedRoomId, checkInDate || new Date().toISOString());
    }

    if (room_id) {
    const parsedRoomId = parseInt(room_id);

    let handoverItems = [];
    if (handover_payload) {
      try {
        const parsedPayload = JSON.parse(handover_payload);
        if (Array.isArray(parsedPayload.items)) {
          handoverItems = parsedPayload.items;
        }
      } catch (_) {
        handoverItems = [];
      }
    }

    syncHandoverIssuesForRoom(parsedRoomId, handoverItems, safeUserId, 'oda tahsisinde sağlam teslim edilmedi.');
    syncRoomKeyStock(parsedRoomId);
    updateRoomStatus(parsedRoomId);
    const room = db.prepare('SELECT room_number FROM rooms WHERE id = ?').get(parseInt(room_id));
    logActivity('personel_yerlesti', `${first_name} ${last_name} - ${room ? room.room_number : ''} numaralı odaya yerleştirildi`, `Departman: ${department || '-'}`, safeUserId);
    } else {
      logActivity('personel_eklendi', `${first_name} ${last_name} eklendi (oda atanmadı)`, null, safeUserId);
    }

    if (wantsJson) return res.json({ ok: true, redirect: '/personel' });
    res.redirect('/personel');
  } catch (error) {
    console.error('Personel ekleme hatası:', error);
    if (req.file) {
      fs.unlink(path.join(uploadDir, req.file.filename), () => {});
    }
    const wantsJson = (req.headers.accept || '').includes('application/json') || req.xhr;
    if (wantsJson) {
      return res.status(500).json({ error: 'Personel eklenirken sunucu hatası oluştu.' });
    }
    return res.status(500).send('Personel eklenirken sunucu hatası oluştu.');
  }
});

// Personel ekle ve ata
router.post('/ekle-ve-ata', (req, res, next) => {
  upload.single('photo')(req, res, function (err) {
    if (err) {
      console.error('Personel ekleme ve atama hatası:', err);
      return res.status(500).send('Personel eklenirken sunucu hatası oluştu.');
    }
    next();
  });
});

router.post('/ekle-ve-ata', async (req, res) => {
  const { first_name, last_name, gender, phone, department, tc_number, room_id, handover_payload, allow_cleaning_override } = req.body;
  const normalizedTc = (tc_number || '').trim();
  const uploadedPhotoPath = req.file ? `/uploads/personnel/${req.file.filename}` : null;
  const capturedPhotoPath = uploadedPhotoPath ? null : saveCapturedPhotoData(req.body.captured_photo_data);
  const photoPath = uploadedPhotoPath || capturedPhotoPath;
  const rawUserId = req.session && req.session.user ? req.session.user.id : null;
  const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
  const safeUserId = actorUser ? actorUser.id : null;
  const parsedRoomId = Number.parseInt(room_id, 10);

  if (!Number.isInteger(parsedRoomId)) {
    return res.redirect('/odalar?error=' + encodeURIComponent('Oda bilgisi eksik.'));
  }

  if (!normalizedTc) {
    return res.redirect(`/odalar/${parsedRoomId}?error=` + encodeURIComponent('TC kimlik no zorunludur.'));
  }

  // TC numarasını şifrele
  let encryptedTc;
  try {
    encryptedTc = await encryptTcNumber(normalizedTc);
  } catch (error) {
    console.error('TC şifreleme hatası:', error);
    return res.redirect(`/odalar/${parsedRoomId}?error=` + encodeURIComponent('Sistem hatası'));
  }
  const tcFingerprint = createTcFingerprint(normalizedTc);

  // TC duplicate kontrolü - şifreli versiyonlarla karşılaştır
  const existingPerson = await findDuplicatePersonnelByTc(normalizedTc);

  if (existingPerson) {
    return res.redirect(`/odalar/${parsedRoomId}?error=` + encodeURIComponent('Bu kişi zaten sistemde kayıtlıdır.'));
  }

  const roomExists = db.prepare('SELECT id FROM rooms WHERE id = ?').get(parsedRoomId);
  if (!roomExists) {
    return res.redirect('/odalar?error=' + encodeURIComponent('Geçersiz oda bilgisi.'));
  }

  const selectedRoom = db.prepare('SELECT * FROM rooms WHERE id = ?').get(parsedRoomId);
  const availabilityCheck = validateRoomAssignmentAvailability(selectedRoom, parseBooleanFlag(allow_cleaning_override));
  if (!availabilityCheck.ok) {
    return res.redirect(`/odalar/${parsedRoomId}?error=` + encodeURIComponent(availabilityCheck.message));
  }

  const roomCapacity = isRoomAtCapacity(parsedRoomId);
  if (roomCapacity.exists && roomCapacity.atCapacity) {
    return res.redirect(`/odalar/${parsedRoomId}?error=` + encodeURIComponent('Bu oda kapasitesini doldurmuştur.'));
  }

  const transaction = db.transaction(() => {
    let handoverData = null;
    try {
      handoverData = handover_payload ? JSON.parse(handover_payload) : null;
    } catch (_) {
      handoverData = null;
    }
    const keyDeliveredValue = handoverData && handoverData.key_delivered ? 1 : 0;
    let syncedKeyQty = null;

    // 1. Personeli oluştur
    const checkInAt = new Date().toISOString();
    const tcLastFour = normalizedTc.slice(-4);
    const insertPersonnelResult = db.prepare(
      'INSERT INTO personnel (first_name, last_name, gender, phone, department, tc_number_encrypted, tc_number_fingerprint, tc_last_four, photo_path, room_id, entry_handover_payload, key_delivered, status, check_in_date, added_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(first_name, last_name, gender, phone, department, encryptedTc, tcFingerprint, tcLastFour, photoPath, parsedRoomId, handover_payload || null, keyDeliveredValue, 'aktif', checkInAt, safeUserId);
    
    const personnelId = insertPersonnelResult.lastInsertRowid;
    recordRoomEntry(personnelId, parsedRoomId, checkInAt);
    logActivity('personel_eklendi', `${first_name} ${last_name} adlı personel sisteme eklendi ve odaya atandı.`, `Oda ID: ${parsedRoomId}`, safeUserId);

    // 2. Oda durumunu güncelle
    updateRoomStatus(parsedRoomId);

    const room = db.prepare('SELECT room_number FROM rooms WHERE id = ?').get(parsedRoomId);

    // 3. Zimmet bilgilerini işle
    if (handoverData) {

      // Zimmet formu
      if (handoverData.form_signed) {
        db.prepare('INSERT INTO handover_forms (personnel_id, room_id, form_type, is_signed, signed_at) VALUES (?, ?, ?, ?, ?)').run(personnelId, parsedRoomId, 'giris', 1, new Date().toISOString());
      }

      // Demirbaşlar
      const handoverItems = Array.isArray(handoverData.items) ? handoverData.items : [];
      handoverItems.forEach(item => {
        db.prepare('INSERT INTO personnel_inventory (personnel_id, room_id, item_name, status, description, handover_date) VALUES (?, ?, ?, ?, ?, ?)').run(
          personnelId,
          parsedRoomId,
          item.name,
          item.delivered ? 'sağlam' : (item.tag || 'teslim edilmedi'),
          item.delivered ? null : item.description,
          new Date().toISOString()
        );
      });
      syncHandoverIssuesForRoom(parsedRoomId, handoverItems, safeUserId, 'oda tahsisinde sağlam teslim edilmedi.');

      // Anahtar teslimi
      if (handoverData.key_delivered) {
        syncedKeyQty = decrementRoomKeyStock(parsedRoomId);
        logActivity('anahtar_teslim', `Oda ${room.room_number} anahtarı ${first_name} ${last_name} adlı yeni personele teslim edildi.`, null, safeUserId);
      } else {
        syncedKeyQty = syncRoomKeyStock(parsedRoomId);
      }
    } else {
      syncedKeyQty = syncRoomKeyStock(parsedRoomId);
    }
    return { personnelId, syncedKeyQty, roomNumber: room ? room.room_number : null };
  });

  try {
    const result = transaction();
    if (req.app.locals.io) {
      req.app.locals.io.emit('personnel:room-update', {
        personnelId: Number(result.personnelId),
        roomId: parsedRoomId,
        room_name: result.roomNumber,
        anahtar_sayisi: result.syncedKeyQty
      });
    }
    res.redirect(`/odalar/${parsedRoomId}`);
  } catch (err) {
    console.error("Yeni personel ekleme ve atama hatası:", err);
    res.redirect(`/odalar/${parsedRoomId}?error=` + encodeURIComponent('İşlem sırasında bir hata oluştu.'));
  }
});

// Personel detay
router.get('/:id', (req, res) => {
  const person = db.prepare('SELECT p.*, r.room_number FROM personnel p LEFT JOIN rooms r ON p.room_id = r.id WHERE p.id = ?').get(req.params.id);
  if (!person) return res.redirect('/personel');

  person.photo_path = normalizePhotoPath(person.photo_path);

  const complaints = db.prepare('SELECT pc.*, u.full_name as recorder FROM personnel_complaints pc LEFT JOIN users u ON pc.recorded_by = u.id WHERE pc.personnel_id = ? ORDER BY pc.created_at DESC').all(person.id);
  const rooms = db.prepare("SELECT id, room_number, capacity, availability_status, (SELECT COUNT(*) FROM personnel pp WHERE pp.room_id = rooms.id AND pp.status = 'aktif') as occupant_count FROM rooms WHERE status NOT IN ('bakimda', 'depo') AND COALESCE(availability_status, 'musait') != 'kullanilamaz' ORDER BY room_number").all();
  const availableRooms = rooms.filter(r => r.occupant_count < r.capacity || r.id === person.room_id);
  const roomAvailabilityMap = {};
  rooms.forEach(room => {
    roomAvailabilityMap[room.id] = normalizeRoomAvailabilityStatus(room.availability_status);
  });

  const inventoryRows = db.prepare("SELECT room_id, item_name, quantity FROM room_inventory WHERE room_id IN (SELECT id FROM rooms WHERE status NOT IN ('bakimda', 'depo'))").all();
  const roomInventoryMap = {};
  const roomInventoryItemsMap = {};
  inventoryRows.forEach(row => {
    if (!roomInventoryMap[row.room_id]) roomInventoryMap[row.room_id] = {};
    roomInventoryMap[row.room_id][row.item_name] = row.quantity || 0;

    const normalizedName = normalizeInventoryName(row.item_name);
    if (!roomInventoryItemsMap[row.room_id]) roomInventoryItemsMap[row.room_id] = [];
    if (normalizedName && normalizedName !== normalizeInventoryName('Oda Anahtarı')) {
      const hasItem = roomInventoryItemsMap[row.room_id].some(existing => normalizeInventoryName(existing) === normalizedName);
      if (!hasItem) {
        roomInventoryItemsMap[row.room_id].push(String(row.item_name || '').trim());
      }
    }
  });

  const checkoutInventoryItems = getRoomInventoryItemNames(person.room_id);

  const parseHandoverItems = (payload) => {
    try {
      const parsed = payload ? JSON.parse(payload) : null;
      return parsed && Array.isArray(parsed.items) ? parsed.items : [];
    } catch (_) {
      return [];
    }
  };

  const dedupeHandoverItems = (items) => {
    const seen = new Set();
    return (items || []).filter(item => {
      const name = (item && item.name ? String(item.name) : '').trim();
      if (!name) return false;
      const key = name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  const entryHandoverItems = dedupeHandoverItems(parseHandoverItems(person.entry_handover_payload));
  const checkoutHandoverItems = dedupeHandoverItems(parseHandoverItems(person.checkout_handover_payload));

  const openCheckoutIssueMap = {};
  const roomOpenIssueMap = {};
  const validIssueTags = new Set(INVENTORY_ISSUE_TAGS);

  const allOpenInventoryIssues = db.prepare(`
    SELECT room_id, inventory_item_name, issue_tag, description
    FROM room_issues
    WHERE COALESCE(issue_type, 'oda') = 'demirbas'
      AND status != 'cozuldu'
      AND inventory_item_name IS NOT NULL
      AND issue_tag IS NOT NULL
    ORDER BY datetime(COALESCE(created_at, CURRENT_TIMESTAMP)) DESC, id DESC
  `).all();

  allOpenInventoryIssues.forEach(issue => {
    const roomId = String(issue.room_id || '');
    const itemName = String(issue.inventory_item_name || '').trim();
    const tag = String(issue.issue_tag || '').toLowerCase().trim();
    if (!roomId || !itemName || !validIssueTags.has(tag)) return;

    const itemKey = normalizeInventoryName(itemName);
    if (!roomOpenIssueMap[roomId]) roomOpenIssueMap[roomId] = {};
    if (!roomOpenIssueMap[roomId][itemKey]) {
      roomOpenIssueMap[roomId][itemKey] = {
        itemName,
        tag,
        description: issue.description || ''
      };
    }
  });

  if (person.room_id) {
    const openInventoryIssues = db.prepare(`
      SELECT inventory_item_name, issue_tag, description
      FROM room_issues
      WHERE room_id = ?
        AND COALESCE(issue_type, 'oda') = 'demirbas'
        AND status != 'cozuldu'
        AND inventory_item_name IS NOT NULL
        AND issue_tag IS NOT NULL
      ORDER BY datetime(COALESCE(created_at, CURRENT_TIMESTAMP)) DESC, id DESC
    `).all(person.room_id);

    openInventoryIssues.forEach(issue => {
      const itemName = String(issue.inventory_item_name || '').trim();
      const key = normalizeInventoryName(itemName);
      const tag = normalizeIssueTag(issue.issue_tag);
      if (!itemName || !tag) return;
      if (openCheckoutIssueMap[key]) return;

      openCheckoutIssueMap[key] = {
        itemName,
        tag,
        description: issue.description || ''
      };
    });
  }

  const personRoomHistory = db.prepare(`
    SELECT
      h.id,
      h.room_id,
      r.room_number,
      h.entry_at,
      h.exit_at
    FROM room_stay_history h
    LEFT JOIN rooms r ON r.id = h.room_id
    WHERE h.personnel_id = ?
    ORDER BY datetime(COALESCE(h.exit_at, h.entry_at, h.created_at, CURRENT_TIMESTAMP)) DESC, h.id DESC
  `).all(person.id);

  res.render('personnel/detail', {
    title: `${person.first_name} ${person.last_name}`,
    person,
    complaints,
    availableRooms,
    roomInventoryMap,
    roomInventoryItemsMap,
    checkoutInventoryItems,
    entryHandoverItems,
    checkoutHandoverItems,
    openCheckoutIssueMap,
    roomOpenIssueMap,
    roomAvailabilityMap,
    personRoomHistory
  });
});

// Personel güncelle
router.post('/:id/guncelle', upload.single('photo'), async (req, res) => {
  const {
    first_name,
    last_name,
    gender,
    phone,
    department,
    tc_number,
    form_signed,
    key_delivered
  } = req.body;

  const person = db.prepare('SELECT id, photo_path, room_id, key_delivered, tc_number_encrypted, tc_number_fingerprint, tc_last_four FROM personnel WHERE id = ?').get(req.params.id);
  if (!person) return res.redirect('/personel');

  const normalizedTc = (tc_number || '').trim();
  let encryptedTc = person.tc_number_encrypted || null;
  let tcFingerprint = person.tc_number_fingerprint || null;
  let tcLastFour = person.tc_last_four || null;

  if (normalizedTc) {
    if (!/^\d{11}$/.test(normalizedTc)) {
      if (req.file) {
        fs.unlink(path.join(uploadDir, req.file.filename), () => {});
      }
      return res.status(400).send('TC kimlik no 11 haneli olmalıdır.');
    }

    // TC numarasını şifrele
    try {
      encryptedTc = await encryptTcNumber(normalizedTc);
      tcFingerprint = createTcFingerprint(normalizedTc);
      tcLastFour = normalizedTc.slice(-4);
    } catch (error) {
      console.error('TC şifreleme hatası:', error);
      if (req.file) {
        fs.unlink(path.join(uploadDir, req.file.filename), () => {});
      }
      return res.status(500).send('TC kaydı sırasında hata oluştu.');
    }

    // TC duplicate kontrolü - diğer personelleri kontrol et (şu anki kişi hariç)
    const duplicateFound = await findDuplicatePersonnelByTc(normalizedTc, req.params.id);

    if (duplicateFound) {
      if (req.file) {
        fs.unlink(path.join(uploadDir, req.file.filename), () => {});
      }
      return res.status(400).send('Bu TC numarası başka bir personele aittir.');
    }
  }

  const rawUserId = req.session && req.session.user ? req.session.user.id : null;
  const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
  const safeUserId = actorUser ? actorUser.id : null;

  const isFormSigned = form_signed === 'on' ? 1 : 0;
  const isKeyDelivered = key_delivered === '1' ? 1 : 0;

  const uploadedPhotoPath = req.file ? `/uploads/personnel/${req.file.filename}` : null;
  const capturedPhotoPath = uploadedPhotoPath ? null : saveCapturedPhotoData(req.body.captured_photo_data);
  const photoPath = uploadedPhotoPath || capturedPhotoPath;
  const existingPhotoPath = normalizePhotoPath(person.photo_path);

  // Eğer yeni fotoğraf yüklendiyse, eskisini diskten sil
  if (photoPath && existingPhotoPath) {
    try {
      const oldPhotoFsPath = getPhotoFileSystemPath(existingPhotoPath);
      if (oldPhotoFsPath && fs.existsSync(oldPhotoFsPath)) {
        fs.unlink(oldPhotoFsPath, () => {});
      }
    } catch (_) {}
  }

  const updateTx = db.transaction(() => {
    const finalPhotoPath = photoPath || existingPhotoPath;
    db.prepare(
      'UPDATE personnel SET first_name = ?, last_name = ?, gender = ?, phone = ?, department = ?, tc_number_encrypted = ?, tc_number_fingerprint = ?, tc_last_four = ?, form_signed = ?, key_delivered = ?, photo_path = ? WHERE id = ?'
    ).run(
      first_name,
      last_name,
      gender,
      phone || null,
      department || null,
      encryptedTc,
      tcFingerprint,
      tcLastFour,
      isFormSigned,
      isKeyDelivered,
      finalPhotoPath,
      req.params.id
    );

    if (person.room_id) {
      syncRoomKeyStock(person.room_id);
    }

  });

  updateTx();

  logActivity('personel_guncellendi', `${first_name} ${last_name} bilgileri güncellendi`, null, safeUserId);
  res.redirect(`/personel/${req.params.id}`);
});

// Oda değiştir
router.post('/:id/oda-degistir', (req, res) => {
  const { new_room_id, reassign_handover_payload, reassign_form_signed, reassign_key_delivered, allow_cleaning_override } = req.body;
  const person = db.prepare('SELECT p.*, r.room_number as old_room FROM personnel p LEFT JOIN rooms r ON p.room_id = r.id WHERE p.id = ?').get(req.params.id);
  if (!person) return res.redirect('/personel');

  const rawUserId = req.session && req.session.user ? req.session.user.id : null;
  const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
  const safeUserId = actorUser ? actorUser.id : null;

  const oldRoomId = person.room_id;
  const parsedNewRoomId = new_room_id ? parseInt(new_room_id) : null;
  const roomChanged = oldRoomId !== parsedNewRoomId;
  let parsedPayload = null;

  try {
    parsedPayload = reassign_handover_payload ? JSON.parse(reassign_handover_payload) : null;
  } catch (_) {
    parsedPayload = null;
  }

  if (parsedNewRoomId) {
    const roomExists = db.prepare('SELECT * FROM rooms WHERE id = ?').get(parsedNewRoomId);
    if (!roomExists) {
      return res.status(400).send('Geçersiz yeni oda bilgisi.');
    }

    const availabilityCheck = validateRoomAssignmentAvailability(roomExists, parseBooleanFlag(allow_cleaning_override));
    if (!availabilityCheck.ok) {
      return res.status(400).send(availabilityCheck.message);
    }

    const roomCapacity = isRoomAtCapacity(parsedNewRoomId, Number(req.params.id));
    if (roomCapacity.exists && roomCapacity.atCapacity) {
      return res.status(400).send('Bu oda kapasitesini doldurmuştur.');
    }
  }

  if (person.status !== 'aktif' && parsedNewRoomId) {
    const isFormSigned = reassign_form_signed === '1';
    if (!isFormSigned) {
      return res.status(400).send('Yeniden oda tahsisi için zimmet formu zorunludur.');
    }

    const payloadItems = parsedPayload && Array.isArray(parsedPayload.items) ? parsedPayload.items : [];
    const expectedItems = getRoomInventoryItemNames(parsedNewRoomId);
    if (payloadItems.length !== expectedItems.length) {
      return res.status(400).send('Yeniden oda tahsisi için tüm demirbaş teslim bilgileri zorunludur.');
    }

    const allValid = expectedItems.every(itemName => {
      const item = payloadItems.find(i => normalizeInventoryName(i && i.name) === normalizeInventoryName(itemName));
      if (!item) return false;
      if (item.delivered) return true;
      return !!item.tag;
    });

    if (!allValid) {
      return res.status(400).send('Yeniden oda tahsisi için sorunlu demirbaşlarda sorun türü seçilmelidir.');
    }
  }

  const nextStatus = parsedNewRoomId ? 'aktif' : 'bosta';

  const roomChangeAt = new Date().toISOString();
  const transferResult = db.transaction(() => {
    let oldRoomKeyQty;
    let newRoomKeyQty;
    const oldKeyDeliveredValue = Number(person.key_delivered || 0) === 1 ? 1 : 0;
    let newKeyDeliveredValue = oldKeyDeliveredValue;

    if (person.status !== 'aktif' && parsedNewRoomId) {
      newKeyDeliveredValue = reassign_key_delivered === '1' ? 1 : 0;
      db.prepare('UPDATE personnel SET room_id = ?, status = ?, check_in_date = ?, entry_handover_payload = ?, form_signed = ?, key_delivered = ?, checkout_key_returned = NULL, checkout_room_id = NULL WHERE id = ?').run(
        parsedNewRoomId,
        nextStatus,
        roomChangeAt,
        reassign_handover_payload || null,
        1,
        newKeyDeliveredValue,
        req.params.id
      );

      // Yeniden oda tahsisinde demirbaş sorun kayıtlarını ve envanter durumlarını senkronize et
      const reassignItems = parsedPayload && Array.isArray(parsedPayload.items) ? parsedPayload.items : [];
      syncHandoverIssuesForRoom(parsedNewRoomId, reassignItems, safeUserId, 'yeniden oda tahsisinde sağlam teslim edilmedi.');
    } else {
      const updatedKeyDelivered = parsedNewRoomId ? Number(person.key_delivered || 0) : 0;
      db.prepare('UPDATE personnel SET room_id = ?, status = ?, key_delivered = ? WHERE id = ?').run(parsedNewRoomId, nextStatus, updatedKeyDelivered, req.params.id);
    }

    if (roomChanged && oldRoomId) {
      oldRoomKeyQty = syncRoomKeyStock(oldRoomId);
    }

    if (roomChanged && parsedNewRoomId) {
      newRoomKeyQty = syncRoomKeyStock(parsedNewRoomId);
    }

    return { oldRoomKeyQty, newRoomKeyQty };
  })();

  if (req.app.locals.io) {
    if (roomChanged && oldRoomId && transferResult.oldRoomKeyQty !== undefined) {
      req.app.locals.io.emit('personnel:room-update', {
        personId: req.params.id,
        roomId: oldRoomId,
        anahtar_sayisi: transferResult.oldRoomKeyQty
      });
    }
    if (roomChanged && parsedNewRoomId && transferResult.newRoomKeyQty !== undefined) {
      req.app.locals.io.emit('personnel:room-update', {
        personId: req.params.id,
        roomId: parsedNewRoomId,
        anahtar_sayisi: transferResult.newRoomKeyQty
      });
    }
  }

  if (oldRoomId) updateRoomStatus(oldRoomId);
  if (parsedNewRoomId) updateRoomStatus(parsedNewRoomId);

  if (roomChanged && oldRoomId) {
    recordRoomExit(req.params.id, oldRoomId, roomChangeAt);
  }
  if (parsedNewRoomId) {
    recordRoomEntry(req.params.id, parsedNewRoomId, roomChangeAt);
  }

  const newRoom = parsedNewRoomId ? db.prepare('SELECT room_number FROM rooms WHERE id = ?').get(parsedNewRoomId) : null;
  logActivity('oda_degisikligi', `${person.first_name} ${person.last_name} - Oda: ${person.old_room || 'Yok'} → ${newRoom ? newRoom.room_number : 'Yok'}`, null, safeUserId);

  if (person.status !== 'aktif' && parsedNewRoomId) {
    db.prepare('UPDATE personnel SET check_in_date = ?, check_out_date = NULL WHERE id = ?').run(roomChangeAt, req.params.id);
    db.prepare('INSERT INTO handover_forms (personnel_id, room_id, form_type, is_signed, signed_at) VALUES (?, ?, ?, ?, ?)').run(
      req.params.id,
      parsedNewRoomId,
      'giris',
      1,
      roomChangeAt
    );
    logActivity('personel_yeniden_aktif', `${person.first_name} ${person.last_name} odaya atandı ve aktif edildi`, null, safeUserId);
  }

  res.redirect(`/personel/${req.params.id}`);
});

// Personel çıkış
router.post('/:id/cikis', (req, res) => {
  const person = db.prepare('SELECT p.*, r.room_number FROM personnel p LEFT JOIN rooms r ON p.room_id = r.id WHERE p.id = ?').get(req.params.id);
  if (!person) return res.redirect('/personel');

  const rawUserId = req.session && req.session.user ? req.session.user.id : null;
  const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
  const safeUserId = actorUser ? actorUser.id : null;

  const checkoutPayload = req.body.checkout_payload || '';
  const keyReturned = req.body.key_returned === '1' ? 1 : 0;

  let parsedCheckout = null;
  try {
    parsedCheckout = checkoutPayload ? JSON.parse(checkoutPayload) : null;
  } catch (_) {
    parsedCheckout = null;
  }

  const checkoutItems = parsedCheckout && Array.isArray(parsedCheckout.items) ? parsedCheckout.items : [];
  const expectedCheckoutItems = getRoomInventoryItemNames(person.room_id);
  if (checkoutItems.length !== expectedCheckoutItems.length) {
    return res.status(400).send('Çıkış için tüm demirbaş teslim kontrolü zorunludur.');
  }

  const allValid = expectedCheckoutItems.every(itemName => {
    const item = checkoutItems.find(i => normalizeInventoryName(i && i.name) === normalizeInventoryName(itemName));
    if (!item) return false;
    if (item.delivered) return true;
    return !!normalizeIssueTag(item.tag);
  });
  if (!allValid) {
    return res.status(400).send('Çıkış için tüm demirbaşlar işaretlenmeli ve sorunlu olanlar için tür seçilmelidir.');
  }

  const oldRoomId = person.room_id;
  const checkoutFormSigned = parsedCheckout && (parsedCheckout.form_signed === true || parsedCheckout.form_signed === 1 || parsedCheckout.form_signed === '1') ? 1 : 0;

  const checkoutAt = new Date().toISOString();
  const checkoutTx = db.transaction(() => {
    db.prepare("UPDATE personnel SET status = 'cikis_yapti', check_out_date = ?, checkout_room_id = ?, room_id = NULL, checkout_handover_payload = ?, checkout_key_returned = ? WHERE id = ?").run(
      checkoutAt,
      oldRoomId,
      checkoutPayload,
      keyReturned,
      req.params.id
    );

    if (oldRoomId) {
      recordRoomExit(req.params.id, oldRoomId, checkoutAt);
      db.prepare('INSERT INTO handover_forms (personnel_id, room_id, form_type, is_signed, signed_at) VALUES (?, ?, ?, ?, ?)').run(
        req.params.id,
        oldRoomId,
        'cikis',
        checkoutFormSigned,
        checkoutAt
      );

      checkoutItems.forEach(item => {
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
        `).get(oldRoomId, itemName);

        if (item.delivered) {
          if (latestOpenIssue && latestOpenIssue.id) {
            db.prepare("UPDATE room_issues SET status = 'cozuldu', resolved_at = CURRENT_TIMESTAMP WHERE id = ?").run(latestOpenIssue.id);
          }
          syncInventoryConditionWithOpenIssues(oldRoomId, itemName);
          return;
        }

        const normalizedTag = normalizeIssueTag(item.tag);
        if (!normalizedTag) return;

        const description = (item.description || '').trim();
        const issueDescription = description || `${itemName} personel çıkışında sağlam teslim alınamadı.`;

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
            oldRoomId,
            `${itemName} teslim sorunu`,
            issueDescription,
            itemName,
            normalizedTag,
            safeUserId
          );
        }

        syncInventoryConditionWithOpenIssues(oldRoomId, itemName);
      });
    }
  });

  checkoutTx();

  if (oldRoomId && Number(person.key_delivered || 0) === 1 && keyReturned === 0) {
    db.prepare(`
      UPDATE room_inventory
      SET max_quantity = MAX(COALESCE(max_quantity, quantity, 0) - 1, 0)
      WHERE room_id = ? AND LOWER(item_name) = LOWER('Oda Anahtarı')
    `).run(oldRoomId);

    const normalizedQty = syncRoomKeyStock(oldRoomId);
    if (req.app.locals.io) {
      req.app.locals.io.emit('personnel:room-update', {
        personId: req.params.id,
        roomId: oldRoomId,
        anahtar_sayisi: normalizedQty
      });
    }

    logActivity('anahtar_teslim_edilmedi', `Oda ${person.room_number || '-'} anahtari teslim edilmedi, toplam anahtar stogu 1 azaltildi.`, null, safeUserId);
  }

  if (oldRoomId && keyReturned === 1) {
    const newKeyQty = incrementRoomKeyStock(oldRoomId);
    // Socket.IO event yay
    if (req.app.locals.io) {
      req.app.locals.io.emit('personnel:room-update', {
        personId: req.params.id,
        roomId: oldRoomId,
        anahtar_sayisi: newKeyQty
      });
    }
  }
  if (oldRoomId) updateRoomStatus(oldRoomId);

  logActivity('personel_cikis', `${person.first_name} ${person.last_name} - ${person.room_number || '-'} odasından çıkış yaptı`, null, safeUserId);
  // Çıkış sonrası kişinin kendi detay sayfasına dön
  res.redirect(`/personel/${req.params.id}`);
});

// Personel sil
router.post('/:id/sil', (req, res) => {
  try {
    const person = db.prepare('SELECT id, first_name, last_name, room_id, photo_path FROM personnel WHERE id = ?').get(req.params.id);
    if (!person) return res.redirect('/personel');

    // Güvenlik: Aktif personel yanlışlıkla silinmesin. Önce çıkış yaptırılmalı.
    const statusRow = db.prepare('SELECT status FROM personnel WHERE id = ?').get(req.params.id);
    if (statusRow && statusRow.status === 'aktif') {
      return res.redirect(`/personel/${req.params.id}`);
    }

    const personelId = person.id;
    const oldRoomId = person.room_id;
    const rawUserId = req.session && req.session.user ? req.session.user.id : null;
    const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
    const safeUserId = actorUser ? actorUser.id : null;

    const deletePersonnelTx = db.transaction((id) => {
      db.prepare('DELETE FROM personnel_complaints WHERE personnel_id = ?').run(id);
      db.prepare('DELETE FROM inventory_mutations WHERE personnel_id = ?').run(id);
      db.prepare('DELETE FROM handover_forms WHERE personnel_id = ?').run(id);
      db.prepare('DELETE FROM personnel_inventory WHERE personnel_id = ?').run(id);
      db.prepare('DELETE FROM room_stay_history WHERE personnel_id = ?').run(id);
      db.prepare('DELETE FROM personnel WHERE id = ?').run(id);
    });

    deletePersonnelTx(personelId);

    if (person.photo_path) {
      const photoPath = getPhotoFileSystemPath(person.photo_path);
      if (photoPath && fs.existsSync(photoPath)) {
        fs.unlink(photoPath, (err) => {
          if (err) console.error('Fotoğraf silme hatası:', err);
        });
      }
    }

    if (oldRoomId) {
      updateRoomStatus(oldRoomId);
    }

    logActivity('personel_silindi', `${person.first_name} ${person.last_name} tamamen silinmiş`, null, safeUserId);
    return res.redirect('/personel');
  } catch (error) {
    console.error('Personel silme hatası:', error);
    return res.status(500).send('Personel silinirken sunucu hatası oluştu.');
  }
});

// Şikayet ekle
router.post('/:id/sikayet-ekle', (req, res) => {
  const { title, description } = req.body;
  const rawUserId = req.session && req.session.user ? req.session.user.id : null;
  const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
  const safeUserId = actorUser ? actorUser.id : null;

  db.prepare('INSERT INTO personnel_complaints (personnel_id, title, description, recorded_by) VALUES (?, ?, ?, ?)').run(
    req.params.id,
    title,
    description || null,
    safeUserId
  );
  const person = db.prepare('SELECT first_name, last_name FROM personnel WHERE id = ?').get(req.params.id);
  logActivity('sikayet_eklendi', `${person.first_name} ${person.last_name} için şikayet kaydı: ${title}`, null, safeUserId);
  
  // Rapor sayfasını yenile
  if (req.app.locals.io) {
    req.app.locals.io.emit('report:refresh', {
      source: 'personnel',
      type: 'complaint_added',
      personnelId: Number(req.params.id),
      ts: Date.now()
    });
  }
  
  res.redirect(`/personel/${req.params.id}`);
});

// Şikayet düzenle
router.post('/:id/sikayet/:complaintId/duzenle', (req, res) => {
  const { title, description } = req.body;
  db.prepare('UPDATE personnel_complaints SET title = ?, description = ? WHERE id = ? AND personnel_id = ?').run(
    title,
    description || null,
    req.params.complaintId,
    req.params.id
  );
  
  // Rapor sayfasını yenile
  if (req.app.locals.io) {
    req.app.locals.io.emit('report:refresh', {
      source: 'personnel',
      type: 'complaint_updated',
      personnelId: Number(req.params.id),
      ts: Date.now()
    });
  }
  
  res.redirect(`/personel/${req.params.id}`);
});

// Şikayet sil
router.post('/:id/sikayet/:complaintId/sil', (req, res) => {
  db.prepare('DELETE FROM personnel_complaints WHERE id = ? AND personnel_id = ?').run(req.params.complaintId, req.params.id);
  
  // Rapor sayfasını yenile
  if (req.app.locals.io) {
    req.app.locals.io.emit('report:refresh', {
      source: 'personnel',
      type: 'complaint_deleted',
      personnelId: Number(req.params.id),
      ts: Date.now()
    });
  }
  
  res.redirect(`/personel/${req.params.id}`);
});

module.exports = router;
