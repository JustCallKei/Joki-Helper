const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { config, loadConfigFromDb, updateConfigInDb } = require('./config');
const { prisma } = require('./database');
const { startDiscordBot, setWhatsAppBridgeCallback } = require('./discord/client');
const {
  connectToWhatsApp,
  getWAConnectionStatus,
  setSocketIo,
  sendWhatsAppMessage,
  disconnectWhatsApp,
  getHumanTakeoverList,
  setHumanTakeover,
  getGroupList,
  getStoppedChatList,
  setStoppedChat
} = require('./whatsapp/client');
const {
  startBroadcastJob,
  stopBroadcastJob,
  stopAllJobs,
  resumeRunningJobs
} = require('./whatsapp/broadcastManager');
const { calculateJockeyPrice } = require('./utils/jockeyCalculator');
const { retryWithBackoff } = require('./utils/apiRetry');
const {
  backupDatabaseToCloud,
  restoreDatabaseFromCloud,
  initBackupScheduler
} = require('./utils/cloudBackup');
const {
  getActiveKey,
  getActiveKeyIndex,
  getTotalKeys,
  rotateToNextKey,
  isKeyExhaustedError,
  maskKey,
  logKeyStatus,
  setSocketIo: setGeminiSocketIo,
  getKeyStatus,
  setKeyStatus
} = require('./utils/geminiKeyManager');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Initialize upload directory
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Set up multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadsDir);
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, 'qris' + ext);
  }
});
const upload = multer({ storage: storage });

app.use(express.json());
// Serve dashboard static files
app.use(express.static(path.join(__dirname, 'public')));

// Store live logs in memory to stream to dashboard
const logQueue = [];
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;

function addLogToQueue(type, ...args) {
  const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
  const logEntry = {
    timestamp: new Date().toLocaleTimeString(),
    type,
    message
  };
  logQueue.push(logEntry);
  if (logQueue.length > 50) logQueue.shift(); // Limit to 50 logs
  io.emit('server_log', logEntry);
}

function shouldFilterOut(args) {
  const msg = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ');
  return msg.includes('Failed to decrypt message with any known session') || msg.includes('Bad MAC');
}

// Override console logs to pipe into the dashboard console
console.log = (...args) => {
  if (shouldFilterOut(args)) return;
  originalConsoleLog.apply(console, args);
  addLogToQueue('info', ...args);
};
console.error = (...args) => {
  if (shouldFilterOut(args)) return;
  originalConsoleError.apply(console, args);
  addLogToQueue('error', ...args);
};
console.warn = (...args) => {
  if (shouldFilterOut(args)) return;
  originalConsoleWarn.apply(console, args);
  addLogToQueue('warning', ...args);
};

// ----------------------------------------------------
// Express API Endpoints
// ----------------------------------------------------

// Get Bot & System status
app.get('/api/status', async (req, res) => {
  const waStatus = getWAConnectionStatus();

  // Check if discord client is ready
  const { discordClient } = require('./discord/client');
  const discordStatus = discordClient.isReady() ? 'CONNECTED' : 'DISCONNECTED';
  const discordUser = discordClient.isReady() ? discordClient.user.tag : null;

  res.json({
    discord: {
      status: discordStatus,
      tag: discordUser,
      guildId: config.discord.guildId,
      ticketCategoryId: config.discord.ticketCategoryId,
      adminRoleId: config.discord.adminRoleId,
      staffChannelId: config.discord.staffChannelId,
      jokiStatusChannelId: config.discord.jokiStatusChannelId,
      closedTicketRoleId: config.discordClosedTicketRoleId
    },
    whatsapp: {
      status: waStatus,
      autoreply: config.whatsapp.autoreply,
      autoreplyText: config.whatsapp.autoreplyText
    },
    gemini: {
      hasKey: getTotalKeys() > 0,
      totalKeys: getTotalKeys(),
      activeKeyIndex: getActiveKeyIndex(),
      model: config.gemini.model
    },
    ai: {
      globalAiEnabled: config.globalAiEnabled
    },
    texts: {
      ticketWelcomeTitle: config.ticketWelcomeTitle,
      ticketWelcomeDesc: config.ticketWelcomeDesc,
      ticketGreetingText: config.ticketGreetingText,
      ticketConnectAdminText: config.ticketConnectAdminText,
      ticketCloseText: config.ticketCloseText,
      botLanguageStyle: config.botLanguageStyle,
      nameKasar: config.nameKasar,
      nameSoftspoken: config.nameSoftspoken,
      nameTsundere: config.nameTsundere,
      nameTengil: config.nameTengil,
      nameSombong: config.nameSombong,
      nameCustom: config.nameCustom,
      promptKasar: config.promptKasar,
      promptSoftspoken: config.promptSoftspoken,
      promptTsundere: config.promptTsundere,
      promptTengil: config.promptTengil,
      promptSombong: config.promptSombong,
      promptCustom: config.promptCustom
    }
  });
});

