const Database = require('better-sqlite3');
const path = require('path');
const { encryptTcNumberSync, createTcFingerprint } = require('./middleware/tc-encryption');

const dbPath = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(__dirname, 'lojman.db');
const db = new Database(dbPath);

function formatLocalTimestamp(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}`;
}

// WAL mode for better performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function initDatabase() {
  db.exec(`
    -- Kullanıcılar (giriş sistemi)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Odalar
    CREATE TABLE IF NOT EXISTS rooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_number INTEGER UNIQUE NOT NULL,
      capacity INTEGER NOT NULL DEFAULT 1,
      floor TEXT,
      description TEXT,
      status TEXT DEFAULT 'bos' CHECK(status IN ('bos', 'dolu', 'kismi_dolu', 'bakimda', 'depo')),
      availability_status TEXT DEFAULT 'musait' CHECK(availability_status IN ('musait', 'temizlenmeli', 'kullanilamaz')),
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    -- Oda Sorunları
    CREATE TABLE IF NOT EXISTS room_issues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'acik' CHECK(status IN ('acik', 'devam_ediyor', 'cozuldu')),
      reported_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME,
      FOREIGN KEY (room_id) REFERENCES rooms(id),
      FOREIGN KEY (reported_by) REFERENCES users(id)
    );

    -- Oda Demirbaş Eşyaları
    CREATE TABLE IF NOT EXISTS room_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      item_name TEXT NOT NULL,
      quantity INTEGER DEFAULT 1,
      max_quantity INTEGER,
      condition TEXT DEFAULT 'saglam' CHECK(condition IN ('saglam', 'eksik', 'arizali', 'kirik', 'calismiyor', 'kayip', 'diger')),
      notes TEXT,
      added_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id),
      FOREIGN KEY (added_by) REFERENCES users(id)
    );

    -- Personeller
    CREATE TABLE IF NOT EXISTS personnel (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      gender TEXT CHECK(gender IN ('erkek', 'kadin')),
      phone TEXT,
      department TEXT,
      room_id INTEGER,
      status TEXT DEFAULT 'bosta' CHECK(status IN ('aktif', 'cikis_yapti', 'bosta')),
      check_in_date DATETIME,
      check_out_date DATETIME,
      added_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id),
      FOREIGN KEY (added_by) REFERENCES users(id)
    );

    -- Personel Şikayetleri
    CREATE TABLE IF NOT EXISTS personnel_complaints (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personnel_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT DEFAULT 'acik' CHECK(status IN ('acik', 'inceleniyor', 'cozuldu')),
      recorded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (personnel_id) REFERENCES personnel(id),
      FOREIGN KEY (recorded_by) REFERENCES users(id)
    );

    -- Giriş/Çıkış Listesi (gelecek planlaması)
    CREATE TABLE IF NOT EXISTS entry_exit_list (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      person_name TEXT NOT NULL,
      phone TEXT,
      department TEXT,
      type TEXT NOT NULL CHECK(type IN ('giris', 'cikis')),
      planned_date DATE NOT NULL,
      notes TEXT,
      status TEXT DEFAULT 'bekliyor' CHECK(status IN ('bekliyor', 'tamamlandi', 'iptal')),
      added_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (added_by) REFERENCES users(id)
    );

    -- Hareket Geçmişi (audit log)
    CREATE TABLE IF NOT EXISTS activity_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL,
      description TEXT NOT NULL,
      details TEXT,
      performed_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (performed_by) REFERENCES users(id)
    );

    -- Ortak Eşya Takibi
    CREATE TABLE IF NOT EXISTS shared_equipment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      item_name TEXT NOT NULL,
      given_to TEXT NOT NULL,
      room_number INTEGER,
      given_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      returned_at DATETIME,
      status TEXT DEFAULT 'teslim_edildi' CHECK(status IN ('teslim_edildi', 'iade_edildi', 'kayip')),
      notes TEXT,
      recorded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recorded_by) REFERENCES users(id)
    );

    -- Ziyaretçiler
    CREATE TABLE IF NOT EXISTS visitors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      visitor_name TEXT NOT NULL,
      purpose TEXT NOT NULL,
      company TEXT,
      phone TEXT,
      visit_date DATETIME DEFAULT CURRENT_TIMESTAMP,
      departure_time DATETIME,
      deleted_at DATETIME,
      notes TEXT,
      recorded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recorded_by) REFERENCES users(id)
    );

    -- Yangın Alarmları
    CREATE TABLE IF NOT EXISTS fire_alarms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location TEXT NOT NULL,
      alarm_time DATETIME DEFAULT CURRENT_TIMESTAMP,
      is_real INTEGER DEFAULT 0,
      description TEXT,
      action_taken TEXT,
      recorded_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (recorded_by) REFERENCES users(id)
    );
  `);

  // Şema migration'ları - mevcut veritabanını veri kaybetmeden günceller
  runMigrations();
}

function runMigrations() {
  // rooms tablosundaki CHECK constraint'i güncelle (depo durumu desteği)
  const roomTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='rooms'").get();
  if (roomTableSql && !roomTableSql.sql.includes('depo')) {
    db.exec(`
      CREATE TABLE rooms_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_number INTEGER UNIQUE NOT NULL,
        capacity INTEGER NOT NULL DEFAULT 1,
        floor TEXT,
        description TEXT,
        status TEXT DEFAULT 'bos' CHECK(status IN ('bos', 'dolu', 'kismi_dolu', 'bakimda', 'depo')),
        availability_status TEXT DEFAULT 'musait' CHECK(availability_status IN ('musait', 'temizlenmeli', 'kullanilamaz')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO rooms_new (id, room_number, capacity, floor, description, status, availability_status, created_at)
      SELECT id, room_number, capacity, floor, description, status, 'musait', created_at FROM rooms;
      DROP TABLE rooms;
      ALTER TABLE rooms_new RENAME TO rooms;
    `);
    console.log('Migration: rooms tablosuna depo durumu eklendi');
  }

  // room_number kolonu TEXT ise INTEGER'a çevir
  if (roomTableSql && roomTableSql.sql.includes('room_number TEXT')) {
    db.exec(`
      CREATE TABLE rooms_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_number INTEGER UNIQUE NOT NULL,
        capacity INTEGER NOT NULL DEFAULT 1,
        floor TEXT,
        description TEXT,
        status TEXT DEFAULT 'bos' CHECK(status IN ('bos', 'dolu', 'kismi_dolu', 'bakimda', 'depo')),
        availability_status TEXT DEFAULT 'musait' CHECK(availability_status IN ('musait', 'temizlenmeli', 'kullanilamaz')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO rooms_new (id, room_number, capacity, floor, description, status, availability_status, created_at)
      SELECT id, room_number, capacity, floor, description, status, 'musait', created_at FROM rooms;
      DROP TABLE rooms;
      ALTER TABLE rooms_new RENAME TO rooms;
    `);
    console.log('Migration: room_number INTEGER olarak güncellendi');
  }

  const roomColumns = db.prepare('PRAGMA table_info(rooms)').all();
  const hasAvailabilityStatus = roomColumns.some(col => col.name === 'availability_status');
  if (!hasAvailabilityStatus) {
    db.exec("ALTER TABLE rooms ADD COLUMN availability_status TEXT DEFAULT 'musait'");
    db.exec("UPDATE rooms SET availability_status = 'musait' WHERE availability_status IS NULL OR availability_status = ''");
    console.log('Migration: rooms tablosuna availability_status alanı eklendi');
  }

  // Kayıtlı eşya isimleri tablosu
  db.exec(`
    CREATE TABLE IF NOT EXISTS equipment_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_mutations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personnel_id INTEGER NOT NULL,
      room_id INTEGER,
      item_name TEXT NOT NULL,
      delta_quantity INTEGER DEFAULT 0,
      condition_after TEXT,
      reason TEXT,
      created_by INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (personnel_id) REFERENCES personnel(id),
      FOREIGN KEY (room_id) REFERENCES rooms(id),
      FOREIGN KEY (created_by) REFERENCES users(id)
    );
  `);

  // Zimmet formlari ve personel demirbas kayitlari (geriye donuk uyumluluk)
  db.exec(`
    CREATE TABLE IF NOT EXISTS handover_forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personnel_id INTEGER NOT NULL,
      room_id INTEGER,
      form_type TEXT NOT NULL CHECK(form_type IN ('giris', 'cikis')),
      is_signed INTEGER DEFAULT 0,
      signed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (personnel_id) REFERENCES personnel(id),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS personnel_inventory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      personnel_id INTEGER NOT NULL,
      room_id INTEGER,
      item_name TEXT NOT NULL,
      status TEXT,
      description TEXT,
      handover_date DATETIME,
      return_date DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (personnel_id) REFERENCES personnel(id),
      FOREIGN KEY (room_id) REFERENCES rooms(id)
    );

    CREATE TABLE IF NOT EXISTS room_stay_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      room_id INTEGER NOT NULL,
      personnel_id INTEGER NOT NULL,
      first_name TEXT,
      last_name TEXT,
      tc_number TEXT,
      department TEXT,
      entry_at DATETIME,
      exit_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (room_id) REFERENCES rooms(id),
      FOREIGN KEY (personnel_id) REFERENCES personnel(id)
    );
  `);

  const entryExitColumns = db.prepare('PRAGMA table_info(entry_exit_list)').all();
  const hasEntryDate = entryExitColumns.some(col => col.name === 'entry_date');
  const hasExitDate = entryExitColumns.some(col => col.name === 'exit_date');
  if (!hasEntryDate) {
    db.exec('ALTER TABLE entry_exit_list ADD COLUMN entry_date DATETIME');
  }
  if (!hasExitDate) {
    db.exec('ALTER TABLE entry_exit_list ADD COLUMN exit_date DATETIME');
  }

  const visitorsColumns = db.prepare('PRAGMA table_info(visitors)').all();
  const hasVisitorDeletedAt = visitorsColumns.some(col => col.name === 'deleted_at');
  if (!hasVisitorDeletedAt) {
    db.exec('ALTER TABLE visitors ADD COLUMN deleted_at DATETIME');
    console.log('Migration: visitors tablosuna deleted_at alanı eklendi');
  }

  // room_issues tablosuna demirbaş/oda ayrımı için kolonlar ekle
  const roomIssuesColumns = db.prepare('PRAGMA table_info(room_issues)').all();
  const hasIssueType = roomIssuesColumns.some(col => col.name === 'issue_type');
  const hasInventoryItemName = roomIssuesColumns.some(col => col.name === 'inventory_item_name');
  const hasIssueTag = roomIssuesColumns.some(col => col.name === 'issue_tag');

  if (!hasIssueType) {
    db.exec("ALTER TABLE room_issues ADD COLUMN issue_type TEXT DEFAULT 'oda'");
  }
  if (!hasInventoryItemName) {
    db.exec('ALTER TABLE room_issues ADD COLUMN inventory_item_name TEXT');
  }
  if (!hasIssueTag) {
    db.exec('ALTER TABLE room_issues ADD COLUMN issue_tag TEXT');
  }

  const roomInventoryColumns = db.prepare('PRAGMA table_info(room_inventory)').all();
  const hasMaxQuantity = roomInventoryColumns.some(col => col.name === 'max_quantity');
  if (!hasMaxQuantity) {
    db.exec('ALTER TABLE room_inventory ADD COLUMN max_quantity INTEGER');
    console.log('Migration: room_inventory tablosuna max_quantity alanı eklendi');
  }

  const roomInventoryTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='room_inventory'").get();
  if (roomInventoryTableSql && !roomInventoryTableSql.sql.includes("'saglam'")) {
    const roomInventoryNewTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='room_inventory_new'").get();
    if (roomInventoryNewTable) {
      // Önceki başarısız migration denemesinden kalmış geçici tabloyu temizle.
      db.exec('DROP TABLE room_inventory_new');
    }

    db.exec(`
      CREATE TABLE room_inventory_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room_id INTEGER NOT NULL,
        item_name TEXT NOT NULL,
        quantity INTEGER DEFAULT 1,
        max_quantity INTEGER,
        condition TEXT DEFAULT 'saglam' CHECK(condition IN ('saglam', 'eksik', 'arizali', 'kirik', 'calismiyor', 'kayip', 'diger')),
        notes TEXT,
        added_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (room_id) REFERENCES rooms(id),
        FOREIGN KEY (added_by) REFERENCES users(id)
      );

      INSERT INTO room_inventory_new (id, room_id, item_name, quantity, max_quantity, condition, notes, added_by, created_at)
      SELECT
        ri.id,
        ri.room_id,
        ri.item_name,
        ri.quantity,
        ri.max_quantity,
        CASE
          WHEN ri.condition = 'iyi' THEN 'saglam'
          WHEN ri.condition = 'orta' THEN 'diger'
          WHEN ri.condition = 'kotu' THEN 'arizali'
          WHEN ri.condition IN ('saglam', 'eksik', 'arizali', 'kirik', 'calismiyor', 'kayip', 'diger') THEN ri.condition
          ELSE 'saglam'
        END,
        ri.notes,
        CASE WHEN u.id IS NULL THEN NULL ELSE ri.added_by END,
        ri.created_at
      FROM room_inventory ri
      INNER JOIN rooms r ON r.id = ri.room_id
      LEFT JOIN users u ON u.id = ri.added_by;

      DROP TABLE room_inventory;
      ALTER TABLE room_inventory_new RENAME TO room_inventory;
    `);
    console.log('Migration: room_inventory condition etiket modeli guncellendi');
  }

  db.exec(`
    UPDATE room_inventory
    SET max_quantity = CASE
      WHEN LOWER(item_name) = LOWER('Oda Anahtarı') THEN MAX(COALESCE(max_quantity, quantity, 0), 0)
      ELSE max_quantity
    END
    WHERE LOWER(item_name) = LOWER('Oda Anahtarı')
  `);

  db.exec(`
    UPDATE room_inventory
    SET quantity = CASE
      WHEN LOWER(item_name) = LOWER('Oda Anahtarı') THEN MAX(0, MIN(COALESCE(quantity, 0), COALESCE(max_quantity, 0)))
      ELSE MAX(COALESCE(quantity, 0), 0)
    END
  `);

  // Personnel tablosuna TC kimlik, fotoğraf ve form_signed alanları ekle
  const personnelColumns = db.prepare('PRAGMA table_info(personnel)').all();
  const hasTcNumber = personnelColumns.some(col => col.name === 'tc_number');
  const hasTcNumberEncrypted = personnelColumns.some(col => col.name === 'tc_number_encrypted');
  const hasTcNumberFingerprint = personnelColumns.some(col => col.name === 'tc_number_fingerprint');
  const hasPhotoPath = personnelColumns.some(col => col.name === 'photo_path');
  const hasFormSigned = personnelColumns.some(col => col.name === 'form_signed');
  const hasHandoverPayload = personnelColumns.some(col => col.name === 'handover_payload');
  const hasEntryHandoverPayload = personnelColumns.some(col => col.name === 'entry_handover_payload');
  const hasCheckoutHandoverPayload = personnelColumns.some(col => col.name === 'checkout_handover_payload');
  const hasKeyDelivered = personnelColumns.some(col => col.name === 'key_delivered');
  const hasCheckoutKeyReturned = personnelColumns.some(col => col.name === 'checkout_key_returned');
  const hasCheckoutRoomId = personnelColumns.some(col => col.name === 'checkout_room_id');

  if (!hasTcNumberEncrypted) {
    db.exec('ALTER TABLE personnel ADD COLUMN tc_number_encrypted TEXT');
    console.log('Migration: personnel tablosuna tc_number_encrypted alanı eklendi');
    
    // Eski TC numaralarını şifrele
    if (hasTcNumber) {
      const oldPersonnel = db.prepare("SELECT id, tc_number FROM personnel WHERE tc_number IS NOT NULL AND tc_number != '' AND tc_number_encrypted IS NULL").all();
      if (oldPersonnel.length > 0) {
        const updateStmt = db.prepare('UPDATE personnel SET tc_number_encrypted = ? WHERE id = ?');
        for (const person of oldPersonnel) {
          try {
            const encrypted = encryptTcNumberSync(person.tc_number);
            updateStmt.run(encrypted, person.id);
            console.log(`  ✓ Personel ${person.id}: TC şifrelendi`);
          } catch (err) {
            console.error(`  ✗ Personel ${person.id}: TC şifreleme başarısız`, err.message);
          }
        }
        console.log(`Migration: ${oldPersonnel.length} eski TC kaydı şifrelendi`);
      }
    }
  }
  if (!hasTcNumberFingerprint) {
    db.exec('ALTER TABLE personnel ADD COLUMN tc_number_fingerprint TEXT');
    console.log('Migration: personnel tablosuna tc_number_fingerprint alanı eklendi');
  }
  if (!hasPhotoPath) {
    db.exec('ALTER TABLE personnel ADD COLUMN photo_path TEXT');
    console.log('Migration: personnel tablosuna photo_path alanı eklendi');
  }
  if (!hasFormSigned) {
    db.exec('ALTER TABLE personnel ADD COLUMN form_signed INTEGER DEFAULT 0');
    console.log('Migration: personnel tablosuna form_signed alanı eklendi');
  }

  if (!hasHandoverPayload) {
    db.exec('ALTER TABLE personnel ADD COLUMN handover_payload TEXT');
    console.log('Migration: personnel tablosuna handover_payload alanı eklendi');
  }

  if (!hasEntryHandoverPayload) {
    db.exec('ALTER TABLE personnel ADD COLUMN entry_handover_payload TEXT');
    console.log('Migration: personnel tablosuna entry_handover_payload alanı eklendi');
  }

  if (!hasCheckoutHandoverPayload) {
    db.exec('ALTER TABLE personnel ADD COLUMN checkout_handover_payload TEXT');
    console.log('Migration: personnel tablosuna checkout_handover_payload alanı eklendi');
  }

  if (!hasKeyDelivered) {
    db.exec('ALTER TABLE personnel ADD COLUMN key_delivered INTEGER DEFAULT 0');
    console.log('Migration: personnel tablosuna key_delivered alanı eklendi');
  }

  if (!hasCheckoutKeyReturned) {
    db.exec('ALTER TABLE personnel ADD COLUMN checkout_key_returned INTEGER');
    console.log('Migration: personnel tablosuna checkout_key_returned alanı eklendi');
  }

  if (!hasCheckoutRoomId) {
    db.exec('ALTER TABLE personnel ADD COLUMN checkout_room_id INTEGER');
    console.log('Migration: personnel tablosuna checkout_room_id alanı eklendi');
  }

  const hasTcLastFour = personnelColumns.some(col => col.name === 'tc_last_four');
  if (!hasTcLastFour) {
    db.exec('ALTER TABLE personnel ADD COLUMN tc_last_four TEXT');
    console.log('Migration: personnel tablosuna tc_last_four alanı eklendi');
  }

  db.exec('CREATE INDEX IF NOT EXISTS idx_personnel_tc_last_four ON personnel(tc_last_four)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_personnel_tc_number_fingerprint ON personnel(tc_number_fingerprint)');

  const hasTcFingerprintData = hasTcNumber
    ? db.prepare("SELECT COUNT(*) AS count FROM personnel WHERE (tc_number_fingerprint IS NULL OR tc_number_fingerprint = '') AND tc_number IS NOT NULL AND tc_number != ''").get()
    : { count: 0 };
  if (hasTcFingerprintData && hasTcFingerprintData.count > 0) {
    const backfillTcFingerprintStmt = db.prepare('UPDATE personnel SET tc_number_fingerprint = ? WHERE id = ?');
    const legacyRows = db.prepare("SELECT id, tc_number FROM personnel WHERE (tc_number_fingerprint IS NULL OR tc_number_fingerprint = '') AND tc_number IS NOT NULL AND tc_number != ''").all();
    let fingerprintBackfilled = 0;
    for (const person of legacyRows) {
      const fingerprint = createTcFingerprint(person.tc_number);
      if (!fingerprint) continue;
      backfillTcFingerprintStmt.run(fingerprint, person.id);
      fingerprintBackfilled += 1;
    }
    if (fingerprintBackfilled > 0) {
      console.log(`Migration: ${fingerprintBackfilled} eski TC fingerprint kaydı dolduruldu`);
    }
  }

  const hasMissingEncryptedFromPlain = hasTcNumber
    ? db.prepare("SELECT COUNT(*) AS count FROM personnel WHERE (tc_number_encrypted IS NULL OR tc_number_encrypted = '') AND tc_number IS NOT NULL AND tc_number != ''").get()
    : { count: 0 };
  if (hasMissingEncryptedFromPlain && hasMissingEncryptedFromPlain.count > 0) {
    const missingEncryptedRows = db.prepare("SELECT id, tc_number FROM personnel WHERE (tc_number_encrypted IS NULL OR tc_number_encrypted = '') AND tc_number IS NOT NULL AND tc_number != ''").all();
    const fillEncryptedStmt = db.prepare('UPDATE personnel SET tc_number_encrypted = ? WHERE id = ?');
    let encryptedBackfilled = 0;
    for (const person of missingEncryptedRows) {
      try {
        const encrypted = encryptTcNumberSync(person.tc_number);
        if (!encrypted) continue;
        fillEncryptedStmt.run(encrypted, person.id);
        encryptedBackfilled += 1;
      } catch (_) {}
    }
    if (encryptedBackfilled > 0) {
      console.log(`Migration: ${encryptedBackfilled} kayıtta tc_number_encrypted dolduruldu`);
    }
  }

  const hasTcLastFourData = db.prepare("SELECT COUNT(*) AS count FROM personnel WHERE tc_last_four IS NULL OR tc_last_four = ''").get();
  if (hasTcLastFourData && hasTcLastFourData.count > 0 && hasTcNumber) {
    const backfillTcLastFourStmt = db.prepare("UPDATE personnel SET tc_last_four = substr(tc_number, -4) WHERE (tc_last_four IS NULL OR tc_last_four = '') AND tc_number IS NOT NULL AND tc_number != ''");
    const backfillResult = backfillTcLastFourStmt.run();
    if (backfillResult && backfillResult.changes > 0) {
      console.log(`Migration: ${backfillResult.changes} eski TC son 4 hane kaydı dolduruldu`);
    }
  }

  if (hasTcNumber) {
    const scrubPlainTcResult = db.prepare("UPDATE personnel SET tc_number = NULL WHERE tc_number IS NOT NULL AND TRIM(tc_number) != ''").run();
    if (scrubPlainTcResult && scrubPlainTcResult.changes > 0) {
      console.log(`Migration: ${scrubPlainTcResult.changes} personel kaydında açık TC temizlendi`);
    }
  }

  const hasRoomHistoryTable = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='room_stay_history'").get();
  if (hasRoomHistoryTable) {
    const roomHistoryColumns = db.prepare('PRAGMA table_info(room_stay_history)').all();
    const hasRoomHistoryTc = roomHistoryColumns.some(col => col.name === 'tc_number');
    if (hasRoomHistoryTc) {
      const scrubRoomHistoryTcResult = db.prepare("UPDATE room_stay_history SET tc_number = NULL WHERE tc_number IS NOT NULL AND TRIM(tc_number) != ''").run();
      if (scrubRoomHistoryTcResult && scrubRoomHistoryTcResult.changes > 0) {
        console.log(`Migration: ${scrubRoomHistoryTcResult.changes} geçmiş kaydında açık TC temizlendi`);
      }
    }
  }

  const personnelTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='personnel'").get();
  if (personnelTableSql && !personnelTableSql.sql.includes("'bosta'")) {
    db.exec(`
      CREATE TABLE personnel_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        gender TEXT CHECK(gender IN ('erkek', 'kadin')),
        phone TEXT,
        department TEXT,
        room_id INTEGER,
        status TEXT DEFAULT 'bosta' CHECK(status IN ('aktif', 'cikis_yapti', 'bosta')),
        check_in_date DATETIME,
        check_out_date DATETIME,
        added_by INTEGER,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        tc_number TEXT,
        photo_path TEXT,
        form_signed INTEGER DEFAULT 0,
        handover_payload TEXT,
        entry_handover_payload TEXT,
        checkout_handover_payload TEXT,
        key_delivered INTEGER DEFAULT 0,
        checkout_key_returned INTEGER,
        checkout_room_id INTEGER,
        tc_number_fingerprint TEXT,
        FOREIGN KEY (room_id) REFERENCES rooms(id),
        FOREIGN KEY (added_by) REFERENCES users(id)
      );

      INSERT INTO personnel_new (
        id, first_name, last_name, gender, phone, department, room_id, status,
        check_in_date, check_out_date, added_by, created_at, tc_number_encrypted, photo_path,
        form_signed, handover_payload, entry_handover_payload, checkout_handover_payload,
        key_delivered, checkout_key_returned, checkout_room_id, tc_number_fingerprint
      )
      SELECT
        id, first_name, last_name, gender, phone, department, room_id, status,
        check_in_date, check_out_date, added_by, created_at, tc_number_encrypted, photo_path,
        form_signed, handover_payload, entry_handover_payload, checkout_handover_payload,
        key_delivered, checkout_key_returned, checkout_room_id, tc_number_fingerprint
      FROM personnel;

      DROP TABLE personnel;
      ALTER TABLE personnel_new RENAME TO personnel;
    `);
    console.log('Migration: personnel status alanına bosta değeri eklendi');
  }

  // Yeni anahtar modeline gecis (after migrations, key_delivered column is guaranteed to exist):
  // max_quantity = odadaki toplam mevcut anahtar stogu
  // quantity = eldeki/yedek anahtar
  // Eski modelde cikista teslim edilmeyen anahtarlar quantity'den de dusuyordu.
  // Bu nedenle mevcut verileri max_quantity = quantity + aktif personele teslimli anahtar sayisi
  // formulu ile normalize ediyoruz (idempotent).
  db.exec(`
    UPDATE room_inventory AS ri
    SET max_quantity = MAX(
      0,
      COALESCE(ri.quantity, 0) + (
        SELECT COUNT(*)
        FROM personnel p
        WHERE p.room_id = ri.room_id
          AND p.status = 'aktif'
          AND COALESCE(p.key_delivered, 0) = 1
      )
    )
    WHERE LOWER(ri.item_name) = LOWER('Oda Anahtarı')
  `);

  db.exec(`
    UPDATE personnel
    SET checkout_key_returned = CASE
      WHEN status = 'cikis_yapti' THEN COALESCE(checkout_key_returned, key_delivered)
      ELSE checkout_key_returned
    END
  `);

  db.exec(`
    UPDATE personnel
    SET checkout_room_id = room_id
    WHERE status = 'cikis_yapti' AND checkout_room_id IS NULL AND room_id IS NOT NULL
  `);

  db.exec(`
    UPDATE personnel
    SET status = CASE
      WHEN room_id IS NOT NULL THEN 'aktif'
      WHEN room_id IS NULL AND (checkout_room_id IS NOT NULL OR check_out_date IS NOT NULL) THEN 'cikis_yapti'
      ELSE 'bosta'
    END
  `);

  const checkoutRoomBackfillRows = db.prepare("SELECT id, first_name, last_name FROM personnel WHERE status = 'cikis_yapti' AND checkout_room_id IS NULL").all();
  const selectLastCheckoutLog = db.prepare("SELECT description FROM activity_log WHERE action_type = 'personel_cikis' AND description LIKE ? ORDER BY id DESC LIMIT 1");
  const selectRoomByNumber = db.prepare('SELECT id FROM rooms WHERE room_number = ?');
  const updateCheckoutRoomId = db.prepare('UPDATE personnel SET checkout_room_id = ? WHERE id = ?');

  checkoutRoomBackfillRows.forEach(row => {
    const name = `${row.first_name} ${row.last_name}`.trim();
    const logRow = selectLastCheckoutLog.get(`${name} - % odasından çıkış yaptı`);
    if (!logRow || !logRow.description) return;

    const match = logRow.description.match(/-\s*(\d+)\s+odasından çıkış yaptı/i);
    if (!match) return;

    const room = selectRoomByNumber.get(Number(match[1]));
    if (!room) return;
    updateCheckoutRoomId.run(room.id, row.id);
  });

  if (hasHandoverPayload) {
    db.exec(`
      UPDATE personnel
      SET entry_handover_payload = handover_payload
      WHERE entry_handover_payload IS NULL AND status = 'aktif' AND handover_payload IS NOT NULL
    `);
    db.exec(`
      UPDATE personnel
      SET checkout_handover_payload = handover_payload
      WHERE checkout_handover_payload IS NULL AND status = 'cikis_yapti' AND handover_payload IS NOT NULL
    `);
  }

  db.exec(`
    UPDATE room_issues
    SET issue_type = CASE
      WHEN issue_type IS NULL OR issue_type = '' THEN
        CASE WHEN LOWER(title) LIKE '% eksik' THEN 'demirbas' ELSE 'oda' END
      ELSE issue_type
    END
  `);

  // Tüm mevcut (depo olmayan) odalara varsayılan demirbaşları ekle
  const DEFAULT_ROOM_KEY_COUNT = 3;
  const getRequiredKeyCount = () => DEFAULT_ROOM_KEY_COUNT;
  const defaultRoomInventory = [
    { name: 'Yastık', quantity: 1 },
    { name: 'Nevresim Takımı', quantity: 1 },
    { name: 'Oda Anahtarı', quantity: null },
    { name: 'Klima', quantity: 1 },
    { name: 'Klima Kumandası', quantity: 1 },
    { name: 'Televizyon', quantity: 1 },
    { name: 'TV Kumandası', quantity: 1 },
    { name: 'Elbise Dolabı', quantity: 1 }
  ];
  const roomIds = db.prepare("SELECT id, room_number FROM rooms WHERE status != 'depo'").all();
  const insertDefaultInventoryItem = db.prepare(`
    INSERT INTO room_inventory (room_id, item_name, quantity, max_quantity, condition, notes, added_by)
    SELECT ?, ?, ?, ?, 'saglam', NULL, NULL
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

  roomIds.forEach(room => {
    const requiredKeyCount = getRequiredKeyCount();
    defaultRoomInventory.forEach(item => {
      const quantity = item.name === 'Oda Anahtarı' ? requiredKeyCount : item.quantity;
      const maxQuantity = item.name === 'Oda Anahtarı' ? requiredKeyCount : null;
      insertDefaultInventoryItem.run(room.id, item.name, quantity, maxQuantity, room.id, item.name);
    });
    clampExistingKeyInventoryQuantity.run(room.id);
  });

  roomIds.forEach(room => {
    syncRoomKeyStock(room.id);
  });
}

