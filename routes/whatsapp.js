const express = require('express');
const router = express.Router();
const {
  db,
  logActivity,
  getWhatsappSelectedGroups,
  getWhatsappEquipmentReminderRules,
  getWhatsappDailyTemplates,
  upsertWhatsappSelectedGroup,
  upsertWhatsappEquipmentReminderRule,
  upsertWhatsappDailyTemplate,
  deleteWhatsappDailyTemplate,
  removeWhatsappSelectedGroup
} = require('../database');
const whatsappService = require('../services/whatsapp-service');

function normalizeReminderKey(value) {
  return String(value || '').trim().toLocaleLowerCase('tr-TR');
}

function renderPage(req, res, extra = {}) {
  const whatsapp = whatsappService.getSnapshot();
  const queryNotice = String(req.query.notice || '').trim();
  const queryError = String(req.query.error || '').trim();
  const savedEquipmentItems = db.prepare('SELECT name FROM equipment_items ORDER BY name').all();
  const equipmentReminderRules = getWhatsappEquipmentReminderRules();
  const equipmentReminderRulesByItemName = equipmentReminderRules.reduce((accumulator, rule) => {
    accumulator[normalizeReminderKey(rule.itemName)] = rule;
    return accumulator;
  }, {});

  res.render('whatsapp', {
    title: 'WhatsApp',
    whatsapp,
    selectedGroups: getWhatsappSelectedGroups(),
    savedEquipmentItems,
    equipmentReminderRules,
    equipmentReminderRulesByItemName,
    notice: extra.notice || (queryNotice === 'sent' ? 'Mesaj gönderildi.' : queryNotice === 'automation_saved' ? 'Otomatik bildirim ayarları kaydedildi.' : null),
    error: extra.error || (queryError === 'send_failed' ? 'Mesaj gönderilmedi.' : null),
    formData: extra.formData || {}
  });
}

function renderMessageManagementPage(req, res, extra = {}) {
  const queryNotice = String(req.query.notice || '').trim();
  const queryError = String(req.query.error || '').trim();
  const editDailyTemplateId = Number(req.query.edit_daily || 0);
  const savedEquipmentItems = db.prepare('SELECT name FROM equipment_items ORDER BY name').all();
  const equipmentReminderRules = getWhatsappEquipmentReminderRules();
  const dailyTemplates = getWhatsappDailyTemplates();
  const selectedDailyTemplate = editDailyTemplateId
    ? dailyTemplates.find((item) => Number(item.id) === editDailyTemplateId)
    : null;
  const equipmentReminderRulesByItemName = equipmentReminderRules.reduce((accumulator, rule) => {
    accumulator[normalizeReminderKey(rule.itemName)] = rule;
    return accumulator;
  }, {});

  res.render('whatsapp-message-management', {
    title: 'WhatsApp Mesaj Yönetimi',
    whatsapp: whatsappService.getSnapshot(),
    selectedGroups: getWhatsappSelectedGroups(),
    savedEquipmentItems,
    equipmentReminderRules,
    dailyTemplates,
    equipmentReminderRulesByItemName,
    notice: extra.notice || (queryNotice === 'automation_saved'
      ? 'Eşya otomasyon ayarları kaydedildi.'
      : queryNotice === 'daily_saved'
        ? 'Günlük şablon kaydedildi.'
        : queryNotice === 'daily_deleted'
          ? 'Günlük şablon silindi.'
          : null),
    error: extra.error || (queryError === 'send_failed' ? 'Mesaj gönderilemedi.' : null),
    formData: extra.formData || (selectedDailyTemplate
      ? {
          template_id: selectedDailyTemplate.id,
          title: selectedDailyTemplate.title,
          send_time: selectedDailyTemplate.sendTime,
          message_template: selectedDailyTemplate.messageTemplate,
          is_enabled: selectedDailyTemplate.isEnabled
        }
      : {})
  });
}

