const express = require('express');
const router = express.Router();
const { db, logActivity, formatLocalTimestamp } = require('../database');

const NOTE_TAGS = {
  normal: {
    label: 'Genel',
    badgeClass: 'text-bg-secondary',
    cardClass: 'note-tag-normal',
    icon: 'bi-journal-text'
  },
  onemli: {
    label: 'Önemli',
    badgeClass: 'text-bg-warning text-dark',
    cardClass: 'note-tag-important',
    icon: 'bi-exclamation-triangle-fill'
  },
  acil: {
    label: 'Acil',
    badgeClass: 'text-bg-danger',
    cardClass: 'note-tag-urgent',
    icon: 'bi-lightning-charge-fill'
  }
};

const NOTE_DUE_STATES = {
  none: {
    label: 'Tarih yok',
    badgeClass: 'text-bg-dark',
    cardClass: 'note-state-none',
    icon: 'bi-calendar3'
  },
  future: {
    label: 'Takipte',
    badgeClass: 'text-bg-info text-dark',
    cardClass: 'note-state-future',
    icon: 'bi-calendar-event'
  },
  due_today: {
    label: 'Bugün bitiyor',
    badgeClass: 'text-bg-warning text-dark',
    cardClass: 'note-state-due-today',
    icon: 'bi-hourglass-split'
  },
  overdue: {
    label: 'Süresi geçti',
    badgeClass: 'text-bg-danger',
    cardClass: 'note-state-overdue',
    icon: 'bi-exclamation-triangle-fill'
  }
};

function getSafeUserId(req) {
  const rawUserId = req.session && req.session.user ? req.session.user.id : null;
  const actorUser = rawUserId ? db.prepare('SELECT id FROM users WHERE id = ?').get(rawUserId) : null;
  return actorUser ? actorUser.id : null;
}

function formatLocalDate(date = new Date()) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateLabel(value) {
  if (!value) return 'Belirlenmedi';
  const normalizedValue = String(value).includes('T') || String(value).includes(' ')
    ? String(value).replace(' ', 'T')
    : `${String(value)}T00:00:00`;
  const parsed = new Date(normalizedValue);
  if (Number.isNaN(parsed.getTime())) return String(value);
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  }).format(parsed);
}

function normalizeTag(tag) {
  const normalized = String(tag || 'normal').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(NOTE_TAGS, normalized) ? normalized : 'normal';
}

function buildNoteTitle(content) {
  const firstLine = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || '';

  const compact = firstLine || String(content || '').trim();
  if (!compact) return 'Not';
  return compact.length > 60 ? `${compact.slice(0, 57)}...` : compact;
}

function getDueState(dueDate, todayKey) {
  if (!dueDate) return 'none';
  const normalized = String(dueDate).slice(0, 10);
  if (normalized < todayKey) return 'overdue';
  if (normalized === todayKey) return 'due_today';
  return 'future';
}

function getLocalDateFromKey(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return null;
  const [year, month, day] = String(dateKey).split('-').map((p) => Number(p));
  return new Date(year, month - 1, day);
}

function getDaysDiffFromToday(dateKey, todayKey) {
  const targetDate = getLocalDateFromKey(dateKey);
  const todayDate = getLocalDateFromKey(todayKey);
  if (!targetDate || !todayDate) return null;
  const millisecondsPerDay = 24 * 60 * 60 * 1000;
  const diffMs = targetDate.getTime() - todayDate.getTime();
  return Math.round(diffMs / millisecondsPerDay);
}

function hydrateNote(note, todayKey) {
  const tag = normalizeTag(note.tag);
  const dueState = getDueState(note.due_date, todayKey);
  const tagMeta = NOTE_TAGS[tag];
  const dueMeta = NOTE_DUE_STATES[dueState];
  const daysUntilDue = getDaysDiffFromToday(note.due_date, todayKey);
  const isDueSoon = typeof daysUntilDue === 'number' && daysUntilDue >= 1 && daysUntilDue <= 2;
  const showDueMarker = dueState === 'due_today' || isDueSoon;

  return {
    ...note,
    tag,
    is_pinned: Number(note.is_pinned) === 1,
    tag_label: tagMeta.label,
    tag_badge_class: tagMeta.badgeClass,
    tag_card_class: tagMeta.cardClass,
    tag_icon: tagMeta.icon,
    due_state: dueState,
    due_label: dueMeta.label,
    due_badge_class: dueMeta.badgeClass,
    due_card_class: dueMeta.cardClass,
    due_icon: dueMeta.icon,
    show_due_marker: showDueMarker,
    due_marker_label: dueState === 'due_today' ? 'Bugün bitiyor' : (isDueSoon ? 'Yaklaşıyor' : ''),
    due_marker_badge_class: dueState === 'due_today' ? 'text-bg-warning text-dark' : 'text-bg-info text-dark',
    due_marker_icon: dueState === 'due_today' ? 'bi-hourglass-split' : 'bi-alarm',
    created_at_label: formatDateLabel(note.created_at),
    due_date_label: formatDateLabel(note.due_date)
  };
}