// Hareket kaydı oluşturma yardımcı fonksiyonu
function logActivity(actionType, description, details, userId) {
  const rawUserId = userId || null;
  const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
  const safeUserId = actorUser ? actorUser.id : null;
  db.prepare('INSERT INTO activity_log (action_type, description, details, performed_by, created_at) VALUES (?, ?, ?, ?, ?)').run(actionType, description, details || null, safeUserId, formatLocalTimestamp());
}

// Oda durumunu güncelleme yardımcı fonksiyonu
function updateRoomStatus(roomId) {
  const room = db.prepare('SELECT capacity FROM rooms WHERE id = ?').get(roomId);
  if (!room) return;
  
  const occupantCount = db.prepare('SELECT COUNT(*) as count FROM personnel WHERE room_id = ? AND status = ?').get(roomId, 'aktif');
  
  let newStatus;
  if (occupantCount.count === 0) {
    newStatus = 'bos';
  } else if (occupantCount.count >= room.capacity) {
    newStatus = 'dolu';
  } else {
    newStatus = 'kismi_dolu';
  }
  
  // Bakımdaki veya depo odanın durumunu otomatik değiştirme
  const currentRoom = db.prepare('SELECT status FROM rooms WHERE id = ?').get(roomId);
  if (currentRoom && currentRoom.status !== 'bakimda' && currentRoom.status !== 'depo') {
    db.prepare('UPDATE rooms SET status = ? WHERE id = ?').run(newStatus, roomId);
  }
}

