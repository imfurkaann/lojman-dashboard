const path = require('path');
const fs = require('fs/promises');
const pino = require('pino');
const QRCode = require('qrcode');
const {
  db,
  logActivity,
  getWhatsappSelectedGroups,
  getWhatsappEquipmentReminderRules,
  getWhatsappDailyTemplates,
  upsertWhatsappEquipmentReminderDelivery,
  upsertWhatsappDailyTemplateDelivery
} = require('../database');

const AUTH_FOLDER = path.join(__dirname, '..', 'data', 'whatsapp-auth');
const MAX_MESSAGE_CACHE = 250;

const logger = pino({ level: process.env.WHATSAPP_LOG_LEVEL || 'silent' });

const state = {
  connection: 'idle',
  registered: false,
  qr: null,
  qrDataUrl: null,
  lastError: null,
  lastConnectedAt: null,
  lastDisconnectedAt: null,
  me: null,
  groups: [],
  lastGroupRefreshAt: null,
  ready: false
};

let sock = null;
let saveCreds = null;
let startPromise = null;
let reconnectTimer = null;
let socketEpoch = 0;
let activeSocketEpoch = 0;
const messageCache = new Map();
let equipmentReminderTimer = null;
let equipmentReminderSweepRunning = false;

function normalizePhoneNumber(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';

  if (digits.startsWith('90') && digits.length === 12) {
    return digits;
  }

  if (digits.startsWith('0') && digits.length === 11) {
    return `90${digits.slice(1)}`;
  }

  if (digits.length === 10) {
    return `90${digits}`;
  }

  return digits;
}

function cacheMessage(message) {
  const key = message && message.key ? `${message.key.remoteJid || 'unknown'}:${message.key.id || 'unknown'}` : null;
  if (!key) return;

  messageCache.set(key, message);
  if (messageCache.size > MAX_MESSAGE_CACHE) {
    const firstKey = messageCache.keys().next().value;
    if (firstKey) {
      messageCache.delete(firstKey);
    }
  }
}

function normalizeAutomationKey(value) {
  return String(value || '').trim().toLocaleLowerCase('tr-TR');
}

function parseLocalDateTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function getLocalDateParts(date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');

  return {
    dateKey: `${year}-${month}-${day}`,
    timeKey: `${hour}:${minute}`
  };
}

function formatAutomationTimestamp(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
    return '';
  }

  return new Intl.DateTimeFormat('tr-TR', {
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(date);
}

function renderAutomationTemplate(template, context) {
  const values = {
    item_name: context.item_name || '',
    given_to: context.given_to || '',
    room_number: context.room_number || '-',
    delay_minutes: String(context.delay_minutes ?? ''),
    elapsed_minutes: String(context.elapsed_minutes ?? ''),
    given_at: context.given_at || '',
    given_at_iso: context.given_at_iso || '',
    sent_at: context.sent_at || '',
    current_time: context.current_time || ''
  };

  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const normalizedKey = String(key || '').trim();
    return Object.prototype.hasOwnProperty.call(values, normalizedKey) ? values[normalizedKey] : '';
  });
}

function renderDailyTemplate(template, context) {
  const values = {
    // Eski isimleri uyumluluğu için koruyuyoruz
    title: context.title || '',
    current_date: context.current_date || '',
    current_time: context.current_time || '',
    group_count: String(context.group_count || 0),
    
    // Yeni, daha açıklayıcı isimler
    template_title: context.title || '',
    today_date: context.current_date || '',
    send_time: context.current_time || '',
    group_numbers: String(context.group_count || 0)
  };

  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const normalizedKey = String(key || '').trim();
    return Object.prototype.hasOwnProperty.call(values, normalizedKey) ? values[normalizedKey] : '';
  });
}

