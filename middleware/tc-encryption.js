const bcrypt = require('bcryptjs');

const SALT_ROUNDS = 10;

/**
 * TC kimlik numarasını şifrele
 * @param {string} tcNumber Düz TC numarası (örn: "12345678901")
 * @returns {Promise<string>} Şifreli TC numarası
 */
async function encryptTcNumber(tcNumber) {
  if (!tcNumber) return null;
  try {
    const hashedValue = await bcrypt.hash(String(tcNumber).trim(), SALT_ROUNDS);
    return hashedValue;
  } catch (error) {
    console.error('TC numarası şifreleme hatası:', error);
    throw error;
  }
}

/**
 * TC numaralarını karşılaştır (şifreleme ile güvenli eşleştirme)
 * @param {string} plainTc Düz TC numarası
 * @param {string} encryptedTc Şifreli TC numarası
 * @returns {Promise<boolean>} Eşleşmiş mi
 */
async function verifyTcNumber(plainTc, encryptedTc) {
  if (!plainTc || !encryptedTc) return false;
  try {
    const isMatch = await bcrypt.compare(String(plainTc).trim(), encryptedTc);
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
  verifyTcNumber,
  blurTcNumber
};