function sendWhatsAppStatus(res) {
  res.json({
    ok: true,
    whatsapp: {
      ...whatsappService.getSnapshot(),
      selectedGroups: getWhatsappSelectedGroups()
    }
  });
}

router.get('/', async (req, res) => {
  try {
    await whatsappService.ensureStarted();
    await whatsappService.refreshGroups();
    renderPage(req, res);
  } catch (error) {
    renderPage(req, res, {
      error: error.message || 'WhatsApp ekranı yüklenemedi.'
    });
  }
});

router.get('/status', (req, res) => {
  sendWhatsAppStatus(res);
});

router.get('/mesaj-yonetimi', async (req, res) => {
  try {
    await whatsappService.ensureStarted();
    renderMessageManagementPage(req, res);
  } catch (error) {
    renderMessageManagementPage(req, res, {
      error: error.message || 'Mesaj yönetimi ekranı yüklenemedi.'
    });
  }
});

router.get('/selected-groups', (req, res) => {
  return res.json({
    ok: true,
    groups: getWhatsappSelectedGroups()
  });
});

router.post('/selected-groups', (req, res) => {
  const payload = req.body || {};
  const selectedGroup = upsertWhatsappSelectedGroup({
    group_jid: payload.group_jid || payload.id,
    subject: payload.subject,
    participants: payload.participants,
    isCommunity: payload.isCommunity || payload.is_community
  });

  return res.json({
    ok: true,
    group: selectedGroup,
    groups: getWhatsappSelectedGroups()
  });
});

router.delete('/selected-groups/:groupJid', (req, res) => {
  const removed = removeWhatsappSelectedGroup(req.params.groupJid);
  return res.json({
    ok: true,
    removed,
    groups: getWhatsappSelectedGroups()
  });
});

router.post('/equipment-reminder-rules', (req, res) => {
  const rawRows = req.body && req.body.rows ? req.body.rows : {};
  const rows = Object.values(rawRows);

  rows.forEach((row) => {
    const itemName = String(row && row.item_name ? row.item_name : '').trim();
    if (!itemName) {
      return;
    }

    upsertWhatsappEquipmentReminderRule({
      item_name: itemName,
      title: row.title || itemName,
      delay_minutes: row.delay_minutes,
      message_template: row.message_template,
      is_enabled: String(row.is_enabled || '0') === '1'
    });
  });

  if (String(req.headers.accept || '').includes('application/json')) {
    return res.json({
      ok: true,
      rules: getWhatsappEquipmentReminderRules()
    });
  }

  return res.redirect(303, '/whatsapp/mesaj-yonetimi?notice=automation_saved');
});

router.post('/equipment-reminder-rules/:id/toggle', (req, res) => {
  const ruleId = Number(req.params.id || 0);
  const rule = getWhatsappEquipmentReminderRules().find((item) => Number(item.id) === ruleId);

  if (!rule) {
    return res.redirect(303, '/whatsapp/mesaj-yonetimi?error=send_failed');
  }

  upsertWhatsappEquipmentReminderRule({
    item_name: rule.itemName,
    title: rule.title || rule.itemName,
    delay_minutes: rule.delayMinutes,
    message_template: rule.messageTemplate,
    is_enabled: rule.isEnabled ? '0' : '1'
  });

  return res.redirect(303, '/whatsapp/mesaj-yonetimi?notice=automation_saved');
});

router.post('/daily-templates', (req, res) => {
  const body = req.body || {};
  const templateId = Number(body.template_id || 0);

  try {
    upsertWhatsappDailyTemplate({
      id: templateId,
      title: body.title,
      send_time: body.send_time,
      message_template: body.message_template,
      is_enabled: String(body.is_enabled || '0') === '1'
    });

    if (String(req.headers.accept || '').includes('application/json')) {
      return res.json({ ok: true, templates: getWhatsappDailyTemplates() });
    }

    return res.redirect(303, '/whatsapp/mesaj-yonetimi?notice=daily_saved');
  } catch (error) {
    if (String(req.headers.accept || '').includes('application/json')) {
      return res.status(400).json({ ok: false, error: error.message || 'Günlük şablon kaydedilemedi.' });
    }

    return renderMessageManagementPage(req, res, {
      error: error.message || 'Günlük şablon kaydedilemedi.',
      formData: {
        template_id: templateId,
        title: body.title || '',
        send_time: body.send_time || '',
        message_template: body.message_template || '',
        is_enabled: String(body.is_enabled || '0') === '1'
      }
    });
  }
});