function ensureEquipmentReminderScheduler() {
  if (equipmentReminderTimer) {
    return equipmentReminderTimer;
  }

  const runSweep = async () => {
    if (equipmentReminderSweepRunning) {
      return;
    }

    equipmentReminderSweepRunning = true;
    try {
      await processEquipmentReminders();
      await processDailyTemplates();
    } catch (error) {
      state.lastError = error.message || String(error);
      logger.warn({ error }, 'failed to process whatsapp equipment reminders');
    } finally {
      equipmentReminderSweepRunning = false;
    }
  };

  equipmentReminderTimer = setInterval(() => {
    runSweep().catch((error) => {
      state.lastError = error.message || String(error);
    });
  }, 60000);

  if (typeof equipmentReminderTimer.unref === 'function') {
    equipmentReminderTimer.unref();
  }

  runSweep().catch((error) => {
    state.lastError = error.message || String(error);
  });

  return equipmentReminderTimer;
}

async function processEquipmentReminders() {
  if (!sock || state.connection !== 'open') {
    return { ok: false, reason: 'whatsapp_not_ready' };
  }

  const rules = getWhatsappEquipmentReminderRules().filter((rule) => rule && rule.isEnabled);
  if (!rules.length) {
    return { ok: true, processed: 0 };
  }

  const selectedGroups = getWhatsappSelectedGroups();
  if (!selectedGroups.length) {
    return { ok: true, processed: 0 };
  }

  const rulesByItemName = new Map(rules.map((rule) => [normalizeAutomationKey(rule.itemName), rule]));
  const reminders = db.prepare(`
    SELECT
      se.id AS shared_equipment_id,
      se.item_name,
      se.given_to,
      se.room_number,
      se.given_at,
      se.status,
      r.id AS rule_id,
      r.item_name AS rule_item_name,
      r.delay_minutes,
      r.message_template
    FROM shared_equipment se
    INNER JOIN whatsapp_equipment_reminder_rules r ON LOWER(TRIM(r.item_name)) = LOWER(TRIM(se.item_name))
    WHERE se.status = 'teslim_edildi'
      AND r.is_enabled = 1
    ORDER BY datetime(se.given_at) ASC, se.id ASC
  `).all();

  if (!reminders.length) {
    return { ok: true, processed: 0 };
  }

  const sentGroupsStmt = db.prepare(`
    SELECT group_jid
    FROM whatsapp_equipment_reminder_deliveries
    WHERE shared_equipment_id = ? AND status = 'sent'
  `);

  let processedCount = 0;

  for (const reminder of reminders) {
    const rule = rulesByItemName.get(normalizeAutomationKey(reminder.rule_item_name || reminder.item_name));
    if (!rule) {
      continue;
    }

    const givenAt = parseLocalDateTime(reminder.given_at);
    if (!givenAt) {
      continue;
    }

    const elapsedMinutes = Math.floor((Date.now() - givenAt.getTime()) / 60000);
    if (elapsedMinutes < Number(rule.delayMinutes || 0)) {
      continue;
    }

    const sentGroupRows = sentGroupsStmt.all(reminder.shared_equipment_id);
    const sentGroupSet = new Set(
      sentGroupRows.map((row) => normalizeAutomationKey(row.group_jid))
    );
    const pendingGroups = selectedGroups.filter((group) => !sentGroupSet.has(normalizeAutomationKey(group.group_jid)));

    if (!pendingGroups.length) {
      continue;
    }

    const message = renderAutomationTemplate(rule.messageTemplate, {
      item_name: reminder.item_name,
      given_to: reminder.given_to,
      room_number: reminder.room_number || '-',
      delay_minutes: rule.delayMinutes,
      elapsed_minutes: elapsedMinutes,
      given_at: formatAutomationTimestamp(givenAt),
      given_at_iso: reminder.given_at,
      current_time: formatAutomationTimestamp(new Date())
    });

    let successCount = 0;
    const failedGroups = [];

    for (const group of pendingGroups) {
      try {
        const result = await sendToGroup(group.group_jid, message);
        upsertWhatsappEquipmentReminderDelivery({
          shared_equipment_id: reminder.shared_equipment_id,
          rule_id: reminder.rule_id,
          group_jid: result.jid,
          message,
          status: 'sent'
        });
        successCount += 1;
      } catch (error) {
        failedGroups.push(group.subject || group.group_jid);
        try {
          upsertWhatsappEquipmentReminderDelivery({
            shared_equipment_id: reminder.shared_equipment_id,
            rule_id: reminder.rule_id,
            group_jid: group.group_jid,
            message,
            status: 'failed',
            error_message: error.message || String(error)
          });
        } catch (deliveryError) {
          logger.warn({ error: deliveryError }, 'failed to persist failed whatsapp reminder delivery');
        }
      }
    }

    if (successCount > 0) {
      processedCount += 1;
      const summary = `${reminder.item_name} eşyası için WhatsApp otomatik hatırlatma gönderildi: ${successCount} grup`;
      logActivity(
        'whatsapp_auto_send',
        summary,
        JSON.stringify({
          item_name: reminder.item_name,
          given_to: reminder.given_to,
          room_number: reminder.room_number,
          delay_minutes: rule.delayMinutes,
          elapsed_minutes: elapsedMinutes,
          sent_groups: pendingGroups.filter((group) => !failedGroups.includes(group.subject || group.group_jid)).map((group) => group.group_jid),
          failed_groups: failedGroups,
          message
        }),
        null
      );
    }
  }

  return { ok: true, processed: processedCount };
}

