const { config, updateConfigInDb } = require('../config');

/**
 * Gemini API Key Manager
 * Handles persistent sticky rotation of multiple API keys.
 * When a key is exhausted, it rotates to the next key and persists the index to DB.
 * The new key is used for ALL subsequent requests until it too is exhausted.
 */

let keyStatuses = [];
let ioInstance = null;

/**
 * Check if statuses array length matches current keys, sync if necessary.
 */
function checkAndInitStatuses() {
  const keys = config.gemini.apiKeys || [];
  if (keyStatuses.length !== keys.length) {
    const newStatuses = keys.map((_, i) => keyStatuses[i] || 'Active');
    keyStatuses = newStatuses;
  }
}

/**
 * Set Socket.io instance for real-time updates.
 */
function setSocketIo(io) {
  ioInstance = io;
}

/**
 * Get status of API key at index.
 */
function getKeyStatus(index) {
  checkAndInitStatuses();
  const keys = config.gemini.apiKeys || [];
  if (index < 0 || index >= keys.length) return 'Unknown';
  return keyStatuses[index] || 'Active';
}

/**
 * Set status of API key at index and emit event.
 */
function setKeyStatus(index, status) {
  checkAndInitStatuses();
  const keys = config.gemini.apiKeys || [];
  if (index < 0 || index >= keys.length) return;
  
  keyStatuses[index] = status;
  console.log(`[KeyManager] 🏷️ Key #${index + 1} status updated to: ${status}`);
  
  if (ioInstance) {
    ioInstance.emit('gemini_key_status_update', { index, status });
  }
}

/**
 * Get the currently active API key based on the persisted index.
 * @returns {string|null} The active API key, or null if no keys are configured.
 */
function getActiveKey() {
  const keys = config.gemini.apiKeys;
  if (!keys || keys.length === 0) return null;

  const index = config.gemini.activeKeyIndex;
  // Clamp index to valid range
  const safeIndex = (index >= 0 && index < keys.length) ? index : 0;
  return keys[safeIndex];
}

/**
 * Get the current active key index.
 * @returns {number}
 */
function getActiveKeyIndex() {
  const keys = config.gemini.apiKeys;
  if (!keys || keys.length === 0) return 0;
  const index = config.gemini.activeKeyIndex;
  return (index >= 0 && index < keys.length) ? index : 0;
}

/**
 * Get total number of configured API keys.
 * @returns {number}
 */
function getTotalKeys() {
  return (config.gemini.apiKeys || []).length;
}

/**
 * Rotate to the next API key and persist the new index to the database.
 * This is "sticky" — the new key will be used for all future requests.
 * 
 * @param {Error|null} error The error that triggered the rotation (optional).
 * @returns {Promise<{success: boolean, newIndex: number, totalKeys: number}>}
 *   success=false means we've cycled through ALL keys (full cycle).
 */
async function rotateToNextKey(error = null) {
  checkAndInitStatuses();
  const keys = config.gemini.apiKeys;
  if (!keys || keys.length <= 1) {
    if (keys && keys.length === 1 && error) {
      // Mark the single key status appropriately
      let status = 'Invalid/Expired';
      const statusNum = error.status || error.httpCode;
      if (statusNum === 429 || error.message?.toLowerCase().includes('quota') || error.message?.toLowerCase().includes('rate limit') || error.message?.toLowerCase().includes('resource_exhausted')) {
        status = 'Rate Limited / 429';
      }
      setKeyStatus(0, status);
    }
    return { success: false, newIndex: 0, totalKeys: keys ? keys.length : 0 };
  }

  const currentIndex = getActiveKeyIndex();

  // Set the status of the current key that failed
  if (error) {
    let status = 'Invalid/Expired';
    const statusNum = error.status || error.httpCode;
    if (statusNum === 429 || error.message?.toLowerCase().includes('quota') || error.message?.toLowerCase().includes('rate limit') || error.message?.toLowerCase().includes('resource_exhausted')) {
      status = 'Rate Limited / 429';
    }
    setKeyStatus(currentIndex, status);
  }

  const nextIndex = (currentIndex + 1) % keys.length;

  // Update in-memory config immediately
  config.gemini.activeKeyIndex = nextIndex;

  // Persist to database so it survives restarts
  try {
    await updateConfigInDb('gemini_active_key_index', String(nextIndex));
  } catch (err) {
    console.error('[KeyManager] Failed to persist key index to DB:', err.message);
  }

  const maskedKey = maskKey(keys[nextIndex]);
  console.log(`[KeyManager] 🔄 Rotated to API Key #${nextIndex + 1}/${keys.length} (${maskedKey})`);

  if (ioInstance) {
    ioInstance.emit('gemini_key_rotation', {
      activeIndex: nextIndex,
      totalKeys: keys.length,
      keys: keys.map((key, index) => ({
        index,
        masked: maskKey(key),
        isActive: index === nextIndex,
        status: getKeyStatus(index)
      }))
    });
  }

  // If we've wrapped back to the start, all keys have been tried
  const fullCycle = nextIndex === 0;
  if (fullCycle) {
    console.warn('[KeyManager] ⚠️ Full cycle completed — all keys have been tried. Wrapping back to Key #1.');
  }

  return { success: !fullCycle, newIndex: nextIndex, totalKeys: keys.length };
}

/**
 * Check if an error indicates the API key is exhausted/invalid
 * and should trigger a key rotation.
 * 
 * These errors mean the KEY itself is the problem (quota, auth, disabled).
 * Server errors (503, 500) are NOT key problems and should NOT trigger rotation.
 * 
 * @param {Error} error 
 * @returns {boolean}
 */
function isKeyExhaustedError(error) {
  const status = error.status || error.httpCode;
  const msg = error.message || '';

  // HTTP 429 — Rate limit / quota exhausted
  if (status === 429) return true;
  // HTTP 403 — Permission denied / key disabled
  if (status === 403) return true;
  // HTTP 401 — Unauthenticated / invalid key
  if (status === 401) return true;

  // Check error message patterns
  const exhaustionPatterns = [
    'RESOURCE_EXHAUSTED',
    'quota',
    'rate limit',
    'PERMISSION_DENIED',
    'API key not valid',
    'API key expired',
    'API_KEY_INVALID',
    'forbidden',
  ];

  return exhaustionPatterns.some(pattern => 
    msg.toLowerCase().includes(pattern.toLowerCase())
  );
}

/**
 * Mask an API key for safe logging. Shows first 6 and last 4 characters.
 * @param {string} key 
 * @returns {string}
 */
function maskKey(key) {
  if (!key || key.length < 12) return '***';
  return `${key.substring(0, 6)}...${key.substring(key.length - 4)}`;
}

/**
 * Log the current key status on startup.
 */
function logKeyStatus() {
  const keys = config.gemini.apiKeys;
  const total = keys ? keys.length : 0;
  const activeIndex = getActiveKeyIndex();

  if (total === 0) {
    console.warn('[KeyManager] ⚠️ No Gemini API keys configured!');
  } else if (total === 1) {
    console.log(`[KeyManager] 🔑 1 API Key loaded (${maskKey(keys[0])})`);
  } else {
    console.log(`[KeyManager] 🔑 ${total} API Keys loaded. Active: Key #${activeIndex + 1} (${maskKey(keys[activeIndex])})`);
  }
}

module.exports = {
  getActiveKey,
  getActiveKeyIndex,
  getTotalKeys,
  rotateToNextKey,
  isKeyExhaustedError,
  maskKey,
  logKeyStatus,
  setSocketIo,
  getKeyStatus,
  setKeyStatus
};
