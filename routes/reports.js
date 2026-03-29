const express = require('express');
const router = express.Router();
const ExcelJS = require('exceljs');
const { db } = require('../database');

function getKeyShortages() {
  const rooms = db.prepare(`
    SELECT
      r.id,
      r.room_number,
      r.capacity,
      COALESCE((
        SELECT COUNT(*)
        FROM personnel p
        WHERE p.room_id = r.id AND COALESCE(p.status, '') = 'aktif'
      ), 0) AS occupied_count,
      COALESCE((
        SELECT ri.quantity
        FROM room_inventory ri
        WHERE ri.room_id = r.id AND LOWER(ri.item_name) = LOWER('Oda Anahtarı')
        ORDER BY ri.id DESC
        LIMIT 1
      ), 0) AS spare_key_count,
      COALESCE((
        SELECT COALESCE(ri.max_quantity, ri.quantity, 0)
        FROM room_inventory ri
        WHERE ri.room_id = r.id AND LOWER(ri.item_name) = LOWER('Oda Anahtarı')
        ORDER BY ri.id DESC
        LIMIT 1
      ), 0) AS total_key_count
    FROM rooms r
    WHERE COALESCE(r.status, '') != 'depo'
    ORDER BY r.room_number
  `).all();

  return rooms
    .map(room => {
      const expectedKeyCount = Number(room.capacity || 0) + 1;
      const spareKeyCount = Math.max(0, Number(room.spare_key_count || 0));
      const totalKeyCount = Math.max(0, Number(room.total_key_count || 0));
      const missingKeyCount = Math.max(0, expectedKeyCount - totalKeyCount);
      return {
        room_id: room.id,
        room_number: room.room_number,
        capacity: Number(room.capacity || 0),
        occupied_count: Number(room.occupied_count || 0),
        expected_key_count: expectedKeyCount,
        total_key_count: totalKeyCount,
        spare_key_count: spareKeyCount,
        missing_key_count: missingKeyCount
      };
    })
    .filter(row => row.missing_key_count > 0);
}

function normalizeReportItemName(value) {
  return String(value || '').trim();
}

function normalizeReportItemKey(value) {
  return normalizeReportItemName(value).toLocaleLowerCase('tr-TR');
}