async function processDailyTemplates() {
  if (!sock || state.connection !== 'open') {
    return { ok: false, reason: 'whatsapp_not_ready' };
  }

  const templates = getWhatsappDailyTemplates().filter((template) => template && template.isEnabled);
  if (!templates.length) {
    return { ok: true, processed: 0 };
  }

  const selectedGroups = getWhatsappSelectedGroups();
  if (!selectedGroups.length) {
    return { ok: true, processed: 0 };
  }

  const now = new Date();
  const { dateKey, timeKey } = getLocalDateParts(now);
  const dueTemplates = templates.filter((template) => String(template.sendTime || '').trim() === timeKey);
  if (!dueTemplates.length) {
    return { ok: true, processed: 0 };
  }

  const sentGroupsStmt = db.prepare(`
    SELECT group_jid
    FROM whatsapp_daily_template_deliveries
    WHERE template_id = ? AND send_date = ? AND status = 'sent'
  `);

  let processedCount = 0;

  for (const template of dueTemplates) {
    const sentRows = sentGroupsStmt.all(template.id, dateKey);
    const sentGroupSet = new Set(sentRows.map((row) => normalizeAutomationKey(row.group_jid)));
    const pendingGroups = selectedGroups.filter((group) => !sentGroupSet.has(normalizeAutomationKey(group.group_jid)));
    if (!pendingGroups.length) {
      continue;
    }

    const message = renderDailyTemplate(template.messageTemplate, {
      title: template.title,
      current_date: dateKey,
      current_time: timeKey,
      group_count: pendingGroups.length
    });

    let successCount = 0;
    const failedGroups = [];

    for (const group of pendingGroups) {
      try {
        const result = await sendToGroup(group.group_jid, message);
        upsertWhatsappDailyTemplateDelivery({
          template_id: template.id,
          group_jid: result.jid,
          send_date: dateKey,
          message,
          status: 'sent'
        });
        successCount += 1;
      } catch (error) {
        failedGroups.push(group.subject || group.group_jid);
        try {
          upsertWhatsappDailyTemplateDelivery({
            template_id: template.id,
            group_jid: group.group_jid,
            send_date: dateKey,
            message,
            status: 'failed',
            error_message: error.message || String(error)
          });
        } catch (deliveryError) {
          logger.warn({ error: deliveryError }, 'failed to persist failed daily template delivery');
        }
      }
    }

    if (successCount > 0) {
      processedCount += 1;
      logActivity(
        'whatsapp_daily_template_send',
        `WhatsApp günlük şablon gönderildi: ${template.title} (${successCount} grup)`,
        JSON.stringify({
          template_id: template.id,
          title: template.title,
          send_date: dateKey,
          send_time: timeKey,
          sent_groups: pendingGroups.filter((group) => !failedGroups.includes(group.subject || group.group_jid)).map((group) => group.group_jid),
          failed_groups: failedGroups,
          message
        }),
        null
      );
    }
  }

  return { ok: true, processed: processedCount };
}

