const crypto = require('crypto');
const logger = require('../utils/logger');

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const key = process.env.DATADIS_ENCRYPTION_KEY;
  if (!key) {
    throw new Error('DATADIS_ENCRYPTION_KEY no està configurada');
  }
  const buffer = Buffer.from(key, 'hex');
  if (buffer.length !== 32) {
    throw new Error('DATADIS_ENCRYPTION_KEY ha de ser una clau de 32 bytes (64 caràcters hex)');
  }
  return buffer;
}

/**
 * Encripta un text (clau de Datadis) amb AES-256-GCM.
 * Format retornat: iv:authTag:ciphertext en hex. NULL si no hi ha res.
 */
function encrypt(plaintext) {
  if (plaintext === null || plaintext === undefined || plaintext === '') {
    return null;
  }
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(String(plaintext), 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  } catch (error) {
    logger.error('Error encriptant la clau de Datadis:', error);
    throw error;
  }
}

/**
 * Desencripta una clau de Datadis prèviament emmagatzemada.
 * Torna NULL si no hi ha valor.
 */
function decrypt(payload) {
  if (!payload) {
    return null;
  }
  try {
    const parts = String(payload).split(':');
    if (parts.length !== 3) {
      throw new Error('Clau de Datadis encriptada en format invàlid');
    }
    const [ivHex, tagHex, dataHex] = parts;
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      getKey(),
      Buffer.from(ivHex, 'hex')
    );
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, 'hex')),
      decipher.final(),
    ]);
    return decrypted.toString('utf8');
  } catch (error) {
    logger.error('Error desencriptant la clau de Datadis:', error);
    throw error;
  }
}

module.exports = { encrypt, decrypt };