function buildRoomIssuesReportData() {
  const openGeneralIssues = db.prepare(`
    SELECT
      ri.id,
      ri.room_id,
      r.room_number,
      ri.title,
      ri.description,
      ri.created_at
    FROM room_issues ri
    INNER JOIN rooms r ON r.id = ri.room_id
    WHERE COALESCE(ri.issue_type, 'oda') = 'oda'
      AND ri.status != 'cozuldu'
      AND COALESCE(r.status, '') != 'depo'
    ORDER BY datetime(COALESCE(ri.created_at, CURRENT_TIMESTAMP)) DESC, ri.id DESC
  `).all();

  const openInventoryIssues = db.prepare(`
    SELECT
      ri.id,
      ri.room_id,
      r.room_number,
      COALESCE(ri.inventory_item_name, '') AS inventory_item_name,
      LOWER(COALESCE(ri.issue_tag, '')) AS issue_tag,
      COALESCE(ri.description, '') AS description,
      ri.created_at
    FROM room_issues ri
    INNER JOIN rooms r ON r.id = ri.room_id
    WHERE COALESCE(ri.issue_type, 'oda') = 'demirbas'
      AND ri.status != 'cozuldu'
      AND COALESCE(r.status, '') != 'depo'
    ORDER BY datetime(COALESCE(ri.created_at, CURRENT_TIMESTAMP)) DESC, ri.id DESC
  `).all();

  const inventoryStates = db.prepare(`
    SELECT
      r.id AS room_id,
      r.room_number,
      inv.item_name,
      LOWER(COALESCE(inv.condition, 'saglam')) AS item_condition,
      COALESCE(inv.notes, '') AS item_note
    FROM rooms r
    LEFT JOIN room_inventory inv ON inv.room_id = r.id
    WHERE COALESCE(r.status, '') != 'depo'
      AND inv.item_name IS NOT NULL
  `).all();

  const conditionLabelMap = {
    saglam: 'Sağlam',
    eksik: 'Eksik',
    arizali: 'Arızalı',
    kirik: 'Kırık',
    calismiyor: 'Çalışmıyor',
    kayip: 'Kayıp',
    diger: 'Diğer'
  };

  const excludedInventoryKeys = new Set(['oda anahtarı']);
  const inventoryColumnLookup = new Map();

  inventoryStates.forEach(state => {
    const itemName = normalizeReportItemName(state.item_name);
    const itemKey = normalizeReportItemKey(itemName);
    if (!itemName || excludedInventoryKeys.has(itemKey)) return;
    if (!inventoryColumnLookup.has(itemKey)) {
      inventoryColumnLookup.set(itemKey, itemName);
    }
  });

  openInventoryIssues.forEach(issue => {
    const itemName = normalizeReportItemName(issue.inventory_item_name);
    const itemKey = normalizeReportItemKey(itemName);
    if (!itemName || excludedInventoryKeys.has(itemKey)) return;
    if (!inventoryColumnLookup.has(itemKey)) {
      inventoryColumnLookup.set(itemKey, itemName);
    }
  });

  const inventoryColumns = Array.from(inventoryColumnLookup.values())
    .sort((a, b) => a.localeCompare(b, 'tr', { sensitivity: 'base', numeric: true }));

  const inventoryColumnMap = {};
  inventoryColumns.forEach(col => {
    inventoryColumnMap[normalizeReportItemKey(col)] = col;
  });

  const roomReportMap = new Map();

  function ensureRow(roomId, roomNumber) {
    if (!roomReportMap.has(roomId)) {
      const inventoryStatus = {};
      const inventoryNotes = {};

      inventoryColumns.forEach(col => {
        inventoryStatus[col] = '-';
        inventoryNotes[col] = [];
      });

      roomReportMap.set(roomId, {
        room_id: roomId,
        room_number: roomNumber,
        general_notes: [],
        inventory_status: inventoryStatus,
        inventory_notes: inventoryNotes
      });
    }
    return roomReportMap.get(roomId);
  }

  inventoryStates.forEach(state => {
    const itemName = normalizeReportItemName(state.item_name);
    const targetColumn = inventoryColumnMap[normalizeReportItemKey(itemName)];
    if (!targetColumn) return;

    const conditionKey = normalizeReportItemKey(state.item_condition || 'saglam');
    const label = conditionLabelMap[conditionKey] || 'Sağlam';
    const note = normalizeReportItemName(state.item_note);

    const row = ensureRow(state.room_id, state.room_number);
    row.inventory_status[targetColumn] = label;

    if (note && conditionKey !== 'saglam') {
      row.inventory_notes[targetColumn].push(`${label}: ${note}`);
      row.general_notes.push(`${itemName}: ${note}`);
    }
  });

  openGeneralIssues.forEach(issue => {
    const row = ensureRow(issue.room_id, issue.room_number);
    const title = normalizeReportItemName(issue.title);
    const description = normalizeReportItemName(issue.description);
    row.general_notes.push(description ? `${title} : ${description}` : `${title} : -`);
  });

  openInventoryIssues.forEach(issue => {
    const row = ensureRow(issue.room_id, issue.room_number);
    const itemName = normalizeReportItemName(issue.inventory_item_name);
    const description = normalizeReportItemName(issue.description);
    const issueTag = normalizeReportItemKey(issue.issue_tag);
    const issueLabel = conditionLabelMap[issueTag] || normalizeReportItemName(issue.issue_tag) || 'Sorunlu';

    const targetColumn = inventoryColumnMap[normalizeReportItemKey(itemName)];
    if (!targetColumn) return;

    if (issueTag === 'eksik') {
      row.inventory_status[targetColumn] = 'Eksik';
    } else if (issueTag) {
      row.inventory_status[targetColumn] = issueLabel;
    }

    if (description) {
      row.inventory_notes[targetColumn].push(`${issueLabel}: ${description}`);
      row.general_notes.push(`${itemName}: ${description}`);
    }
  });

  Array.from(roomReportMap.entries()).forEach(([roomId, row]) => {
    const hasGeneralIssue = row.general_notes.length > 0;
    const hasInventoryProblem = inventoryColumns.some(col => {
      const status = normalizeReportItemKey(row.inventory_status[col]);
      return status && status !== '-' && status !== 'sağlam' && status !== 'saglam';
    });

    if (!hasGeneralIssue && !hasInventoryProblem) {
      roomReportMap.delete(roomId);
    }
  });

  const roomIssueRows = Array.from(roomReportMap.values())
    .map(row => {
      const dedupInventoryNotes = {};
      inventoryColumns.forEach(col => {
        dedupInventoryNotes[col] = Array.from(new Set(row.inventory_notes[col] || []));
      });

      return {
        ...row,
        general_notes: Array.from(new Set(row.general_notes)),
        inventory_notes: dedupInventoryNotes
      };
    })
    .sort((a, b) => String(a.room_number || '').localeCompare(String(b.room_number || ''), 'tr', { numeric: true }));

  return {
    inventoryColumns,
    roomIssueRows
  };
}