function groupMapToArray(groupMap) {
  return Object.values(groupMap || {})
    .map((group) => ({
      id: group.id,
      subject: group.subject || group.name || group.id,
      desc: group.desc || '',
      participants: Array.isArray(group.participants) ? group.participants.length : 0,
      announce: !!group.announce,
      restrict: !!group.restrict,
      isCommunity: !!group.isCommunity
    }))
    .sort((left, right) => String(left.subject).localeCompare(String(right.subject), 'tr'));
}

async function loadBaileys() {
  const module = await import('@whiskeysockets/baileys');
  return {
    makeWASocket: module.default || module.makeWASocket,
    useMultiFileAuthState: module.useMultiFileAuthState,
    fetchLatestBaileysVersion: module.fetchLatestBaileysVersion,
    Browsers: module.Browsers,
    DisconnectReason: module.DisconnectReason
  };
}

async function refreshQrDataUrl(qr) {
  if (!qr) {
    state.qr = null;
    state.qrDataUrl = null;
    return;
  }

  state.qr = qr;
  try {
    state.qrDataUrl = await QRCode.toDataURL(qr, {
      errorCorrectionLevel: 'M',
      margin: 1,
      scale: 6,
      width: 280
    });
  } catch (error) {
    state.qrDataUrl = null;
    state.lastError = error.message || String(error);
  }
}

async function refreshGroups() {
  if (!sock || state.connection !== 'open') {
    return state.groups;
  }

  try {
    const groups = await sock.groupFetchAllParticipating();
    state.groups = groupMapToArray(groups);
    state.lastGroupRefreshAt = new Date().toISOString();
  } catch (error) {
    state.lastError = error.message || String(error);
  }

  return state.groups;
}

function beginSocketSession() {
  socketEpoch += 1;
  activeSocketEpoch = socketEpoch;
  return activeSocketEpoch;
}

function clearTransientState(options = {}) {
  const preserveQr = options.preserveQr !== false;

  state.connection = 'connecting';
  state.registered = false;
  if (!preserveQr) {
    state.qr = null;
    state.qrDataUrl = null;
  }
  state.lastError = null;
  state.lastConnectedAt = null;
  state.lastDisconnectedAt = null;
  state.me = null;
  state.groups = [];
  state.lastGroupRefreshAt = null;
  state.ready = false;
}

async function closeCurrentSocket(reason = 'manual shutdown') {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  const currentSocket = sock;
  sock = null;
  beginSocketSession();

  if (currentSocket && typeof currentSocket.end === 'function') {
    try {
      currentSocket.end(new Error(reason));
    } catch (error) {
      logger.debug({ error }, 'failed to close current whatsapp socket');
    }
  }
}