router.post('/daily-templates/:id/toggle', (req, res) => {
  const templateId = Number(req.params.id || 0);
  const template = getWhatsappDailyTemplates().find((item) => Number(item.id) === templateId);

  if (!template) {
    return res.redirect(303, '/whatsapp/mesaj-yonetimi?error=send_failed');
  }

  upsertWhatsappDailyTemplate({
    id: template.id,
    title: template.title,
    send_time: template.sendTime,
    message_template: template.messageTemplate,
    is_enabled: template.isEnabled ? '0' : '1'
  });

  return res.redirect(303, '/whatsapp/mesaj-yonetimi?notice=daily_saved');
});

router.post('/daily-templates/:id/delete', (req, res) => {
  try {
    const removed = deleteWhatsappDailyTemplate(req.params.id);

    if (String(req.headers.accept || '').includes('application/json')) {
      return res.json({ ok: true, removed, templates: getWhatsappDailyTemplates() });
    }

    return res.redirect(303, '/whatsapp/mesaj-yonetimi?notice=daily_deleted');
  } catch (error) {
    if (String(req.headers.accept || '').includes('application/json')) {
      return res.status(400).json({ ok: false, error: error.message || 'Günlük şablon silinemedi.' });
    }

    return renderMessageManagementPage(req, res, {
      error: error.message || 'Günlük şablon silinemedi.'
    });
  }
});

router.post('/control', async (req, res) => {
  const action = String(req.body.action || '').trim();
  const wantsJson = String(req.headers.accept || '').includes('application/json') || String(req.query.format || '').toLowerCase() === 'json';

  try {
    if (action === 'reset') {
      await whatsappService.resetConnection();
    } else if (action === 'reconnect') {
      await whatsappService.restartConnection({ clearAuth: false });
    } else if (action === 'start') {
      await whatsappService.restartConnection({ clearAuth: true });
    }
  } catch (error) {
    console.error('[WhatsApp] control error:', error.message || error);
  }

  if (wantsJson) {
    return sendWhatsAppStatus(res);
  }

  return res.redirect('/whatsapp');
});

async function sendToSavedGroups(req, res) {
  const { group_jid, message } = req.body;
  const formData = { group_jid, message };

  try {
    const selectedGroups = getWhatsappSelectedGroups();
    const targetGroups = String(group_jid || '').trim()
      ? [{ group_jid: String(group_jid).trim(), subject: String(group_jid).trim() }]
      : selectedGroups;

    if (!targetGroups.length) {
      throw new Error('Gönderilecek kayıtlı grup bulunamadı.');
    }

    const results = [];
    for (const group of targetGroups) {
      // Sequential send keeps the UI deterministic and avoids flooding the socket.
      // eslint-disable-next-line no-await-in-loop
      const result = await whatsappService.sendToGroup(group.group_jid, message);
      results.push(result);
    }

    logActivity(
      'whatsapp_send',
      `WhatsApp mesajı ${results.length} gruba gönderildi: ${targetGroups.map((group) => group.subject).join(', ')}`,
      JSON.stringify({
        type: 'group',
        recipients: results.map((item) => item.jid),
        message: String(message || '').trim()
      }),
      req.session && req.session.user ? req.session.user.id : null
    );

    if (String(req.headers.accept || '').includes('application/json')) {
      return res.json({
        ok: true,
        message: results.length > 1 ? `${results.length} gruba mesaj gönderildi.` : 'Mesaj gönderildi.'
      });
    }
    return res.redirect(303, '/whatsapp?notice=sent');
  } catch (error) {
    if (String(req.headers.accept || '').includes('application/json')) {
      return res.status(500).json({ ok: false, error: 'Mesaj gönderilmedi.' });
    }
    return res.redirect(303, '/whatsapp?error=send_failed');
  }
}

