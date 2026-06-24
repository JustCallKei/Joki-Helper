const { prisma } = require('../database');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { getActiveKey } = require('../utils/geminiKeyManager');
const { retryWithBackoff } = require('../utils/apiRetry');

// --- Configuration ---
const MAX_BUFFER_SIZE = 10;   // Maximum messages kept in the rolling buffer
const KEEP_RECENT = 4;        // Messages to keep verbatim after a compaction

/**
 * Retrieves or creates a ChatSession from the database.
 */
async function getSession(sessionId) {
  let session = await prisma.chatSession.findUnique({ where: { sessionId } });
  if (!session) {
    session = await prisma.chatSession.create({
      data: { sessionId, summary: '', buffer: '[]' }
    });
  }
  return {
    sessionId: session.sessionId,
    summary: session.summary || '',
    buffer: safeParseBuffer(session.buffer)
  };
}

/**
 * Returns the session context (summary + buffer messages) for use in AI prompts.
 */
async function getSessionContext(sessionId) {
  return getSession(sessionId);
}

/**
 * Adds a message to the session's rolling buffer.
 * If the buffer exceeds MAX_BUFFER_SIZE, triggers a compaction:
 *   - The oldest messages are summarised together with the existing summary.
 *   - Only KEEP_RECENT messages remain in the buffer.
 */
async function addMessageToSession(sessionId, role, content) {
  const session = await getSession(sessionId);
  const buffer = session.buffer;

  buffer.push({
    role,
    content,
    createdAt: new Date().toISOString()
  });

  // Check if compaction is needed
  if (buffer.length > MAX_BUFFER_SIZE) {
    const messagesToSummarise = buffer.slice(0, buffer.length - KEEP_RECENT);
    const remainingBuffer = buffer.slice(buffer.length - KEEP_RECENT);

    // Generate updated rolling summary in the background (non-blocking for the caller)
    let newSummary = session.summary;
    try {
      newSummary = await generateRollingSummary(session.summary, messagesToSummarise);
    } catch (err) {
      console.error('[MemoryManager] Failed to generate rolling summary:', err.message);
      // Fallback: keep old summary and just drop the oldest messages
    }

    await prisma.chatSession.update({
      where: { sessionId },
      data: {
        summary: newSummary,
        buffer: JSON.stringify(remainingBuffer)
      }
    });

    return;
  }

  // No compaction needed, just save the updated buffer
  await prisma.chatSession.update({
    where: { sessionId },
    data: {
      buffer: JSON.stringify(buffer)
    }
  });
}

/**
 * Uses Gemini to compress older messages + existing summary into a new rolling summary.
 * The summary captures: joki type, price, account details, agreements, prerequisites, etc.
 */
async function generateRollingSummary(oldSummary, messagesToSummarise) {
  const apiKey = getActiveKey();
  if (!apiKey) {
    console.warn('[MemoryManager] No API key available for summary generation, keeping old summary.');
    return oldSummary;
  }

  const conversationText = messagesToSummarise.map(m => {
    const label = m.role === 'user' ? 'Customer' : 'Bot/Admin';
    return `${label}: ${m.content}`;
  }).join('\n');

  const prompt = `Kamu adalah sistem ringkasan percakapan joki game Blox Fruit.

RINGKASAN SEBELUMNYA:
${oldSummary || '(belum ada)'}

PERCAKAPAN BARU YANG HARUS DIRINGKAS:
${conversationText}

INSTRUKSI:
Gabungkan ringkasan sebelumnya dengan percakapan baru di atas menjadi SATU ringkasan singkat dan padat. Ringkasan harus mencakup:
- Nama/jenis joki yang dipesan (jika ada)
- Harga yang sudah disepakati (jika ada)
- Status akun customer (level, gear, mastery, item yang dimiliki)
- Syarat/prerequisite yang sudah/belum terpenuhi
- Kesepakatan penting (deal, pembayaran, dll)
- Info identitas customer (username Roblox, dll) jika disebutkan

ATURAN:
- Tulis dalam bahasa Indonesia singkat, poin-poin saja.
- Maksimal 300 kata.
- Jangan menambahkan info yang tidak ada di percakapan.
- Jika tidak ada info baru yang penting, kembalikan ringkasan sebelumnya apa adanya.`;

  const { config } = require('../config');
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: config.gemini.model || 'gemini-1.5-flash' }); // Use configured model or fast fallback

  const result = await retryWithBackoff(async () => {
    const response = await model.generateContent(prompt);
    return response.response.text();
  });

  console.log(`[MemoryManager] Rolling summary updated for session. Summary length: ${result.length} chars`);
  return result.trim();
}

/**
 * Safely parses the buffer JSON string. Returns empty array on failure.
 */
function safeParseBuffer(bufferStr) {
  try {
    const parsed = JSON.parse(bufferStr || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

module.exports = {
  getSessionContext,
  addMessageToSession,
  getSession
};