async function createSocket(epoch = beginSocketSession()) {
  const { makeWASocket, useMultiFileAuthState, fetchLatestBaileysVersion, Browsers, DisconnectReason } = await loadBaileys();
  const authState = await useMultiFileAuthState(AUTH_FOLDER);
  const latestVersion = await fetchLatestBaileysVersion().catch(() => null);
  activeSocketEpoch = epoch;

  saveCreds = authState.saveCreds;
  clearTransientState({ preserveQr: true });
  sock = makeWASocket({
    ...(latestVersion && latestVersion.version ? { version: latestVersion.version } : {}),
    auth: authState.state,
    logger,
    browser: Browsers.windows('Lojman Paneli'),
    printQRInTerminal: false,
    markOnlineOnConnect: false,
    generateHighQualityLinkPreview: true,
    syncFullHistory: false,
    shouldIgnoreJid: () => false,
    // WhatsApp connection timeout tuning for QR scanning tolerance
    connectTimeoutMs: 20000, // 20 seconds to establish connection
    defaultQueryTimeoutMs: 30000, // 30 seconds for queries
    // QR Code validity period - extended to allow mobile scanning time
    qrTimeout: 120000, // 120 seconds for user to scan QR (was ~20s default)
    // Aggressive reconnection for mobile scanning stability
    maxRetries: 3, // Retry failed connections 3 times
    maxCallLengthMs: 60000, // Support long calls
    // Socket keep-alive to prevent timeout during scanning
    keepAliveIntervalMs: 30000, // Send keep-alive every 30s
    // Reconnect on any connection failure
    retryRequestDelayMs: 100,
    msgRetryCounterMap: {},
    getMessage: async (key) => {
      const cacheKey = `${key.remoteJid || 'unknown'}:${key.id || 'unknown'}`;
      return messageCache.get(cacheKey);
    }
  });

  sock.ev.on('creds.update', async () => {
    if (saveCreds) {
      await saveCreds();
    }
  });

  sock.ev.on('messages.upsert', (event) => {
    (event.messages || []).forEach(cacheMessage);
  });

  sock.ev.on('groups.upsert', (groups) => {
    if (!Array.isArray(groups) || !groups.length) return;
    const currentById = new Map(state.groups.map((group) => [group.id, group]));
    groups.forEach((group) => {
      currentById.set(group.id, {
        id: group.id,
        subject: group.subject || group.name || group.id,
        desc: group.desc || '',
        participants: Array.isArray(group.participants) ? group.participants.length : 0,
        announce: !!group.announce,
        restrict: !!group.restrict,
        isCommunity: !!group.isCommunity
      });
    });
    state.groups = Array.from(currentById.values()).sort((left, right) => String(left.subject).localeCompare(String(right.subject), 'tr'));
  });

  sock.ev.on('groups.update', (updates) => {
    if (!Array.isArray(updates) || !updates.length) return;
    const currentById = new Map(state.groups.map((group) => [group.id, group]));
    updates.forEach((update) => {
      const existing = currentById.get(update.id);
      if (!existing) return;
      currentById.set(update.id, {
        ...existing,
        subject: update.subject || existing.subject,
        desc: typeof update.desc === 'string' ? update.desc : existing.desc,
        participants: Array.isArray(update.participants) ? update.participants.length : existing.participants,
        announce: typeof update.announce === 'boolean' ? update.announce : existing.announce,
        restrict: typeof update.restrict === 'boolean' ? update.restrict : existing.restrict,
        isCommunity: typeof update.isCommunity === 'boolean' ? update.isCommunity : existing.isCommunity
      });
    });
    state.groups = Array.from(currentById.values()).sort((left, right) => String(left.subject).localeCompare(String(right.subject), 'tr'));
  });

  sock.ev.on('connection.update', async (update) => {
    if (epoch !== activeSocketEpoch) {
      return;
    }

    state.connection = update.connection || state.connection;
    state.registered = !!sock.authState?.creds?.registered;
    state.me = sock.user ? {
      id: sock.user.id,
      name: sock.user.name || sock.user.notify || ''
    } : null;

    if (update.qr) {
      await refreshQrDataUrl(update.qr);
    }

    if (update.connection === 'open') {
      state.ready = true;
      state.lastConnectedAt = new Date().toISOString();
      state.lastError = null;
      await refreshQrDataUrl(null);
      await refreshGroups();
      return;
    }

    if (update.connection === 'close') {
      if (epoch !== activeSocketEpoch) {
        return;
      }

      state.ready = false;
      state.lastDisconnectedAt = new Date().toISOString();
      const statusCode = update.lastDisconnect && update.lastDisconnect.error && update.lastDisconnect.error.output ? update.lastDisconnect.error.output.statusCode : null;
      if (statusCode === DisconnectReason.loggedOut) {
        state.connection = 'logged_out';
        state.lastError = 'WhatsApp bağlantısı sonlandırıldı. Yeniden eşleştirme gerekli.';
        return;
      }

      state.lastError = update.lastDisconnect && update.lastDisconnect.error
        ? update.lastDisconnect.error.message || String(update.lastDisconnect.error)
        : 'WhatsApp bağlantısı kapandı.';

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }

      // Fast reconnect to handle mobile scanning timeouts
      reconnectTimer = setTimeout(() => {
        if (epoch !== activeSocketEpoch) {
          return;
        }

        ensureStarted().catch((error) => {
          state.lastError = error.message || String(error);
        });
      }, 1000); // Reduced from 5000ms to 1000ms for faster recovery
    }
  });

  return sock;
}