// Oda anahtar adedini personel tahsis verisine göre senkronize et.
function syncRoomKeyStock(roomId) {
  if (!roomId) return null;

  const keyRow = db.prepare("SELECT id, quantity, max_quantity FROM room_inventory WHERE room_id = ? AND LOWER(item_name) = LOWER('Oda Anahtarı')").get(roomId);
  if (!keyRow) return null;

  const maxQuantity = Math.max(0, Number(keyRow.max_quantity ?? keyRow.quantity ?? 0));
  const activeDeliveredCount = db.prepare("SELECT COUNT(*) as count FROM personnel WHERE room_id = ? AND status = 'aktif' AND key_delivered = 1").get(roomId).count || 0;
  const expectedQuantity = Math.max(0, Math.min(maxQuantity, maxQuantity - activeDeliveredCount));

  db.prepare('UPDATE room_inventory SET quantity = ?, max_quantity = ? WHERE id = ?').run(expectedQuantity, maxQuantity, keyRow.id);
  return expectedQuantity;
}

function getPersonnelHistorySnapshot(personnelId) {
  if (!personnelId) return null;
  return db.prepare('SELECT id, first_name, last_name, department FROM personnel WHERE id = ?').get(personnelId) || null;
}

function recordRoomEntry(personnelId, roomId, entryAt) {
  const personId = Number(personnelId);
  const targetRoomId = Number(roomId);
  if (!personId || !targetRoomId) return;

  const openRow = db.prepare(`
    SELECT id
    FROM room_stay_history
    WHERE room_id = ? AND personnel_id = ? AND exit_at IS NULL
    ORDER BY datetime(COALESCE(entry_at, created_at, CURRENT_TIMESTAMP)) DESC, id DESC
    LIMIT 1
  `).get(targetRoomId, personId);

  if (openRow && openRow.id) {
    return;
  }

  const snapshot = getPersonnelHistorySnapshot(personId);
  const timestamp = entryAt || formatLocalTimestamp();

  db.prepare(`
    INSERT INTO room_stay_history (
      room_id,
      personnel_id,
      first_name,
      last_name,
      tc_number,
      department,
      entry_at,
      exit_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)
  `).run(
    targetRoomId,
    personId,
    snapshot ? snapshot.first_name : null,
    snapshot ? snapshot.last_name : null,
    snapshot ? snapshot.tc_number : null,
    snapshot ? snapshot.department : null,
    timestamp,
    timestamp
  );
}

