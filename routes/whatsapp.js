const express = require('express');
const router = express.Router();
const { logActivity } = require('../database');
const whatsappService = require('../services/whatsapp-service');

function renderPage(req, res, extra = {}) {
  const whatsapp = whatsappService.getSnapshot();

  res.render('whatsapp', {
    title: 'WhatsApp',
    whatsapp,
    notice: extra.notice || null,
    error: extra.error || null,
    formData: extra.formData || {}
  });
}

function sendWhatsAppStatus(res) {
  res.json({
    ok: true,
    whatsapp: whatsappService.getSnapshot()
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

router.post('/send-group', async (req, res) => {
  const { group_jid, message } = req.body;
  const formData = { group_jid, message };

  try {
    const result = await whatsappService.sendToGroup(group_jid, message);
    const group = whatsappService.getSnapshot().groups.find((item) => item.id === result.jid);

    logActivity(
      'whatsapp_send',
      `WhatsApp grubuna mesaj gönderildi: ${group ? group.subject : result.jid}`,
      JSON.stringify({
        type: 'group',
        recipient: result.jid,
        message: String(message || '').trim()
      }),
      req.session && req.session.user ? req.session.user.id : null
    );

    renderPage(req, res, {
      notice: 'Grup mesajı başarıyla gönderildi.',
      formData: {}
    });
  } catch (error) {
    renderPage(req, res, {
      error: error.message || 'Grup mesajı gönderilemedi.',
      formData
    });
  }
});

module.exports = router;