router.post('/send-group', sendToSavedGroups);
router.post('/send-selected-groups', sendToSavedGroups);

module.exports = router;

function renderPage(req, res, extra = {}) {
  const whatsapp = whatsappService.getSnapshot();
  const queryNotice = String(req.query.notice || '').trim();
  const queryError = String(req.query.error || '').trim();
  const savedEquipmentItems = db.prepare('SELECT name FROM equipment_items ORDER BY name').all();
  const equipmentReminderRules = getWhatsappEquipmentReminderRules();
  const equipmentReminderRulesByItemName = equipmentReminderRules.reduce((accumulator, rule) => {
    accumulator[normalizeReminderKey(rule.itemName)] = rule;
    return accumulator;
  }, {});

  res.render('whatsapp', {
    title: 'WhatsApp',
    whatsapp,
    selectedGroups: getWhatsappSelectedGroups(),
    savedEquipmentItems,
    equipmentReminderRules,
    equipmentReminderRulesByItemName,
    notice: extra.notice || (queryNotice === 'sent' ? 'Mesaj gönderildi.' : queryNotice === 'automation_saved' ? 'Otomatik bildirim ayarları kaydedildi.' : null),
    error: extra.error || (queryError === 'send_failed' ? 'Mesaj gönderilmedi.' : null),
    formData: extra.formData || {}
  });
}

function renderMessageManagementPage(req, res, extra = {}) {
  const queryNotice = String(req.query.notice || '').trim();
  const queryError = String(req.query.error || '').trim();
  const editDailyTemplateId = Number(req.query.edit_daily || 0);
  const savedEquipmentItems = db.prepare('SELECT name FROM equipment_items ORDER BY name').all();
  const equipmentReminderRules = getWhatsappEquipmentReminderRules();
  const dailyTemplates = getWhatsappDailyTemplates();
  const selectedDailyTemplate = editDailyTemplateId
    ? dailyTemplates.find((item) => Number(item.id) === editDailyTemplateId)
    : null;
  const equipmentReminderRulesByItemName = equipmentReminderRules.reduce((accumulator, rule) => {
    accumulator[normalizeReminderKey(rule.itemName)] = rule;
    return accumulator;
  }, {});

  res.render('whatsapp-message-management', {
    title: 'WhatsApp Mesaj Yönetimi',
    whatsapp: whatsappService.getSnapshot(),
    selectedGroups: getWhatsappSelectedGroups(),
    savedEquipmentItems,
    equipmentReminderRules,
    dailyTemplates,
    equipmentReminderRulesByItemName,
    notice: extra.notice || (queryNotice === 'automation_saved'
      ? 'Eşya otomasyon ayarları kaydedildi.'
      : queryNotice === 'daily_saved'
        ? 'Günlük şablon kaydedildi.'
        : queryNotice === 'daily_deleted'
          ? 'Günlük şablon silindi.'
          : null),
    error: extra.error || (queryError === 'send_failed' ? 'Mesaj gönderilemedi.' : null),
    formData: extra.formData || (selectedDailyTemplate
      ? {
          template_id: selectedDailyTemplate.id,
          title: selectedDailyTemplate.title,
          send_time: selectedDailyTemplate.sendTime,
          message_template: selectedDailyTemplate.messageTemplate,
          is_enabled: selectedDailyTemplate.isEnabled
        }
      : {})
  });
}

function sendWhatsAppStatus(res) {
  res.json({
    ok: true,
    whatsapp: {
      ...whatsappService.getSnapshot(),
      selectedGroups: getWhatsappSelectedGroups()
    }
  });
}

router.get('/', async (req, res) => {
  try {
    await whatsappService.ensureStarted();
    await whatsappService.refreshGroups();
    renderPage(req, res);
  } catch (error) {
    renderPage(req, res, {
      error: error.message || 'WhatsApp ekranı yüklenemedi.'
    });
  }
});