function recordRoomExit(personnelId, roomId, exitAt) {
  const personId = Number(personnelId);
  const targetRoomId = Number(roomId);
  if (!personId || !targetRoomId) return;

  const timestamp = exitAt || formatLocalTimestamp();
  const openRow = db.prepare(`
    SELECT id
    FROM room_stay_history
    WHERE room_id = ? AND personnel_id = ? AND exit_at IS NULL
    ORDER BY datetime(COALESCE(entry_at, created_at, CURRENT_TIMESTAMP)) DESC, id DESC
    LIMIT 1
  `).get(targetRoomId, personId);

  if (openRow && openRow.id) {
    db.prepare('UPDATE room_stay_history SET exit_at = ?, updated_at = ? WHERE id = ?').run(timestamp, timestamp, openRow.id);
    return;
  }

  const snapshot = getPersonnelHistorySnapshot(personId);
  db.prepare(`
    INSERT INTO room_stay_history (
      room_id,
      personnel_id,
      first_name,
      last_name,
      tc_number,
      department,
      entry_at,
      exit_at,
      updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
  `).run(
    targetRoomId,
    personId,
    snapshot ? snapshot.first_name : null,
    snapshot ? snapshot.last_name : null,
    snapshot ? snapshot.tc_number : null,
    snapshot ? snapshot.department : null,
    timestamp,
    timestamp
  );
}

module.exports = {
  db,
  initDatabase,
  logActivity,
  updateRoomStatus,
  syncRoomKeyStock,
  recordRoomEntry,
  recordRoomExit,
  formatLocalTimestamp
};
