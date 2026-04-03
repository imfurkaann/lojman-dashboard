const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const SALT_ROUNDS = 10;
const FINGERPRINT_SECRET = process.env.TC_FINGERPRINT_SECRET || process.env.SESSION_SECRET || 'lojman-dashboard-tc-fingerprint-v1';

function normalizeTcNumber(tcNumber) {
  return String(tcNumber || '').trim();
}

/**
 * TC kimlik numarasını şifrele
 * @param {string} tcNumber Düz TC numarası (örn: "12345678901")
 * @returns {Promise<string>} Şifreli TC numarası
 */
async function encryptTcNumber(tcNumber) {
  const normalizedTc = normalizeTcNumber(tcNumber);
  if (!normalizedTc) return null;
  try {
    const hashedValue = await bcrypt.hash(normalizedTc, SALT_ROUNDS);
    return hashedValue;
  } catch (error) {
    console.error('TC numarası şifreleme hatası:', error);
    throw error;
  }
}

function encryptTcNumberSync(tcNumber) {
  const normalizedTc = normalizeTcNumber(tcNumber);
  if (!normalizedTc) return null;
  try {
    return bcrypt.hashSync(normalizedTc, SALT_ROUNDS);
  } catch (error) {
    console.error('TC numarası senkron şifreleme hatası:', error);
    throw error;
  }
}

function createTcFingerprint(tcNumber) {
  const normalizedTc = normalizeTcNumber(tcNumber);
  if (!normalizedTc) return null;
  return crypto.createHmac('sha256', FINGERPRINT_SECRET).update(normalizedTc).digest('hex');
}

/**
 * TC numaralarını karşılaştır (şifreleme ile güvenli eşleştirme)
 * @param {string} plainTc Düz TC numarası
 * @param {string} encryptedTc Şifreli TC numarası
 * @returns {Promise<boolean>} Eşleşmiş mi
 */
async function verifyTcNumber(plainTc, encryptedTc) {
  const normalizedTc = normalizeTcNumber(plainTc);
  if (!normalizedTc || !encryptedTc) return false;
  try {
    const isMatch = await bcrypt.compare(normalizedTc, encryptedTc);
    return isMatch;
  } catch (error) {
    console.error('TC numarası doğrulama hatası:', error);
    return false;
  }
}

/**
 * TC numarasının son 4 hanesini göster (blur effect)
 * @param {string} tcNumber TC numarası (düz veya şifreli)
 * @returns {string} Blur format (örn: "****4567")
 */
function blurTcNumber(tcNumber) {
  if (!tcNumber) return '***';
  const plainTc = String(tcNumber).trim();
  // Şifreli veriler genellikle 60+ karakter olur, düz veriler 11 karakter
  if (plainTc.length > 20) {
    // Şifreli olduğu için uyarı döndür
    return '***(Şifreli)';
  }
  // Düz TC numarası durumu (geriye uyumluluk için)
  const lastFour = plainTc.slice(-4) || '****';
  const hiddenLength = plainTc.length - 4;
  return '*'.repeat(Math.max(0, hiddenLength)) + lastFour;
}

module.exports = {
  encryptTcNumber,
  encryptTcNumberSync,
  createTcFingerprint,
  normalizeTcNumber,
  verifyTcNumber,
  blurTcNumber
};
