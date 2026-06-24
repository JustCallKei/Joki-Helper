const exploitKeywords = [
  'ignore previous',
  'ignore all instructions',
  'system override',
  'kamu sekarang adalah',
  'ubah harga',
  'bypass pricing',
  'gratis',
  'free joki',
  'joki gratis',
  'harga 0',
  'price to 0',
  'override pricing',
  'set price to',
  'developer mode',
  'cheat',
  'exploit'
];

/**
 * Sanitizes input text, removing malicious characters or tags.
 */
function sanitizeInput(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '') // Remove scripts
    .replace(/<\/?[^>]+(>|$)/g, '')                   // Strip HTML
    .trim();
}

/**
 * Checks if a chat message contains potential prompt injection or exploits.
 */
function isExploitAttempt(text) {
  if (!text) return false;
  const lowercaseText = text.toLowerCase();
  
  for (const keyword of exploitKeywords) {
    if (lowercaseText.includes(keyword)) {
      return true;
    }
  }
  return false;
}

/**
 * Validates Blox Fruit level input. Max level is 2550.
 */
function validateLevel(levelInput) {
  const level = parseInt(levelInput, 10);
  if (isNaN(level)) {
    throw new Error('level_invalid');
  }
  if (level < 1 || level > 2550) {
    throw new Error('level_out_of_bounds');
  }
  return level;
}

module.exports = {
  sanitizeInput,
  isExploitAttempt,
  validateLevel
};