router.get('/status', (req, res) => {
  sendWhatsAppStatus(res);
});

router.get('/mesaj-yonetimi', async (req, res) => {
  try {
    await whatsappService.ensureStarted();
    renderMessageManagementPage(req, res);
  } catch (error) {
    renderMessageManagementPage(req, res, {
      error: error.message || 'Mesaj yönetimi ekranı yüklenemedi.'
    });
  }
});

router.get('/selected-groups', (req, res) => {
  return res.json({
    ok: true,
    groups: getWhatsappSelectedGroups()
  });
});

router.post('/selected-groups', (req, res) => {
  const payload = req.body || {};
  const selectedGroup = upsertWhatsappSelectedGroup({
    group_jid: payload.group_jid || payload.id,
    subject: payload.subject,
    participants: payload.participants,
    isCommunity: payload.isCommunity || payload.is_community
  });

  return res.json({
    ok: true,
    group: selectedGroup,
    groups: getWhatsappSelectedGroups()
  });
});

router.delete('/selected-groups/:groupJid', (req, res) => {
  const removed = removeWhatsappSelectedGroup(req.params.groupJid);
  return res.json({
    ok: true,
    removed,
    groups: getWhatsappSelectedGroups()
  });
});

router.post('/equipment-reminder-rules', (req, res) => {
  const rawRows = req.body && req.body.rows ? req.body.rows : {};
  const rows = Object.values(rawRows);

  rows.forEach((row) => {
    const itemName = String(row && row.item_name ? row.item_name : '').trim();
    if (!itemName) {
      return;
    }

    upsertWhatsappEquipmentReminderRule({
      item_name: itemName,
      title: row.title || itemName,
      delay_minutes: row.delay_minutes,
      message_template: row.message_template,
      is_enabled: String(row.is_enabled || '0') === '1'
    });
  });

  if (String(req.headers.accept || '').includes('application/json')) {
    return res.json({
      ok: true,
      rules: getWhatsappEquipmentReminderRules()
    });
  }

  return res.redirect(303, '/whatsapp/mesaj-yonetimi?notice=automation_saved');
});

router.post('/equipment-reminder-rules/:id/toggle', (req, res) => {
  const ruleId = Number(req.params.id || 0);
  const rule = getWhatsappEquipmentReminderRules().find((item) => Number(item.id) === ruleId);

  if (!rule) {
    return res.redirect(303, '/whatsapp/mesaj-yonetimi?error=send_failed');
  }

  upsertWhatsappEquipmentReminderRule({
    item_name: rule.itemName,
    title: rule.title || rule.itemName,
    delay_minutes: rule.delayMinutes,
    message_template: rule.messageTemplate,
    is_enabled: rule.isEnabled ? '0' : '1'
  });

  return res.redirect(303, '/whatsapp/mesaj-yonetimi?notice=automation_saved');
});

router.post('/daily-templates', (req, res) => {
  const body = req.body || {};
  const templateId = Number(body.template_id || 0);

  try {
    upsertWhatsappDailyTemplate({
      id: templateId,
      title: body.title,
      send_time: body.send_time,
      message_template: body.message_template,
      is_enabled: String(body.is_enabled || '0') === '1'
    });

    if (String(req.headers.accept || '').includes('application/json')) {

router.post('/daily-templates/:id/toggle', (req, res) => {
  const templateId = Number(req.params.id || 0);
  const template = getWhatsappDailyTemplates().find((item) => Number(item.id) === templateId);

  if (!template) {
    return res.redirect(303, '/whatsapp/mesaj-yonetimi?error=send_failed');
  }

  upsertWhatsappDailyTemplate({
    id: template.id,
    title: template.title,
    send_time: template.sendTime,
    message_template: template.messageTemplate,
    is_enabled: template.isEnabled ? '0' : '1'
  });

  return res.redirect(303, '/whatsapp/mesaj-yonetimi?notice=daily_saved');
});
      return res.json({ ok: true, templates: getWhatsappDailyTemplates() });
    }

    return res.redirect(303, '/whatsapp/mesaj-yonetimi?notice=daily_saved');
  } catch (error) {
    if (String(req.headers.accept || '').includes('application/json')) {
      return res.status(400).json({ ok: false, error: error.message || 'Günlük şablon kaydedilemedi.' });
    }

    return renderMessageManagementPage(req, res, {
      error: error.message || 'Günlük şablon kaydedilemedi.',
      formData: {
        template_id: templateId,
        title: body.title || '',
        send_time: body.send_time || '',
        message_template: body.message_template || '',
        is_enabled: String(body.is_enabled || '0') === '1'
      }
    });
  }
});