async function ensureStarted() {
  if (state.connection === 'open' && sock) {
    return sock;
  }

  if (startPromise) {
    return startPromise;
  }

  startPromise = createSocket()
    .catch((error) => {
      state.lastError = error.message || String(error);
      state.connection = 'error';
      state.ready = false;
      throw error;
    })
    .finally(() => {
      startPromise = null;
    });

  return startPromise;
}

async function restartConnection(options = {}) {
  const clearAuth = !!options.clearAuth;

  await closeCurrentSocket(clearAuth ? 'manual auth reset' : 'manual reconnect');
  clearTransientState({ preserveQr: true });

  if (clearAuth) {
    await fs.rm(AUTH_FOLDER, { recursive: true, force: true });
  }

  return ensureStarted();
}

async function resetConnection() {
  return restartConnection({ clearAuth: true });
}

async function resolvePersonJid(phoneOrJid) {
  const raw = String(phoneOrJid || '').trim();
  if (!raw) {
    throw new Error('Telefon numarası girilmedi.');
  }

  if (raw.includes('@')) {
    return raw;
  }

  const normalizedPhone = normalizePhoneNumber(raw);
  if (!normalizedPhone) {
    throw new Error('Telefon numarası geçerli değil.');
  }

  const results = await sock.onWhatsApp(normalizedPhone);
  const match = Array.isArray(results) ? results.find((item) => item && item.exists) : null;
  if (!match || !match.jid) {
    throw new Error('Bu numara WhatsApp üzerinde bulunamadı.');
  }

  return match.jid;
}

async function sendToPerson(phoneOrJid, messageText) {
  await ensureStarted();
  if (!sock || state.connection !== 'open') {
    throw new Error('WhatsApp bağlantısı henüz hazır değil.');
  }

  const text = String(messageText || '').trim();
  if (!text) {
    throw new Error('Gönderilecek mesaj boş olamaz.');
  }

  const jid = await resolvePersonJid(phoneOrJid);
  const result = await sock.sendMessage(jid, { text });

  return {
    jid,
    messageId: result && result.key ? result.key.id : null
  };
}

async function sendToGroup(groupJid, messageText) {
  await ensureStarted();
  if (!sock || state.connection !== 'open') {
    throw new Error('WhatsApp bağlantısı henüz hazır değil.');
  }

  const text = String(messageText || '').trim();
  if (!text) {
    throw new Error('Gönderilecek mesaj boş olamaz.');
  }

  const jid = String(groupJid || '').trim();
  if (!jid) {
    throw new Error('Grup seçilmedi.');
  }

  const normalizedJid = jid.includes('@') ? jid : `${jid}@g.us`;
  const result = await sock.sendMessage(normalizedJid, { text });

  return {
    jid: normalizedJid,
    messageId: result && result.key ? result.key.id : null
  };
}

function getSnapshot() {
  return {
    ...state,
    groups: Array.isArray(state.groups) ? [...state.groups] : []
  };
}

module.exports = {
  ensureStarted,
  ensureEquipmentReminderScheduler,
  getSnapshot,
  normalizePhoneNumber,
  refreshGroups,
  resetConnection,
  restartConnection,
  sendToGroup,
  sendToPerson,
  processEquipmentReminders,
  processDailyTemplates,
  renderAutomationTemplate,
  renderDailyTemplate
};