// WA Handover / Mute Control Endpoints
app.get('/api/whatsapp/muted', (req, res) => {
  res.json({ muted: getHumanTakeoverList() });
});

app.post('/api/whatsapp/toggle-mute', (req, res) => {
  const { jid, isMuted } = req.body;
  if (!jid) return res.status(400).json({ error: 'JID required' });

  setHumanTakeover(jid, isMuted);
  res.json({ success: true, jid, isMuted });
});

// ──────────────────────────────────────
// WA Groups Endpoint
// ──────────────────────────────────────

// GET /api/whatsapp/groups — Fetch all joined WA groups
app.get('/api/whatsapp/groups', async (req, res) => {
  try {
    const groups = await getGroupList();
    res.json({ groups });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────
// Stopped Chats Endpoints
// ──────────────────────────────────────

// GET /api/whatsapp/stopped — List stopped chats
app.get('/api/whatsapp/stopped', (req, res) => {
  res.json({ stopped: getStoppedChatList() });
});

// POST /api/whatsapp/stopped — Toggle stopped status for a JID
app.post('/api/whatsapp/stopped', async (req, res) => {
  const { jid, isStopped } = req.body;
  if (!jid) return res.status(400).json({ error: 'JID required' });
  try {
    await setStoppedChat(jid, isStopped);
    res.json({ success: true, jid, isStopped });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────
// Broadcast Preset Endpoints
// ──────────────────────────────────────

// GET /api/broadcast/presets — List all presets
app.get('/api/broadcast/presets', async (req, res) => {
  try {
    const presets = await prisma.broadcastPreset.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ presets });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/broadcast/presets — Create or update a preset
app.post('/api/broadcast/presets', async (req, res) => {
  const { id, name, messages } = req.body;
  if (!name || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'name and messages[] are required.' });
  }
  const messagesStr = JSON.stringify(messages.filter(m => m && m.trim()));
  try {
    let preset;
    if (id) {
      preset = await prisma.broadcastPreset.update({
        where: { id },
        data: { name, messages: messagesStr }
      });
    } else {
      preset = await prisma.broadcastPreset.upsert({
        where: { name },
        create: { name, messages: messagesStr },
        update: { messages: messagesStr }
      });
    }
    res.json({ success: true, preset });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/broadcast/presets/:id — Delete a preset
app.delete('/api/broadcast/presets/:id', async (req, res) => {
  try {
    await prisma.broadcastPreset.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────
// Broadcast Job Endpoints
// ──────────────────────────────────────

// GET /api/broadcast/jobs — List all jobs
app.get('/api/broadcast/jobs', async (req, res) => {
  try {
    const jobs = await prisma.broadcastJob.findMany({ orderBy: { createdAt: 'desc' } });
    res.json({ jobs });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/broadcast/jobs — Create and start a new broadcast job
app.post('/api/broadcast/jobs', async (req, res) => {
  const { messages, targetGroups, intervalMs, presetId } = req.body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages[] is required.' });
  }
  if (!Array.isArray(targetGroups) || targetGroups.length === 0) {
    return res.status(400).json({ error: 'targetGroups[] is required.' });
  }
  const interval = parseInt(intervalMs, 10);
  if (!interval || interval < 60000) {
    return res.status(400).json({ error: 'intervalMs must be at least 60000 (1 minute).' });
  }
  try {
    const job = await prisma.broadcastJob.create({
      data: {
        messages: JSON.stringify(messages),
        targetGroups: JSON.stringify(targetGroups),
        intervalMs: interval,
        presetId: presetId || null,
        status: 'RUNNING'
      }
    });
    await startBroadcastJob(job.id);
    res.json({ success: true, job });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// PUT /api/broadcast/jobs/:id/stop — Stop a running job
app.put('/api/broadcast/jobs/:id/stop', async (req, res) => {
  try {
    await stopBroadcastJob(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/broadcast/jobs/:id — Delete a job
app.delete('/api/broadcast/jobs/:id', async (req, res) => {
  try {
    await stopBroadcastJob(req.params.id); // stop first if running
    await prisma.broadcastJob.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update configurations
app.post('/api/config', async (req, res) => {
  const {
    discord_token,
    discord_guild_id,
    discord_ticket_category_id,
    discord_admin_role_id,
    discord_staff_channel_id,
    whatsapp_autoreply,
    whatsapp_autoreply_text,
    gemini_api_key,
    gemini_model,
    ticket_welcome_title,
    ticket_welcome_desc,
    ticket_greeting_text,
    ticket_connect_admin_text,
    ticket_close_text,
    global_ai_enabled,
    discord_closed_ticket_role_id,
    discord_joki_status_channel_id,
    bot_language_style,
    name_kasar,
    name_softspoken,
    name_tsundere,
    name_tengil,
    name_sombong,
    name_custom,
    prompt_kasar,
    prompt_softspoken,
    prompt_tsundere,
    prompt_tengil,
    prompt_sombong,
    prompt_custom
  } = req.body;

  try {
    if (discord_token !== undefined) await updateConfigInDb('discord_token', discord_token);
    if (discord_guild_id !== undefined) await updateConfigInDb('discord_guild_id', discord_guild_id);
    if (discord_ticket_category_id !== undefined) await updateConfigInDb('discord_ticket_category_id', discord_ticket_category_id);
    if (discord_admin_role_id !== undefined) await updateConfigInDb('discord_admin_role_id', discord_admin_role_id);
    if (discord_staff_channel_id !== undefined) await updateConfigInDb('discord_staff_channel_id', discord_staff_channel_id);
    if (whatsapp_autoreply !== undefined) await updateConfigInDb('whatsapp_autoreply', whatsapp_autoreply ? 'true' : 'false');
    if (whatsapp_autoreply_text !== undefined) await updateConfigInDb('whatsapp_autoreply_text', whatsapp_autoreply_text);
    if (gemini_api_key !== undefined) await updateConfigInDb('gemini_api_key', gemini_api_key);
    if (gemini_model !== undefined) await updateConfigInDb('gemini_model', gemini_model);
    if (ticket_welcome_title !== undefined) await updateConfigInDb('ticket_welcome_title', ticket_welcome_title);
    if (ticket_welcome_desc !== undefined) await updateConfigInDb('ticket_welcome_desc', ticket_welcome_desc);
    if (ticket_greeting_text !== undefined) await updateConfigInDb('ticket_greeting_text', ticket_greeting_text);
    if (ticket_connect_admin_text !== undefined) await updateConfigInDb('ticket_connect_admin_text', ticket_connect_admin_text);
    if (ticket_close_text !== undefined) await updateConfigInDb('ticket_close_text', ticket_close_text);
    if (global_ai_enabled !== undefined) await updateConfigInDb('global_ai_enabled', global_ai_enabled ? 'true' : 'false');
    if (discord_closed_ticket_role_id !== undefined) await updateConfigInDb('discord_closed_ticket_role_id', discord_closed_ticket_role_id);
    if (discord_joki_status_channel_id !== undefined) await updateConfigInDb('discord_joki_status_channel_id', discord_joki_status_channel_id);
    if (bot_language_style !== undefined) await updateConfigInDb('bot_language_style', bot_language_style);

    if (name_kasar !== undefined) await updateConfigInDb('name_kasar', name_kasar);
    if (name_softspoken !== undefined) await updateConfigInDb('name_softspoken', name_softspoken);
    if (name_tsundere !== undefined) await updateConfigInDb('name_tsundere', name_tsundere);
    if (name_tengil !== undefined) await updateConfigInDb('name_tengil', name_tengil);
    if (name_sombong !== undefined) await updateConfigInDb('name_sombong', name_sombong);
    if (name_custom !== undefined) await updateConfigInDb('name_custom', name_custom);

    if (prompt_kasar !== undefined) await updateConfigInDb('prompt_kasar', prompt_kasar);
    if (prompt_softspoken !== undefined) await updateConfigInDb('prompt_softspoken', prompt_softspoken);
    if (prompt_tsundere !== undefined) await updateConfigInDb('prompt_tsundere', prompt_tsundere);
    if (prompt_tengil !== undefined) await updateConfigInDb('prompt_tengil', prompt_tengil);
    if (prompt_sombong !== undefined) await updateConfigInDb('prompt_sombong', prompt_sombong);
    if (prompt_custom !== undefined) await updateConfigInDb('prompt_custom', prompt_custom);

    res.json({ success: true, message: 'Configuration updated successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get Joki Pricelist items
app.get('/api/pricelist', async (req, res) => {
  try {
    const items = await prisma.priceItem.findMany();
    const formatted = items.map(item => ({
      id: item.id,
      name: item.name,
      type: item.type,
      basePrice: item.basePrice,
      requirements: JSON.parse(item.requirements || '[]'),
      description: item.description
    }));
    res.json(formatted);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Add or edit price item
app.post('/api/pricelist', async (req, res) => {
  const { id, name, type, basePrice, requirements, description } = req.body;
  try {
    const reqStr = Array.isArray(requirements)
      ? JSON.stringify(requirements)
      : JSON.stringify(String(requirements).split(',').map(r => r.trim()).filter(Boolean));

    const price = parseFloat(basePrice);

    if (id) {
      // Edit
      await prisma.priceItem.update({
        where: { id },
        data: { name, type, basePrice: price, requirements: reqStr, description }
      });
    } else {
      // Add new
      await prisma.priceItem.create({
        data: { name, type, basePrice: price, requirements: reqStr, description }
      });
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete price item
app.delete('/api/pricelist/:id', async (req, res) => {
  try {
    await prisma.priceItem.delete({
      where: { id: req.params.id }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete all price items
app.delete('/api/pricelist', async (req, res) => {
  try {
    await prisma.priceItem.deleteMany({});
    res.json({ success: true, message: 'All price items deleted successfully.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Analyze pricelist text using Gemini AI
app.post('/api/pricelist/analyze-ai', async (req, res) => {
  const { text } = req.body;
  if (!text) {
    return res.status(400).json({ error: 'Text content is required' });
  }

  if (!config.gemini.apiKey) {
    return res.status(400).json({ error: 'API Key Gemini belum di-setting bro di dashboard. Minta admin pasang dulu gih.' });
  }

  try {
    // Load local Blox Fruit Knowledge Base
    const kbPath = path.join(__dirname, 'ai', 'blox_fruit_kb.json');
    let bloxFruitKb = {};
    try {
      bloxFruitKb = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
    } catch (err) {
      console.error('Error loading blox_fruit_kb.json for import-ai:', err.message);
    }

    const modelName = config.gemini.model || 'gemini-2.5-flash';

    const schema = {
      type: "ARRAY",
      description: "List of parsed jockey services from the text block",
      items: {
        type: "OBJECT",
        properties: {
          name: { type: "STRING", description: "The name of the service/item, e.g. '100 Level (Sea 2/3)', 'CDK All Scroll', 'Soul Guitar (No Bahan)'" },
          type: {
            type: "STRING",
            enum: ["LEVELING", "ITEM", "RAID", "AWAKENING", "OTHER"],
            description: "The type of service. LEVELING for level/belly/mastery/train. ITEM for getting items/swords/guns/materials. RAID for raids/frag. AWAKENING for fruit awakenings. OTHER for cyborg/ghoul/pull lever/dough king/etc."
          },
          basePrice: { type: "INTEGER", description: "The price of the service in IDR (convert k to thousands, e.g. 3k = 3000, 10k = 10000, 1 JT = 1000000)" },
          requirements: {
            type: "ARRAY",
            items: { type: "STRING" },
            description: "List of requirements, including level requirements (e.g. Level 2200+ for CDK, Level 2300+ for Soul Guitar, Level 1500+ for Godhuman/Sanguine Art/Shark Anchor, Level 1100+ for raids) based on the Blox Fruits Wiki context, plus any specific materials or quest requirements."
          },
          description: { type: "STRING", description: "A brief description of the service/item in Indonesian" }
        },
        required: ["name", "type", "basePrice", "requirements"]
      }
    };

    const prompt = `
    Analyze and parse the following Blox Fruits jockey service pricelist text.
    Use the Blox Fruits Wiki/Knowledge Base Context to determine appropriate level requirements (e.g., Level 1500+, 2200+, 2300+, 1100+, etc.) and other constraints for each item and add them to the "requirements" array.
    
    Wiki/Knowledge Base Context:
    ${JSON.stringify(bloxFruitKb, null, 2)}
    
    Pricelist text to parse:
    """
    ${text}
    """
    `;

    const callGemini = async (apiKey, activeModelName) => {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({
        model: activeModelName,
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: schema
        }
      });
      return await model.generateContent(prompt);
    };

    // Key rotation loop for pricelist analysis
    const totalKeys = getTotalKeys();
    let result;
    let analysisError;

    for (let keyAttempt = 0; keyAttempt < totalKeys; keyAttempt++) {
      const currentKey = getActiveKey();
      const currentKeyIdx = getActiveKeyIndex();

      try {
        result = await retryWithBackoff(() => callGemini(currentKey, modelName));
        analysisError = null;
        break;
      } catch (primaryError) {
        if (isKeyExhaustedError(primaryError) && totalKeys > 1) {
          console.warn(`[Pricelist AI] \u26a0\ufe0f Key #${currentKeyIdx + 1} exhausted: ${primaryError.message}`);
          const rotation = await rotateToNextKey();
          if (!rotation.success && keyAttempt > 0) {
            analysisError = primaryError;
            break;
          }
          continue;
        }

        const fallbackModel = 'gemini-2.0-flash';
        if (modelName !== fallbackModel) {
          console.warn(`[Gemini API] Primary model ${modelName} failed. Falling back to ${fallbackModel}... Error:`, primaryError.message);
          try {
            result = await retryWithBackoff(() => callGemini(currentKey, fallbackModel));
            analysisError = null;
            break;
          } catch (fallbackError) {
            if (isKeyExhaustedError(fallbackError) && totalKeys > 1) {
              const rotation = await rotateToNextKey();
              if (!rotation.success && keyAttempt > 0) {
                analysisError = fallbackError;
                break;
              }
              continue;
            }
            throw fallbackError;
          }
        } else {
          throw primaryError;
        }
      }
    }

    if (analysisError) {
      throw analysisError;
    }

    const parsedText = result.response.text();
    const parsedData = JSON.parse(parsedText);
    res.json({ success: true, items: parsedData });
  } catch (error) {
    console.error('Gemini parsing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk upsert pricelist items
app.post('/api/pricelist/bulk', async (req, res) => {
  const { items } = req.body;
  if (!items || !Array.isArray(items)) {
    return res.status(400).json({ error: 'Items array is required' });
  }

  try {
    const results = [];
    for (const item of items) {
      if (!item.name || !item.type || item.basePrice === undefined) continue;

      const reqStr = Array.isArray(item.requirements)
        ? JSON.stringify(item.requirements)
        : JSON.stringify(String(item.requirements).split(',').map(r => r.trim()).filter(Boolean));

      const price = parseFloat(item.basePrice);

      const result = await prisma.priceItem.upsert({
        where: { name: item.name },
        update: {
          type: item.type,
          basePrice: price,
          requirements: reqStr,
          description: item.description || ''
        },
        create: {
          name: item.name,
          type: item.type,
          basePrice: price,
          requirements: reqStr,
          description: item.description || ''
        }
      });
      results.push(result);
    }
    res.json({ success: true, count: results.length });
  } catch (error) {
    console.error('Bulk insert error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Run test calculation
app.post('/api/calculator', async (req, res) => {
  const { currentLevel, targetLevel, items, options } = req.body;
  try {
    const result = await calculateJockeyPrice(
      parseInt(currentLevel, 10),
      targetLevel ? parseInt(targetLevel, 10) : null,
      items || [],
      options || {}
    );
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Get active ticket rooms
app.get('/api/tickets', async (req, res) => {
  try {
    const tickets = await prisma.ticket.findMany({
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });
    res.json(tickets);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update status or worker
app.put('/api/tickets/:id', async (req, res) => {
  try {
    const updated = await prisma.ticket.update({
      where: { id: req.params.id },
      data: req.body
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==========================================
// ORDERS & QRIS API
// ==========================================

// Get all Joki Orders
app.get('/api/orders', async (req, res) => {
  try {
    const orders = await prisma.jokiOrder.findMany({
      orderBy: { createdAt: 'desc' }
    });
    res.json(orders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update Joki Order
app.put('/api/orders/:id', async (req, res) => {
  try {
    const updated = await prisma.jokiOrder.update({
      where: { id: req.params.id },
      data: req.body
    });
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete Joki Order
app.delete('/api/orders/:id', async (req, res) => {
  try {
    await prisma.jokiOrder.delete({
      where: { id: req.params.id }
    });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Upload QRIS Image
app.post('/api/upload-qris', upload.single('qrisImage'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const filePath = path.join('src', 'public', 'uploads', req.file.filename);
    await updateConfigInDb('qris_image_path', filePath);
    res.json({ success: true, path: filePath });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Control bot running state
app.post('/api/control', async (req, res) => {
  const { action, service } = req.body; // action: restart/stop, service: discord/whatsapp
  try {
    if (service === 'discord') {
      const { discordClient } = require('./discord/client');
      if (action === 'restart') {
        discordClient.destroy();
        startDiscordBot();
        res.json({ success: true, message: 'Discord Bot restarted.' });
      } else if (action === 'stop') {
        discordClient.destroy();
        res.json({ success: true, message: 'Discord Bot stopped.' });
      }
    } else if (service === 'whatsapp') {
      if (action === 'restart') {
        await disconnectWhatsApp();
        connectToWhatsApp();
        res.json({ success: true, message: 'WhatsApp connection restarting.' });
      } else if (action === 'stop') {
        await disconnectWhatsApp();
        res.json({ success: true, message: 'WhatsApp connection stopped.' });
      }
    } else {
      res.status(400).json({ error: 'Unknown service' });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// Google Workspace Cloud Sync Endpoints
// ----------------------------------------------------

// GET /api/backup/status — Fetch Google backup metadata status
app.get('/api/backup/status', async (req, res) => {
  try {
    const rows = await prisma.config.findMany({
      where: {
        key: {
          in: [
            'google_backup_status',
            'google_backup_email',
            'google_backup_last_sync',
            'google_backup_size',
            'google_backup_error'
          ]
        }
      }
    });

    const backupConfig = {};
    rows.forEach(row => {
      backupConfig[row.key] = row.value;
    });

    res.json({
      status: backupConfig['google_backup_status'] || 'Disconnected',
      email: backupConfig['google_backup_email'] || 'Not Connected',
      lastSync: backupConfig['google_backup_last_sync'] || '-',
      size: backupConfig['google_backup_size'] || '-',
      error: backupConfig['google_backup_error'] || ''
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/backup/trigger — Manually trigger a database backup
app.post('/api/backup/trigger', async (req, res) => {
  try {
    const result = await backupDatabaseToCloud();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/backup/restore — Manually trigger a database restore
app.post('/api/backup/restore', async (req, res) => {
  try {
    const result = await restoreDatabaseFromCloud();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// Gemini API Key Management Endpoints
// ----------------------------------------------------

// GET /api/gemini-keys — List all keys (masked) with active status and tracking status
app.get('/api/gemini-keys', (req, res) => {
  const keys = config.gemini.apiKeys || [];
  const activeIndex = getActiveKeyIndex();
  res.json({
    total: keys.length,
    activeIndex,
    keys: keys.map((key, index) => ({
      index,
      masked: maskKey(key),
      isActive: index === activeIndex,
      status: getKeyStatus(index)
    }))
  });
});

// POST /api/gemini-keys — Add a new key
app.post('/api/gemini-keys', async (req, res) => {
  const { key } = req.body;
  if (!key || !key.trim()) {
    return res.status(400).json({ error: 'API key tidak boleh kosong.' });
  }

  const trimmedKey = key.trim();
  const keys = config.gemini.apiKeys || [];

  // Check for duplicate
  if (keys.includes(trimmedKey)) {
    return res.status(400).json({ error: 'Key ini sudah terdaftar.' });
  }

  keys.push(trimmedKey);
  const keysStr = keys.join(',');

  try {
    await updateConfigInDb('gemini_api_key', keysStr);
    res.json({ success: true, message: `Key berhasil ditambahkan. Total: ${keys.length} key.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST /api/gemini-keys/test — Test a key's connection
app.post('/api/gemini-keys/test', async (req, res) => {
  const { index } = req.body;
  const keys = config.gemini.apiKeys || [];

  if (index < 0 || index >= keys.length) {
    return res.status(400).json({ error: 'Index key tidak valid.' });
  }

  const key = keys[index];
  try {
    const genAI = new GoogleGenerativeAI(key);
    const modelName = config.gemini.model || 'gemini-2.5-flash';
    const model = genAI.getGenerativeModel({ model: modelName });

    // Call generateContent with extremely small tokens as a lightweight sanity check
    await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'Hello' }] }],
      generationConfig: { maxOutputTokens: 5 }
    });

    setKeyStatus(index, 'Active');
    res.json({ success: true, status: 'Active' });
  } catch (error) {
    console.error(`[KeyManager] ❌ Test Connection failed for key #${index + 1}:`, error.message);

    let status = 'Invalid/Expired';
    const statusNum = error.status || error.httpCode;
    if (statusNum === 429 || error.message?.toLowerCase().includes('quota') || error.message?.toLowerCase().includes('rate limit') || error.message?.toLowerCase().includes('resource_exhausted')) {
      status = 'Rate Limited / 429';
    }

    setKeyStatus(index, status);
    res.status(500).json({ success: false, status, error: error.message });
  }
});

// PUT /api/gemini-keys/active — Set active key by index
app.put('/api/gemini-keys/active', async (req, res) => {
  const { index } = req.body;
  const keys = config.gemini.apiKeys || [];

  if (index < 0 || index >= keys.length) {
    return res.status(400).json({ error: 'Index key tidak valid.' });
  }

  try {
    config.gemini.activeKeyIndex = index;
    await updateConfigInDb('gemini_active_key_index', String(index));
    res.json({ success: true, message: `Key #${index + 1} sekarang aktif.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// DELETE /api/gemini-keys/:index — Remove a key by index
app.delete('/api/gemini-keys/:index', async (req, res) => {
  const index = parseInt(req.params.index, 10);
  const keys = config.gemini.apiKeys || [];

  if (isNaN(index) || index < 0 || index >= keys.length) {
    return res.status(400).json({ error: 'Index key tidak valid.' });
  }

  keys.splice(index, 1);
  const keysStr = keys.join(',');

  try {
    await updateConfigInDb('gemini_api_key', keysStr || '');

    // Adjust active key index if needed
    const activeIndex = getActiveKeyIndex();
    if (keys.length === 0) {
      config.gemini.activeKeyIndex = 0;
      await updateConfigInDb('gemini_active_key_index', '0');
    } else if (activeIndex >= keys.length) {
      config.gemini.activeKeyIndex = 0;
      await updateConfigInDb('gemini_active_key_index', '0');
    }

    res.json({ success: true, message: `Key #${index + 1} berhasil dihapus.` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ----------------------------------------------------
// Socket.io Real-time connections
// ----------------------------------------------------
io.on('connection', (socket) => {
  // Sync current WA status immediately
  const waStatus = getWAConnectionStatus();
  socket.emit('wa_status', { status: waStatus });

  // Send existing logs
  logQueue.forEach(log => socket.emit('server_log', log));

  socket.on('disconnect', () => { });
});

// Set Socket.io in WA module
setSocketIo(io);
setGeminiSocketIo(io);

// ----------------------------------------------------
// WhatsApp Bridge Callback Setup
// ----------------------------------------------------
// When a Discord user chats in a ticket, forward it to the Admin's WA (saved messages)
setWhatsAppBridgeCallback(async (ticket, senderName, content) => {
  const waStatus = getWAConnectionStatus();
  if (waStatus !== 'CONNECTED') return;

  try {
    // We send it to the logged-in admin's own JID (Self message notification)
    const { getOwnJid } = require('./whatsapp/client');
    const myJid = getOwnJid();

    // In Baileys, we can retrieve own number from sock.user.id
    if (myJid) {
      const [idPart, domainPart] = myJid.split('@');
      const cleanId = idPart.split(':')[0];
      const targetJid = `${cleanId}@${domainPart || 's.whatsapp.net'}`;

      const bridgeMsg = `🔔 **[Discord Ticket]**\n` +
        `👤 **User**: ${senderName}\n` +
        `🆔 **Ticket ID**: ${ticket.discordChanId}\n` +
        `💬 **Pesan**: "${content}"\n\n` +
        `Balas ketik: \`.r ${ticket.discordChanId} [pesan]\``;

      await sendWhatsAppMessage(targetJid, bridgeMsg);
    }
  } catch (error) {
    originalConsoleError('Failed to send WA bridge alert:', error.message);
  }
});

// ----------------------------------------------------
// Main Startup Flow
// ----------------------------------------------------
const PORT = config.port;

async function bootstrap() {
  // 1. Load configuration from DB
  await loadConfigFromDb();

  // 2. Log API key status
  logKeyStatus();

  // 3. Start servers
  server.listen(PORT, () => {
    originalConsoleLog(`Helper Mia service active on http://localhost:${PORT}`);
  });

  // 4. Start bots
  startDiscordBot();
  connectToWhatsApp();

  // 5. Initialize Google Cloud Backup scheduler
  initBackupScheduler();

  // 6. Resume any broadcast jobs that were running before shutdown
  await resumeRunningJobs();
}

bootstrap().catch(err => {
  originalConsoleError('Critical service failure on startup:', err);
});

// Graceful Shutdown Handler to release port 3000 and close active connections
const gracefulShutdown = async (signal) => {
  originalConsoleLog(`\n[Shutdown] Received ${signal}. Starting graceful shutdown...`);

  // Close Express HTTP server
  if (server && server.listening) {
    await new Promise((resolve) => {
      server.close(() => {
        originalConsoleLog('[Shutdown] Express server stopped.');
        resolve();
      });
    });
  }

  // Destroy Discord bot client if ready
  try {
    const { discordClient } = require('./discord/client');
    if (discordClient && discordClient.isReady()) {
      discordClient.destroy();
      originalConsoleLog('[Shutdown] Discord Bot connection destroyed.');
    }
  } catch (e) {
    originalConsoleError('[Shutdown] Error destroying Discord bot:', e.message);
  }

  // Stop all broadcast jobs
  try {
    stopAllJobs();
    originalConsoleLog('[Shutdown] All broadcast jobs stopped.');
  } catch (e) {}

  // Close WhatsApp connection
  try {
    const { disconnectWhatsApp } = require('./whatsapp/client');
    await disconnectWhatsApp();
    originalConsoleLog('[Shutdown] WhatsApp connection closed.');
  } catch (e) { }

  // Close Prisma connection
  try {
    await prisma.$disconnect();
    originalConsoleLog('[Shutdown] Database connection disconnected.');
  } catch (e) { }

  originalConsoleLog('[Shutdown] Shutdown complete. Exiting.');
  process.exit(0);
};

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.once('SIGUSR2', () => gracefulShutdown('SIGUSR2'));

