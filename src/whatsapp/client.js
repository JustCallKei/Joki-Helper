const makeWASocket = require('@whiskeysockets/baileys').default;
const { useMultiFileAuthState, DisconnectReason, delay, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { config } = require('../config');
const { prisma } = require('../database');
const { getGeminiReply } = require('../ai/gemini');
const { addMessageToSession } = require('../ai/memoryManager');

let sock = null;
let connectionStatus = 'DISCONNECTED';
let ioInstance = null; // Socket.io reference
const cooldowns = new Map(); // Cooldowns for direct messages
const humanTakeover = new Map(); // Tracks timestamp of last admin reply per JID
const processingChats = new Set(); // Tracks active message processing per JID
const processedMessages = new Set(); // Tracks processed message IDs to prevent duplicates
const dailyAutoreplySent = new Map(); // Tracks date when busy-notice was sent per JID
const dailyGreetSent = new Map(); // Tracks date when greeting was sent per JID: JID -> 'YYYY-MM-DD'

// In-memory map of stopped chats: JID -> { stoppedAt, adminReplied, timerHandle }
const stoppedChats = new Map();

// Load stopped chats from DB on startup
async function loadStoppedChatsFromDb() {
  try {
    const rows = await prisma.stoppedChat.findMany();
    for (const row of rows) {
      stoppedChats.set(row.jid, {
        stoppedAt: row.stoppedAt,
        adminReplied: row.adminReplied,
        timerHandle: null // timer tidak dipersist
      });
    }
    console.log(`[StoppedChat] Loaded ${rows.length} stopped chats from DB.`);
  } catch (err) {
    console.error('[StoppedChat] Failed to load from DB:', err.message);
  }
}

// Getter for connection status
function getWAConnectionStatus() {
  return connectionStatus;
}

// Hook Socket.io
function setSocketIo(io) {
  ioInstance = io;
}

// Update Human Takeover state and emit event
function updateHumanTakeover(jid, isMuted) {
  if (isMuted) {
    humanTakeover.set(jid, Date.now());
  } else {
    humanTakeover.delete(jid);
  }
  if (ioInstance) {
    ioInstance.emit('wa_handover_update', {
      jid,
      isMuted,
      timestamp: humanTakeover.get(jid) || null
    });
  }
}

function getHumanTakeoverList() {
  const result = [];
  humanTakeover.forEach((timestamp, jid) => {
    result.push({ jid, timestamp });
  });
  return result;
}

// ─────────────────────────────────────────────
// STOPPED CHATS MANAGEMENT
// ─────────────────────────────────────────────

/**
 * Marks a JID as stopped. Bot will not auto-reply until re-enabled.
 * Starts a 1-hour timer: if admin has not replied → send apology message.
 */
async function setStoppedChat(jid, isStopped) {
  if (isStopped) {
    const timerHandle = setTimeout(async () => {
      const entry = stoppedChats.get(jid);
      if (!entry || entry.adminReplied) return; // Admin already replied, no apology needed
      // Send apology message
      try {
        if (sock && connectionStatus === 'CONNECTED') {
          const apologyText =
            'Mohon maaf, Admin kami sedang slow response saat ini. ' +
            'Kami akan segera merespons pesan Anda. Terima kasih atas kesabaran Anda! 🙏\n\n_(Bot)_';
          await sock.sendMessage(jid, { text: apologyText });
          console.log(`[StoppedChat] Sent apology to ${jid} after 1-hour timeout.`);
        }
      } catch (err) {
        console.error('[StoppedChat] Failed to send apology:', err.message);
      }
      // Keep chat stopped after apology — admin must re-enable from dashboard
    }, 60 * 60 * 1000); // 1 hour

    stoppedChats.set(jid, { stoppedAt: new Date(), adminReplied: false, timerHandle });

    // Persist to DB
    try {
      await prisma.stoppedChat.upsert({
        where: { jid },
        create: { jid, stoppedAt: new Date(), adminReplied: false },
        update: { stoppedAt: new Date(), adminReplied: false }
      });
    } catch (err) {
      console.error('[StoppedChat] DB upsert failed:', err.message);
    }

    if (ioInstance) ioInstance.emit('wa_stopped_update', { jid, isStopped: true });
    console.log(`[StoppedChat] Chat stopped for ${jid}.`);
  } else {
    // Re-enable bot for this JID
    const entry = stoppedChats.get(jid);
    if (entry?.timerHandle) clearTimeout(entry.timerHandle);
    stoppedChats.delete(jid);

    try {
      await prisma.stoppedChat.deleteMany({ where: { jid } });
    } catch (err) {
      console.error('[StoppedChat] DB delete failed:', err.message);
    }

    if (ioInstance) ioInstance.emit('wa_stopped_update', { jid, isStopped: false });
    console.log(`[StoppedChat] Bot re-enabled for ${jid}.`);
  }
}

function getStoppedChatList() {
  const result = [];
  stoppedChats.forEach((data, jid) => {
    result.push({ jid, stoppedAt: data.stoppedAt, adminReplied: data.adminReplied });
  });
  return result;
}

// ─────────────────────────────────────────────
// GROUP LIST
// ─────────────────────────────────────────────

/**
 * Fetches all groups the connected WA number participates in.
 * Returns an array of { jid, name, participantCount }.
 */
async function getGroupList() {
  if (!sock || connectionStatus !== 'CONNECTED') return [];
  try {
    const groups = await sock.groupFetchAllParticipating();
    return Object.values(groups).map(g => ({
      jid: g.id,
      name: g.subject || g.id,
      participantCount: g.participants?.length || 0
    }));
  } catch (err) {
    console.error('[WA] Failed to fetch groups:', err.message);
    return [];
  }
}

// ─────────────────────────────────────────────
// BROADCAST
// ─────────────────────────────────────────────

/**
 * Sends an array of messages to an array of group JIDs with a short delay between each.
 */
async function sendToGroups(groupJids, messages) {
  if (!sock || connectionStatus !== 'CONNECTED') {
    console.warn('[Broadcast] Cannot send — WhatsApp not connected.');
    return { sent: 0, failed: groupJids.length };
  }

  let sent = 0;
  let failed = 0;

  for (const jid of groupJids) {
    for (const text of messages) {
      try {
        await sock.sendMessage(jid, { text });
        sent++;
        await delay(1200); // small delay between sends to avoid ban
      } catch (err) {
        console.error(`[Broadcast] Failed to send to ${jid}:`, err.message);
        failed++;
      }
    }
    await delay(800); // gap between groups
  }

  console.log(`[Broadcast] Done. Sent: ${sent}, Failed: ${failed}`);
  return { sent, failed };
}

/**
 * Initializes and connects to WhatsApp.
 */
async function connectToWhatsApp() {
  console.log('Connecting to WhatsApp...');
  connectionStatus = 'CONNECTING';
  if (ioInstance) ioInstance.emit('wa_status', { status: 'CONNECTING' });

  const authFolder = path.join(process.cwd(), 'auth_info_baileys');
  const { state, saveCreds } = await useMultiFileAuthState(authFolder);

  // Fetch the latest WhatsApp Web version to prevent 405 Method Not Allowed error
  let version = [2, 3000, 1017025828]; // Updated stable fallback version
  try {
    const latestVersion = await fetchLatestBaileysVersion();
    if (latestVersion && latestVersion.version) {
      version = latestVersion.version;
      console.log(`Using latest WhatsApp Web version: ${version.join('.')}`);
    }
  } catch (err) {
    console.warn('Failed to fetch latest WhatsApp version, using fallback:', err.message);
  }

  sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: true,
    logger: pino({ level: 'silent' })
  });

  // Handle credentials update
  sock.ev.on('creds.update', saveCreds);

  // Handle connection updates (QR code, status, errors)
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('WhatsApp QR Code generated.');
      try {
        const qrDataUrl = await QRCode.toDataURL(qr);
        connectionStatus = 'WAITING_QR';
        if (ioInstance) {
          ioInstance.emit('wa_status', { status: 'WAITING_QR', qr: qrDataUrl });
        }
      } catch (err) {
        console.error('Error generating QR Data URL:', err.message);
      }
    }

    if (connection === 'close') {
      const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('WhatsApp connection closed. Reconnecting:', shouldReconnect, 'Error:', lastDisconnect?.error);

      connectionStatus = 'DISCONNECTED';
      if (ioInstance) ioInstance.emit('wa_status', { status: 'DISCONNECTED' });

      if (shouldReconnect) {
        setTimeout(connectToWhatsApp, 5000);
      } else {
        console.log('Session logged out. Clearing credentials folder...');
        try {
          fs.rmSync(authFolder, { recursive: true, force: true });
        } catch (err) {
          console.error('Failed to clear session folder:', err.message);
        }
        setTimeout(connectToWhatsApp, 3000);
      }
    } else if (connection === 'open') {
      console.log('WhatsApp connected successfully!');
      connectionStatus = 'CONNECTED';
      if (ioInstance) {
        const myNumber = sock.user.id.split(':')[0];
        ioInstance.emit('wa_status', {
          status: 'CONNECTED',
          phone: myNumber,
          name: sock.user.name
        });
      }
      // Load stopped chats from DB after connection
      await loadStoppedChatsFromDb();
    }
  });

  // Handle incoming messages
  sock.ev.on('messages.upsert', async (m) => {
    const msg = m.messages[0];
    if (!msg.message) return;

    const from = msg.key.remoteJid;
    const isGroup = from.endsWith('@g.us');
    const isPersonal = from.endsWith('@s.whatsapp.net') || from.endsWith('@lid');
    const senderName = msg.pushName || 'Pelanggan';

    // Get text content of the message
    const messageText = msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      msg.message.imageMessage?.caption ||
      msg.message.videoMessage?.caption ||
      '';

    // ─────────────────────────────────────────────
    // HANDLE fromMe — Admin sent the message
    // ─────────────────────────────────────────────
    if (msg.key.fromMe) {
      if (messageText.includes('_(Bot)_')) return; // Ignore bot's own messages

      if (isPersonal && messageText) {
        const textLower = messageText.trim().toLowerCase();

        if (textLower === '.bot on') {
          updateHumanTakeover(from, false);
          // Also re-enable if it was stopped
          if (stoppedChats.has(from)) {
            await setStoppedChat(from, false);
          }
          console.log(`[WA Handover] Bot re-enabled manually for ${from}`);
          await sock.sendMessage(from, { text: '🤖 Auto-reply diaktifkan untuk chat ini.' });
        } else if (textLower === '.bot off') {
          updateHumanTakeover(from, true);
          console.log(`[WA Handover] Bot disabled manually for ${from}`);
          await sock.sendMessage(from, { text: '🤖 Auto-reply dimatikan untuk chat ini.' });
        } else if (!messageText.startsWith('.')) {
          // Normal admin reply
          // Check if this is a reply to a stopped chat — mark adminReplied = true, cancel timer
          if (stoppedChats.has(from)) {
            const entry = stoppedChats.get(from);
            if (entry?.timerHandle) clearTimeout(entry.timerHandle);
            entry.adminReplied = true;
            entry.timerHandle = null;
            stoppedChats.set(from, entry);
            // Update DB
            try {
              await prisma.stoppedChat.update({
                where: { jid: from },
                data: { adminReplied: true }
              });
            } catch (_) {}
            console.log(`[StoppedChat] Admin replied to stopped chat ${from}, 1-hour apology cancelled.`);
          }

          // Normal Human Takeover mute — 15 min
          updateHumanTakeover(from, true);
          console.log(`[WA Handover] Admin replied to ${from}, muting bot for 15 minutes.`);
          try {
            await addMessageToSession(from, 'model', messageText);
          } catch (memErr) {
            console.error('[MemoryManager] Failed to save admin WA reply to session:', memErr.message);
          }
        }
      }
      return;
    }

    if (!messageText) return;

    // Log all incoming messages for debugging
    console.log(`[WA Debug] Received message from ${senderName} (${from}): ${messageText}`);

    // ─────────────────────────────────────────────
    // CHECK: Is this chat stopped by user keyword?
    // ─────────────────────────────────────────────
    if (isPersonal && stoppedChats.has(from)) {
      console.log(`[StoppedChat] Bot stopped for ${from}, skipping reply.`);
      return;
    }

    // ─────────────────────────────────────────────
    // HUMAN HANDOVER: Check if bot is muted for this customer
    // ─────────────────────────────────────────────
    if (isPersonal && humanTakeover.has(from)) {
      const lastAdminReply = humanTakeover.get(from);
      const muteDuration = 15 * 60 * 1000; // 15 minutes
      if (Date.now() - lastAdminReply < muteDuration) {
        console.log(`[WA Handover] Bot muted for ${from}, skipping reply.`);
        return;
      } else {
        updateHumanTakeover(from, false);
        console.log(`[WA Handover] 15 minutes passed, bot resumed for ${from}`);
      }
    }

    // ─────────────────────────────────────────────
    // BRIDGE REPLY: Admin replying from WA to Discord ticket
    // ─────────────────────────────────────────────
    if (isPersonal && messageText.startsWith('.r ')) {
      const parts = messageText.substring(3).trim().split(' ');
      const targetChanName = parts[0];
      const replyContent = parts.slice(1).join(' ');

      if (targetChanName && replyContent) {
        console.log(`[WA Bridge] Forwarding reply to Discord. Channel: ${targetChanName}`);

        const ticket = await prisma.ticket.findFirst({
          where: {
            OR: [
              { id: targetChanName },
              { discordChanId: targetChanName }
            ]
          }
        });

        if (ticket) {
          const { discordClient } = require('../discord/client');
          const channel = await discordClient.channels.fetch(ticket.discordChanId).catch(() => null);

          if (channel) {
            await channel.send(`💬 **[WA Admin]**: ${replyContent}`);

            await prisma.message.create({
              data: {
                ticketId: ticket.id,
                senderId: 'WA_ADMIN',
                senderName: senderName,
                content: replyContent,
                source: 'WHATSAPP'
              }
            });

            await sock.sendMessage(from, { text: `✅ Berhasil dikirim ke Discord ticket!` });
            return;
          }
        }
        await sock.sendMessage(from, { text: `❌ Gagal mengirim. Tiket dengan ID atau nama "${targetChanName}" tidak ditemukan.` });
        return;
      }
    }

    // ─────────────────────────────────────────────
    // STOP KEYWORD DETECTION
    // ─────────────────────────────────────────────
    if (isPersonal && /stop/i.test(messageText)) {
      console.log(`[StoppedChat] User ${from} sent "stop" keyword. Stopping bot replies.`);
      await setStoppedChat(from, true);
      // Send acknowledgment
      await sock.sendMessage(from, {
        text: 'Baik, bot kami akan berhenti merespons sementara. Admin kami akan segera menghubungi Anda. _(Bot)_'
      });
      return;
    }

    // ─────────────────────────────────────────────
    // HELPER AUTO-REPLY: Customer DMing the personal WA number
    // ─────────────────────────────────────────────
    if (isPersonal && config.whatsapp.autoreply) {
      const msgId = msg.key.id;
      if (processedMessages.has(msgId)) {
        console.log(`[WA Autoreply] Message ${msgId} already processed, skipping.`);
        return;
      }

      const cooldownKey = `wa-${from}`;
      const now = Date.now();

      if (cooldowns.has(cooldownKey) && (now - cooldowns.get(cooldownKey) < 3000)) {
        console.log(`[WA Autoreply] Skipped due to cooldown (spam prevention): ${from}`);
        return;
      }

      if (processingChats.has(from)) {
        console.log(`[WA Autoreply] Already processing message for ${from}, skipping concurrent event.`);
        return;
      }

      cooldowns.set(cooldownKey, now);
      processingChats.add(from);
      processedMessages.add(msgId);

      if (processedMessages.size > 1000) {
        const firstKey = processedMessages.values().next().value;
        processedMessages.delete(firstKey);
      }

      console.log(`[WA Autoreply] Processing query from ${senderName}: ${messageText}`);

      try {
        try {
          await addMessageToSession(from, 'user', messageText);
        } catch (memErr) {
          console.error('[MemoryManager] Failed to save WA customer message to session:', memErr.message);
        }

        // Simulated typing delay
        try {
          await sock.sendPresenceUpdate('composing', from);
          const randomDelay = Math.floor(Math.random() * 4000) + 2000;
          await delay(randomDelay);
          await sock.sendPresenceUpdate('paused', from);
        } catch (presenceErr) {
          console.warn(`[WA Warn] Failed to send presence update: ${presenceErr.message}`);
        }

        // Get Gemini reply
        const response = await getGeminiReply(
          [{ role: 'user', content: messageText }],
          true, from, from, 'WHATSAPP'
        );

        const trimmedResponse = response ? response.trim() : '';
        if (!trimmedResponse) throw new Error('AI returned an empty response text.');

        // ── Format new reply ──
        const today = new Date().toISOString().split('T')[0];

        // Check if first greeting today
        const lastGreet = dailyGreetSent.get(from);
        const isFirstToday = (lastGreet !== today);

        let finalResponse = '';

        if (isFirstToday) {
          // First message of the day — prepend greeting
          finalResponse =
            `Halo ${senderName}! 👋 Ada yang bisa kami bantu?\n\n` +
            `${trimmedResponse}\n\n` +
            `_Ini adalah balasan otomatis dari Bot, Admin kami akan membalas sesegera mungkin._\n\n` +
            `_(Bot)_`;
          dailyGreetSent.set(from, today);
        } else {
          finalResponse = `${trimmedResponse}\n\n_(Bot)_`;
        }

        await sock.sendMessage(from, { text: finalResponse });

      } catch (err) {
        console.error('Error generating WA auto-reply:', err.message);

        // Fallback message
        const today = new Date().toISOString().split('T')[0];
        const isFirstToday = (dailyGreetSent.get(from) !== today);
        let fallbackMsg = '';

        if (isFirstToday) {
          fallbackMsg =
            `Halo ${senderName}! 👋 Ada yang bisa kami bantu?\n\n` +
            `Mohon maaf, sistem kami sedang mengalami gangguan sementara. Admin akan segera merespons pesan Anda.\n\n` +
            `_Ini adalah balasan otomatis dari Bot, Admin kami akan membalas sesegera mungkin._\n\n` +
            `_(Bot)_`;
          dailyGreetSent.set(from, today);
        } else {
          fallbackMsg =
            `Mohon maaf, sistem kami sedang mengalami gangguan sementara. Admin akan segera merespons pesan Anda.\n\n_(Bot)_`;
        }

        try {
          await sock.sendMessage(from, { text: fallbackMsg });
        } catch (sendErr) {
          console.error('Error sending fallback message:', sendErr.message);
        }
      } finally {
        processingChats.delete(from);
      }
    }
  });
}

/**
 * Sends a message to a WhatsApp number.
 */
async function sendWhatsAppMessage(jid, text) {
  if (!sock || connectionStatus !== 'CONNECTED') {
    console.warn('[WA Client] Cannot send message, WhatsApp not connected.');
    return false;
  }
  try {
    await sock.sendMessage(jid, { text });
    return true;
  } catch (error) {
    console.error('Error sending WhatsApp message:', error);
    return false;
  }
}

/**
 * Clean disconnect WhatsApp.
 */
async function disconnectWhatsApp() {
  if (sock) {
    try {
      await sock.logout();
      sock = null;
    } catch (e) {}
  }
}

function getOwnJid() {
  return sock?.user?.id;
}

module.exports = {
  connectToWhatsApp,
  getWAConnectionStatus,
  setSocketIo,
  sendWhatsAppMessage,
  disconnectWhatsApp,
  getOwnJid,
  getHumanTakeoverList,
  setHumanTakeover: updateHumanTakeover,
  // New exports
  getGroupList,
  getStoppedChatList,
  setStoppedChat,
  sendToGroups
};