router.get('/', (req, res) => {
  res.render('reports', { title: 'Rapor Oluştur', mode: 'landing', shortages: [] });
});

router.get('/anahtar-eksikleri', (req, res) => {
  const shortages = getKeyShortages();
  res.render('reports', { title: 'Anahtar Eksik Raporu', mode: 'key-shortage', shortages });
});

router.get('/oda-sorunlari', (req, res) => {
  const { roomIssueRows, inventoryColumns } = buildRoomIssuesReportData();

  res.render('reports', {
    title: 'Oda Sorunları Raporu',
    mode: 'room-issues',
    roomIssueRows,
    inventoryColumns
  });
});

router.get('/oda-sorunlari/excel', async (req, res, next) => {
  try {
    const { roomIssueRows, inventoryColumns } = buildRoomIssuesReportData();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Oda Sorunları');

    sheet.columns = [
      { header: 'Oda', key: 'room_number', width: 10 },
      ...inventoryColumns.map(col => ({ header: col, key: col, width: 16 })),
      { header: 'Açıklamalar', key: 'general_notes', width: 60 }
    ];

    sheet.getRow(1).font = { bold: true };

    roomIssueRows.forEach(row => {
      const entry = {
        room_number: row.room_number,
        general_notes: row.general_notes && row.general_notes.length > 0 ? row.general_notes.join(' | ') : '-'
      };

      inventoryColumns.forEach(col => {
        entry[col] = row.inventory_status[col] || '-';
      });

      sheet.addRow(entry);
    });

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="oda-sorunlari-raporu-${stamp}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
});

router.get('/anahtar-eksikleri/excel', async (req, res, next) => {
  try {
    const shortages = getKeyShortages();

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Anahtar Eksikleri');

    sheet.columns = [
      { header: 'Oda Numarası', key: 'room_number', width: 14 },
      { header: 'Kapasite', key: 'capacity', width: 12 },
      { header: 'Olması Gereken Anahtar', key: 'expected_key_count', width: 24 },
      { header: 'Eksik Anahtar', key: 'missing_key_count', width: 14 }
    ];

    sheet.getRow(1).font = { bold: true };
    shortages.forEach(row => sheet.addRow(row));

    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="anahtar-eksik-raporu-${stamp}.xlsx"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
});

// Personel Şikayetleri Raporu
router.get('/personel-sikayetleri', (req, res) => {
  try {
    // Tüm aktif personeli al (sadece odası olanları)
    const personnelList = db.prepare(`
      SELECT
        p.id,
        p.first_name,
        p.last_name,
        p.department,
        p.room_id,
        r.room_number,
        p.status,
        p.check_in_date,
        p.check_out_date
      FROM personnel p
      LEFT JOIN rooms r ON r.id = p.room_id
      WHERE p.status IN ('aktif', 'cikis_yapti') AND p.room_id IS NOT NULL
      ORDER BY p.first_name, p.last_name
    `).all();

    // Personnel complaints ile join (sadece odası olanları)
    const complaintStats = db.prepare(`
      SELECT
        p.id,
        COUNT(CASE WHEN pc.status = 'acik' THEN 1 END) AS open_count,
        COUNT(CASE WHEN pc.status = 'inceleniyor' THEN 1 END) AS inreview_count,
        COUNT(CASE WHEN pc.status = 'cozuldu' THEN 1 END) AS resolved_count,
        COUNT(pc.id) AS total_count
      FROM personnel p
      LEFT JOIN personnel_complaints pc ON pc.personnel_id = p.id
      WHERE p.status IN ('aktif', 'cikis_yapti') AND p.room_id IS NOT NULL
      GROUP BY p.id
    `).all();

    // Complaint stats map
    const statsMap = new Map();
    complaintStats.forEach(stat => {
      statsMap.set(stat.id, {
        open_count: stat.open_count || 0,
        inreview_count: stat.inreview_count || 0,
        resolved_count: stat.resolved_count || 0,
        total_count: stat.total_count || 0
      });
    });

    // Summary stats
    const summaryStats = {
      total_personnel: personnelList.length,
      total_complaints: complaintStats.reduce((sum, s) => sum + (s.total_count || 0), 0),
      open_complaints: complaintStats.reduce((sum, s) => sum + (s.open_count || 0), 0),
      inreview_complaints: complaintStats.reduce((sum, s) => sum + (s.inreview_count || 0), 0),
      resolved_complaints: complaintStats.reduce((sum, s) => sum + (s.resolved_count || 0), 0),
      personnel_with_complaints: complaintStats.filter(s => s.total_count > 0).length
    };

    // Her personel için detaylı şikayetler
    const detailedComplaints = db.prepare(`
      SELECT
        pc.id,
        pc.personnel_id,
        pc.title,
        pc.description,
        pc.status,
        u.full_name as recorder,
        pc.created_at
      FROM personnel_complaints pc
      LEFT JOIN users u ON u.id = pc.recorded_by
      ORDER BY pc.personnel_id, pc.created_at DESC
    `).all();

    // Personel başına şikayetleri grupla
    const complaintsByPersonnel = new Map();
    detailedComplaints.forEach(complaint => {
      if (!complaintsByPersonnel.has(complaint.personnel_id)) {
        complaintsByPersonnel.set(complaint.personnel_id, []);
      }
      complaintsByPersonnel.get(complaint.personnel_id).push(complaint);
    });

    // Report data hazırla - sadece şikayeti olan personelleri göster
    const reportData = personnelList
      .map(p => {
        const stats = statsMap.get(p.id) || {
          open_count: 0,
          inreview_count: 0,
          resolved_count: 0,
          total_count: 0
        };

        return {
          ...p,
          ...stats,
          complaints: complaintsByPersonnel.get(p.id) || []
        };
      })
      .filter(p => p.complaints.length > 0); // Sadece şikayeti olan personeller

    res.render('reports', {
      mode: 'personel-sikayetleri',
      personnelReport: {
        data: reportData,
        summary: summaryStats
      }
    });
  } catch (error) {
    console.error('Personel şikayetleri raporu hatası:', error);
    res.status(500).send('Rapor yüklenirken hata oluştu');
  }
});

// Personel Şikayetleri Excel Raporu
router.get('/personel-sikayetleri/excel', async (req, res) => {
  try {
    const personnelList = db.prepare(`
      SELECT
        p.id,
        p.first_name,
        p.last_name,
        p.department,
        p.room_id,
        r.room_number,
        p.status
      FROM personnel p
      LEFT JOIN rooms r ON r.id = p.room_id
      WHERE p.status IN ('aktif', 'cikis_yapti') AND p.room_id IS NOT NULL
      ORDER BY p.first_name, p.last_name
    `).all();

    const complaintStats = db.prepare(`
      SELECT
        p.id,
        COUNT(CASE WHEN pc.status = 'acik' THEN 1 END) AS open_count,
        COUNT(CASE WHEN pc.status = 'inceleniyor' THEN 1 END) AS inreview_count,
        COUNT(CASE WHEN pc.status = 'cozuldu' THEN 1 END) AS resolved_count,
        COUNT(pc.id) AS total_count
      FROM personnel p
      LEFT JOIN personnel_complaints pc ON pc.personnel_id = p.id
      WHERE p.status IN ('aktif', 'cikis_yapti')
      GROUP BY p.id
    `).all();

    const statsMap = new Map();
    complaintStats.forEach(stat => {
      statsMap.set(stat.id, {
        open_count: stat.open_count || 0,
        inreview_count: stat.inreview_count || 0,
        resolved_count: stat.resolved_count || 0,
        total_count: stat.total_count || 0
      });
    });

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Personel Şikayetleri');

    // Header
    ws.columns = [
      { header: 'Personel Adı', key: 'name', width: 20 },
      { header: 'Departman', key: 'department', width: 15 },
      { header: 'Oda', key: 'room', width: 10 },
      { header: 'Şikayet', key: 'complaint_title', width: 60 }
    ];

    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } };
    ws.getRow(1).alignment = { wrapText: true, vertical: 'center' };

    // Sadece şikayeti olan personellerin şikayetlerini al
    const detailedComplaints = db.prepare(`
      SELECT
        p.id,
        p.first_name,
        p.last_name,
        p.department,
        r.room_number,
        pc.id as complaint_id,
        pc.title,
        pc.description,
        pc.status,
        u.full_name as recorder,
        pc.created_at
      FROM personnel p
      LEFT JOIN rooms r ON r.id = p.room_id
      INNER JOIN personnel_complaints pc ON pc.personnel_id = p.id
      LEFT JOIN users u ON u.id = pc.recorded_by
      WHERE p.status IN ('aktif', 'cikis_yapti') AND p.room_id IS NOT NULL
      ORDER BY p.first_name, p.last_name, pc.created_at DESC
    `).all();

    // Personel başına şikayetleri grupla
    const complaintsByPerson = new Map();
    detailedComplaints.forEach(row => {
      const key = `${row.id}`;
      if (!complaintsByPerson.has(key)) {
        complaintsByPerson.set(key, {
          name: `${row.first_name} ${row.last_name}`,
          department: row.department || '-',
          room: row.room_number || '-',
          complaints: []
        });
      }
      complaintsByPerson.get(key).complaints.push({
        title: row.title || '-',
        desc: row.description || '-'
      });
    });

    // Her personel için bir satır ekle - tüm şikayetler aynı satırda
    complaintsByPerson.forEach((person) => {
      const complaintsText = person.complaints
        .map(c => `${c.title}: ${c.desc}`)
        .join('\n');

      ws.addRow({
        name: person.name,
        department: person.department,
        room: person.room,
        complaint_title: complaintsText
      });
    });

    // Boş satır
    ws.addRow({});

    // Summary satırı
    const totalComplaints = detailedComplaints.length;
    const totalPersonnel = complaintsByPerson.size;
    const openCount = detailedComplaints.filter(d => d.status === 'acik').length;

    const summaryRow = ws.addRow({
      name: 'TOPLAM',
      department: `Personel Sayısı: ${totalPersonnel}`,
      room: `Şikayet: ${totalComplaints}`,
      complaint_title: `Açık: ${openCount}`
    });

    summaryRow.font = { bold: true };
    summaryRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2EFDA' } };

    // Dosya indir
    const fileName = `personel-sikayetleri-raporu-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (error) {
    console.error('Excel export hatası:', error);
    res.status(500).send('Excel dosyası oluşturulurken hata oluştu');
  }
});

module.exports = router;
