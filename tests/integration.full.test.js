const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tempDir = path.join(process.cwd(), 'tests', '.tmp');
const dbPath = path.join(tempDir, 'integration.db');

let server;
let db;
let baseUrl;

function cleanupDbFiles() {
  const candidates = [dbPath, `${dbPath}-wal`, `${dbPath}-shm`];
  candidates.forEach(file => {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch (_) {
        // SQLite can keep file handles briefly during shutdown on Windows.
      }
    }
  });
}

function formBody(payload) {
  return new URLSearchParams(
    Object.entries(payload).reduce((acc, [key, value]) => {
      if (value === undefined || value === null) return acc;
      acc[key] = String(value);
      return acc;
    }, {})
  );
}

async function get(pathname) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'GET',
    redirect: 'follow'
  });
  return res;
}

async function postForm(pathname, payload) {
  const res = await fetch(`${baseUrl}${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: formBody(payload),
    redirect: 'follow'
  });
  return res;
}

test.before(() => {
  fs.mkdirSync(tempDir, { recursive: true });
  cleanupDbFiles();

  process.env.DB_PATH = dbPath;
  process.env.PORT = '0';
  process.env.SOCKET_LOGS = '0';

  const appModule = require('../app');
  const database = require('../database');

  server = appModule.server;
  db = database.db;

  const address = server.address();
  const port = address && typeof address === 'object' ? address.port : Number(process.env.PORT || 3000);
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(() => {
  if (server && server.listening) {
    server.close();
  }
  if (db) {
    db.close();
  }
  cleanupDbFiles();
});

test('full user interaction flow works end-to-end', async () => {
  const pages = [
    '/dashboard',
    '/personel',
    '/odalar',
    '/giris-cikis',
    '/rapor-olustur',
    '/gecmis',
    '/esya-takip',
    '/ziyaretciler',
    '/yangin-alarm'
  ];

  for (const page of pages) {
    const response = await get(page);
    assert.equal(response.status, 200, `GET ${page} should return 200`);
  }

  const roomNumberA = 9101;
  const roomNumberB = 9102;

  let response = await postForm('/odalar', {
    room_number: roomNumberA,
    capacity: 2,
    floor: '1. Kat',
    description: 'Integration test room A'
  });
  assert.equal(response.status, 200, 'Room A creation should complete');

  response = await postForm('/odalar', {
    room_number: roomNumberB,
    capacity: 2,
    floor: '1. Kat',
    description: 'Integration test room B'
  });
  assert.equal(response.status, 200, 'Room B creation should complete');

  const roomA = db.prepare('SELECT * FROM rooms WHERE room_number = ?').get(roomNumberA);
  const roomB = db.prepare('SELECT * FROM rooms WHERE room_number = ?').get(roomNumberB);

  assert.ok(roomA, 'Room A should exist in database');
  assert.ok(roomB, 'Room B should exist in database');

  const roomAInventory = db.prepare('SELECT * FROM room_inventory WHERE room_id = ? ORDER BY id ASC').all(roomA.id);
  assert.ok(roomAInventory.length > 0, 'Default room inventory should be created');

  const handoverItemsA = roomAInventory
    .map(row => String(row.item_name || '').trim())
    .filter(name => name && name.toLocaleLowerCase('tr-TR') !== 'oda anahtarı')
    .map(name => ({ name, delivered: true }));

  const handoverPayloadA = JSON.stringify({
    form_signed: true,
    key_delivered: true,
    items: handoverItemsA
  });

  response = await postForm('/personel/ekle', {
    first_name: 'Ali',
    last_name: 'Deneme',
    gender: 'erkek',
    phone: '05000000001',
    department: 'Teknik Servis',
    tc_number: '10000000146'
  });
  assert.equal(response.status, 400, 'Personnel create without signed handover should be rejected');

  response = await postForm('/personel/ekle', {
    first_name: 'Ali',
    last_name: 'Deneme',
    gender: 'erkek',
    phone: '05000000001',
    department: 'Teknik Servis',
    tc_number: '10000000146',
    form_signed: 'on'
  });
  assert.equal(response.status, 200, 'Personnel create should complete');

  let personA = db.prepare("SELECT * FROM personnel WHERE first_name = 'Ali' AND last_name = 'Deneme' ORDER BY id DESC LIMIT 1").get();
  assert.ok(personA, 'Created personnel should exist');
  assert.ok(personA.tc_number_encrypted, 'Encrypted TC should be stored');
  assert.ok(!Object.prototype.hasOwnProperty.call(personA, 'tc_number') || personA.tc_number === null, 'Plain TC should not be stored');

  response = await postForm(`/odalar/${roomA.id}/personel-ata`, {
    personnel_id: personA.id,
    handover_payload: handoverPayloadA,
    form_signed: 'on',
    key_delivered: '1'
  });
  assert.equal(response.status, 200, 'Assigning personnel to room should complete');

  personA = db.prepare('SELECT * FROM personnel WHERE id = ?').get(personA.id);
  assert.equal(personA.room_id, roomA.id, 'Personnel should be assigned to room A');
  assert.equal(personA.status, 'aktif', 'Assigned personnel should be active');

  response = await postForm(`/odalar/${roomA.id}/sorun-ekle`, {
    sorun: 'Kapı kolu gevşek'
  });
  assert.equal(response.status, 200, 'Room issue create should complete');

  const roomIssue = db.prepare("SELECT * FROM room_issues WHERE room_id = ? AND issue_type = 'oda' ORDER BY id DESC LIMIT 1").get(roomA.id);
  assert.ok(roomIssue, 'Room issue should exist');

  response = await postForm(`/odalar/${roomA.id}/demirbas-sorun-ekle`, {
    inventory_item_name: 'Klima',
    issue_tag: 'arizali',
    description: 'Soğutmuyor'
  });
  assert.equal(response.status, 200, 'Inventory issue create should complete');

  const inventoryIssue = db.prepare("SELECT * FROM room_issues WHERE room_id = ? AND issue_type = 'demirbas' AND LOWER(inventory_item_name) = LOWER('Klima') ORDER BY id DESC LIMIT 1").get(roomA.id);
  assert.ok(inventoryIssue, 'Inventory issue should be created');
  assert.equal(inventoryIssue.status, 'acik', 'Inventory issue should start open');

  let klimaItem = db.prepare("SELECT * FROM room_inventory WHERE room_id = ? AND LOWER(item_name) = LOWER('Klima')").get(roomA.id);
  assert.equal(klimaItem.condition, 'arizali', 'Inventory condition should follow open issue tag');

  response = await postForm(`/odalar/${roomA.id}/sorun/${inventoryIssue.id}/guncelle`, {
    status: 'cozuldu'
  });
  assert.equal(response.status, 200, 'Inventory issue resolve should complete');

  const resolvedInventoryIssue = db.prepare('SELECT * FROM room_issues WHERE id = ?').get(inventoryIssue.id);
  assert.equal(resolvedInventoryIssue.status, 'cozuldu', 'Inventory issue should be marked resolved');

  klimaItem = db.prepare("SELECT * FROM room_inventory WHERE room_id = ? AND LOWER(item_name) = LOWER('Klima')").get(roomA.id);
  assert.equal(klimaItem.condition, 'saglam', 'Inventory condition should recover to saglam after issue resolved');

  response = await postForm('/ziyaretciler/ekle', {
    visitor_name: 'Mehmet Ziyaret',
    purpose: 'İş Görüşmesi',
    company: 'ABC Ltd',
    phone: '05000000002',
    notes: 'Test ziyareti'
  });
  assert.equal(response.status, 200, 'Visitor create should complete');

  const visitor = db.prepare("SELECT * FROM visitors WHERE visitor_name = 'Mehmet Ziyaret' ORDER BY id DESC LIMIT 1").get();
  assert.ok(visitor, 'Visitor record should exist');

  response = await postForm('/yangin-alarm/ekle', {
    location: '1. Kat Koridor',
    is_real: 'false',
    description: 'Tatbikat testi',
    action_taken: 'Kontrol edildi'
  });
  assert.equal(response.status, 200, 'Fire alarm create should complete');

  const alarmRow = db.prepare("SELECT * FROM fire_alarms WHERE location = '1. Kat Koridor' ORDER BY id DESC LIMIT 1").get();
  assert.ok(alarmRow, 'Fire alarm record should exist');

  response = await postForm(`/personel/${personA.id}/sikayet-ekle`, {
    sikayet: 'Temizlik uyarısı'
  });
  assert.equal(response.status, 200, 'Personnel complaint create should complete');

  const complaintRow = db.prepare('SELECT * FROM personnel_complaints WHERE personnel_id = ? ORDER BY id DESC LIMIT 1').get(personA.id);
  assert.ok(complaintRow, 'Personnel complaint should be stored');

  const handoverPayloadB = JSON.stringify({
    form_signed: true,
    key_delivered: true,
    items: handoverItemsA
  });

  response = await postForm('/personel/ekle-ve-ata', {
    first_name: 'Ayse',
    last_name: 'Deneme',
    gender: 'kadin',
    phone: '05000000003',
    department: 'Kat Hizmetleri',
    tc_number: '10000000154',
    room_id: roomA.id,
    handover_payload: handoverPayloadB,
    allow_cleaning_override: '1',
    form_signed: 'on'
  });
  assert.equal(response.status, 200, 'Create-and-assign personnel flow should complete');

  let personB = db.prepare("SELECT * FROM personnel WHERE first_name = 'Ayse' AND last_name = 'Deneme' ORDER BY id DESC LIMIT 1").get();
  assert.ok(personB, 'Second personnel should exist');
  assert.equal(personB.room_id, roomA.id, 'Second personnel should start in room A');

  const roomBInventory = db.prepare('SELECT * FROM room_inventory WHERE room_id = ? ORDER BY id ASC').all(roomB.id);
  const roomBHandoverItems = roomBInventory
    .map(row => String(row.item_name || '').trim())
    .filter(name => name && name.toLocaleLowerCase('tr-TR') !== 'oda anahtarı')
    .map(name => ({ name, delivered: true }));

  const reassignPayload = JSON.stringify({
    form_signed: true,
    key_delivered: true,
    items: roomBHandoverItems
  });

  response = await postForm(`/personel/${personB.id}/oda-degistir`, {
    new_room_id: roomB.id,
    reassign_form_signed: '1',
    reassign_key_delivered: '1',
    reassign_handover_payload: reassignPayload,
    allow_cleaning_override: '1'
  });
  assert.equal(response.status, 200, 'Room change should complete');

  personB = db.prepare('SELECT * FROM personnel WHERE id = ?').get(personB.id);
  assert.equal(personB.room_id, roomB.id, 'Personnel should move to room B');
  assert.equal(personB.status, 'aktif', 'Moved personnel should stay active');

  const personACheckoutItems = handoverItemsA.map(item => ({ ...item, delivered: true }));
  const checkoutPayload = JSON.stringify({
    form_signed: true,
    key_returned: true,
    items: personACheckoutItems
  });

  response = await postForm(`/personel/${personA.id}/cikis`, {
    checkout_payload: checkoutPayload,
    key_returned: '1'
  });
  assert.equal(response.status, 200, 'Personnel checkout should complete');

  personA = db.prepare('SELECT * FROM personnel WHERE id = ?').get(personA.id);
  assert.equal(personA.status, 'cikis_yapti', 'Checked-out personnel should have cikis_yapti status');
  assert.equal(personA.room_id, null, 'Checked-out personnel should not remain in active room');
  assert.equal(personA.checkout_room_id, roomA.id, 'Checkout room id should be saved');

  response = await postForm('/giris-cikis/ekle', {
    person_name: 'Planlanan Giris',
    type: 'giris',
    expected_date: '2026-04-03',
    notes: 'Plan kaydi'
  });
  assert.equal(response.status, 200, 'Entry/exit create should complete');

  const entryRow = db.prepare("SELECT * FROM entry_exit_list WHERE person_name = 'Planlanan Giris' ORDER BY id DESC LIMIT 1").get();
  assert.ok(entryRow, 'Entry/exit record should exist');

  response = await postForm(`/giris-cikis/${entryRow.id}/guncelle`, {
    status: 'tamamlandi'
  });
  assert.equal(response.status, 200, 'Entry/exit update should complete');

  const updatedEntryRow = db.prepare('SELECT * FROM entry_exit_list WHERE id = ?').get(entryRow.id);
  assert.equal(updatedEntryRow.status, 'tamamlandi', 'Entry/exit status should update');

  response = await postForm(`/giris-cikis/${entryRow.id}/sil`, {});
  assert.equal(response.status, 200, 'Entry/exit delete should complete');

  const deletedEntryRow = db.prepare('SELECT * FROM entry_exit_list WHERE id = ?').get(entryRow.id);
  assert.equal(deletedEntryRow, undefined, 'Deleted entry/exit row should not exist');

  response = await postForm('/esya-takip/ekle', {
    item_name: 'Test Laptop',
    given_to: 'Ayse Deneme',
    room_number: roomB.room_number,
    notes: 'Entegrasyon testi'
  });
  assert.equal(response.status, 200, 'Shared equipment create should complete');

  const equipmentRow = db.prepare("SELECT * FROM shared_equipment WHERE item_name = 'Test Laptop' ORDER BY id DESC LIMIT 1").get();
  assert.ok(equipmentRow, 'Shared equipment row should exist');
  assert.equal(equipmentRow.status, 'teslim_edildi', 'Shared equipment should start as delivered');

  response = await postForm('/whatsapp/equipment-reminder-rules', {
    'rows[0][item_name]': 'Test Laptop',
    'rows[0][delay_minutes]': '45',
    'rows[0][message_template]': '{{item_name}} - {{given_to}} - {{delay_minutes}} dakika',
    'rows[0][is_enabled]': '1'
  });
  assert.equal(response.status, 200, 'WhatsApp equipment reminder save should complete');

  const reminderRule = db.prepare("SELECT * FROM whatsapp_equipment_reminder_rules WHERE item_name = 'Test Laptop' ORDER BY id DESC LIMIT 1").get();
  assert.ok(reminderRule, 'Equipment reminder rule should exist');
  assert.equal(reminderRule.delay_minutes, 45, 'Equipment reminder delay should be saved');
  assert.equal(reminderRule.is_enabled, 1, 'Equipment reminder should be enabled');

  response = await postForm('/whatsapp/daily-templates', {
    title: 'Test Gunluk Mesaj',
    send_time: '09:30',
    message_template: 'Gunluk bilgilendirme {{current_date}} {{current_time}}',
    is_enabled: '1'
  });
  assert.equal(response.status, 200, 'WhatsApp daily template save should complete');

  const dailyTemplateRow = db.prepare("SELECT * FROM whatsapp_daily_templates WHERE title = 'Test Gunluk Mesaj' ORDER BY id DESC LIMIT 1").get();
  assert.ok(dailyTemplateRow, 'Daily template row should exist');
  assert.equal(dailyTemplateRow.send_time, '09:30', 'Daily template time should be saved');
  assert.equal(dailyTemplateRow.is_enabled, 1, 'Daily template should be enabled');

  response = await postForm(`/esya-takip/${equipmentRow.id}/durum`, {
    status: 'iade_edildi'
  });
  assert.equal(response.status, 200, 'Shared equipment status update should complete');

  const returnedEquipmentRow = db.prepare('SELECT * FROM shared_equipment WHERE id = ?').get(equipmentRow.id);
  assert.equal(returnedEquipmentRow.status, 'iade_edildi', 'Shared equipment should become returned');

  const activityCount = db.prepare('SELECT COUNT(*) AS count FROM activity_log').get().count;
  assert.ok(activityCount > 0, 'Activity log should contain records after interactions');
});