router.post('/daily-templates/:id/delete', (req, res) => {
  try {
    const removed = deleteWhatsappDailyTemplate(req.params.id);

    if (String(req.headers.accept || '').includes('application/json')) {
      return res.json({ ok: true, removed, templates: getWhatsappDailyTemplates() });
    }

    return res.redirect(303, '/whatsapp/mesaj-yonetimi?notice=daily_deleted');
  } catch (error) {
    if (String(req.headers.accept || '').includes('application/json')) {
      return res.status(400).json({ ok: false, error: error.message || 'Günlük şablon silinemedi.' });
    }

    return renderMessageManagementPage(req, res, {
      error: error.message || 'Günlük şablon silinemedi.'
    });
  }
});

router.post('/control', async (req, res) => {
  const action = String(req.body.action || '').trim();
  const wantsJson = String(req.headers.accept || '').includes('application/json') || String(req.query.format || '').toLowerCase() === 'json';

  try {
    if (action === 'reset') {
      await whatsappService.resetConnection();
    } else if (action === 'reconnect') {
      await whatsappService.restartConnection({ clearAuth: false });
    } else if (action === 'start') {
      await whatsappService.restartConnection({ clearAuth: true });
    }
  } catch (error) {
    console.error('[WhatsApp] control error:', error.message || error);
  }

  if (wantsJson) {
    return sendWhatsAppStatus(res);
  }

  return res.redirect('/whatsapp');
});

async function sendToSavedGroups(req, res) {
  const { group_jid, message } = req.body;
  const formData = { group_jid, message };

  try {
    const selectedGroups = getWhatsappSelectedGroups();
    const targetGroups = String(group_jid || '').trim()
      ? [{ group_jid: String(group_jid).trim(), subject: String(group_jid).trim() }]
      : selectedGroups;

    if (!targetGroups.length) {
      throw new Error('Gönderilecek kayıtlı grup bulunamadı.');
    }

    const results = [];
    for (const group of targetGroups) {
      // Sequential send keeps the UI deterministic and avoids flooding the socket.
      // eslint-disable-next-line no-await-in-loop
      const result = await whatsappService.sendToGroup(group.group_jid, message);
      results.push(result);
    }

    logActivity(
      'whatsapp_send',
      `WhatsApp mesajı ${results.length} gruba gönderildi: ${targetGroups.map((group) => group.subject).join(', ')}`,
      JSON.stringify({
        type: 'group',
        recipients: results.map((item) => item.jid),
        message: String(message || '').trim()
      }),
      req.session && req.session.user ? req.session.user.id : null
    );

    if (String(req.headers.accept || '').includes('application/json')) {
      return res.json({
        ok: true,
        message: results.length > 1 ? `${results.length} gruba mesaj gönderildi.` : 'Mesaj gönderildi.'
      });
    }
    return res.redirect(303, '/whatsapp?notice=sent');
  } catch (error) {
    if (String(req.headers.accept || '').includes('application/json')) {
      return res.status(500).json({ ok: false, error: 'Mesaj gönderilmedi.' });
    }
    return res.redirect(303, '/whatsapp?error=send_failed');
  }
}

router.post('/send-group', sendToSavedGroups);
router.post('/send-selected-groups', sendToSavedGroups);

module.exports = router;