function getNotes() {
  const todayKey = formatLocalDate();
  const rows = db.prepare(`
    SELECT
      n.*,
      u.full_name AS creator_name,
      CASE
        WHEN n.due_date IS NULL OR n.due_date = '' THEN 'none'
        WHEN date(n.due_date) < date('now', 'localtime') THEN 'overdue'
        WHEN date(n.due_date) = date('now', 'localtime') THEN 'due_today'
        ELSE 'future'
      END AS due_state
    FROM notes n
    LEFT JOIN users u ON n.created_by = u.id
    ORDER BY
      n.is_pinned DESC,
      CASE WHEN n.due_date IS NULL OR n.due_date = '' THEN 1 ELSE 0 END,
      n.due_date ASC,
      n.created_at DESC
  `).all();

  const notes = rows.map((note) => hydrateNote(note, todayKey));
  const pinnedNotes = notes.filter((note) => note.is_pinned);
  const dueTodayNotes = notes.filter((note) => !note.is_pinned && note.due_state === 'due_today');
  const overdueNotes = notes.filter((note) => !note.is_pinned && note.due_state === 'overdue');
  const activeNotes = notes.filter((note) => !note.is_pinned && (note.due_state === 'future' || note.due_state === 'none'));

  return {
    notes,
    pinnedNotes,
    dueTodayNotes,
    overdueNotes,
    activeNotes,
    stats: {
      total: notes.length,
      pinned: pinnedNotes.length,
      dueToday: notes.filter((note) => note.due_state === 'due_today').length,
      overdue: notes.filter((note) => note.due_state === 'overdue').length
    }
  };
}

router.get('/', (req, res) => {
  const data = getNotes();

  res.render('notlar', {
    title: 'Notlar',
    ...data
  });
});

router.post('/ekle', (req, res) => {
  const content = String(req.body.content || '').trim();
  const title = buildNoteTitle(content);
  const tag = normalizeTag(req.body.tag);
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.due_date || '')) ? String(req.body.due_date) : null;
  const safeUserId = getSafeUserId(req);

  if (!content) {
    return res.redirect('/notlar');
  }

  db.prepare(`
    INSERT INTO notes (title, content, tag, is_pinned, due_date, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, content, tag, 0, dueDate, safeUserId, formatLocalTimestamp(), formatLocalTimestamp());

  logActivity('not_ekle', `Not eklendi: ${title}`, dueDate ? `Bitiş tarihi: ${dueDate}` : null, safeUserId);
  res.redirect('/notlar');
});

router.post('/:id/guncelle', (req, res) => {
  const noteId = Number(req.params.id);
  const content = String(req.body.content || '').trim();
  const title = buildNoteTitle(content);
  const tag = normalizeTag(req.body.tag);
  const dueDate = /^\d{4}-\d{2}-\d{2}$/.test(String(req.body.due_date || '')) ? String(req.body.due_date) : null;
  const safeUserId = getSafeUserId(req);
  const note = db.prepare('SELECT id, is_pinned FROM notes WHERE id = ?').get(noteId);
  const hasPinnedField = Object.prototype.hasOwnProperty.call(req.body || {}, 'is_pinned');
  const nextPinned = hasPinnedField && (req.body.is_pinned === '1' || req.body.is_pinned === 'on')
    ? 1
    : Number(note && note.is_pinned ? 1 : 0);

  if (!note || !content) {
    return res.redirect('/notlar');
  }

  db.prepare(`
    UPDATE notes
    SET title = ?, content = ?, tag = ?, is_pinned = ?, due_date = ?, updated_at = ?
    WHERE id = ?
  `).run(title, content, tag, nextPinned, dueDate, formatLocalTimestamp(), noteId);

  logActivity('not_guncelle', `Not güncellendi: ${title}`, dueDate ? `Bitiş tarihi: ${dueDate}` : null, safeUserId);
  res.redirect('/notlar');
});

router.post('/:id/sabitle', (req, res) => {
  const noteId = Number(req.params.id);
  const safeUserId = getSafeUserId(req);
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);

  if (note) {
    const nextPinned = Number(note.is_pinned) === 1 ? 0 : 1;
    db.prepare('UPDATE notes SET is_pinned = ?, updated_at = ? WHERE id = ?').run(nextPinned, formatLocalTimestamp(), noteId);
    logActivity(nextPinned ? 'not_sabitlendi' : 'not_sabit_kaldirildi', `Not ${nextPinned ? 'sabitlendi' : 'sabit kaldırıldı'}: ${note.title}`, null, safeUserId);
  }

  res.redirect('/notlar');
});

router.post('/:id/sil', (req, res) => {
  const noteId = Number(req.params.id);
  const safeUserId = getSafeUserId(req);
  const note = db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);

  if (note) {
    db.prepare('DELETE FROM notes WHERE id = ?').run(noteId);
    logActivity('not_sil', `Not silindi: ${note.title}`, note.due_date ? `Bitiş tarihi: ${note.due_date}` : null, safeUserId);
  }

  res.redirect('/notlar');
});

module.exports = router;