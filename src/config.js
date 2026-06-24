const { prisma } = require('./database');

function parseBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

function parseIntSafe(value, fallback = 0) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function splitKeys(value) {
  return String(value || '')
    .split(/[\n,;]+/)
    .map(key => key.trim())
    .filter(Boolean);
}

const config = {
  port: parseIntSafe(process.env.PORT, 3000),
  discord: {
    token: process.env.DISCORD_TOKEN || '',
    guildId: process.env.DISCORD_GUILD_ID || '',
    ticketCategoryId: process.env.DISCORD_TICKET_CATEGORY_ID || '',
    adminRoleId: process.env.DISCORD_ADMIN_ROLE_ID || '',
    staffChannelId: process.env.DISCORD_STAFF_CHANNEL_ID || '',
    jokiStatusChannelId: process.env.DISCORD_JOKI_STATUS_CHANNEL_ID || ''
  },
  whatsapp: {
    autoreply: parseBool(process.env.WHATSAPP_AUTOREPLY, true),
    autoreplyText: process.env.WHATSAPP_AUTOREPLY_TEXT || 'Halo bro! Sorry banget, admin lagi sibuk/slow respon nih. Tapi santai aja, gue Mia yang bakal bantuin lo. Ada yang bisa gue bantu soal syarat joki atau harga?'
  },
  gemini: {
    apiKey: process.env.GEMINI_API_KEY || '',
    apiKeys: splitKeys(process.env.GEMINI_API_KEY || ''),
    activeKeyIndex: parseIntSafe(process.env.GEMINI_ACTIVE_KEY_INDEX, 0),
    model: process.env.GEMINI_MODEL || 'gemini-1.5-flash'
  },
  globalAiEnabled: parseBool(process.env.GLOBAL_AI_ENABLED, true),
  qrisImagePath: process.env.QRIS_IMAGE_PATH || '',
  discordClosedTicketRoleId: process.env.DISCORD_CLOSED_TICKET_ROLE_ID || '',
  ticketWelcomeTitle: '✨ TIKET JOKI BERHASIL DIBUKA ✨',
  ticketWelcomeDesc: 'Halo {username}! Tiket joki kamu sudah dibuka. Jelaskan kebutuhan joki kamu sedetail mungkin ya.',
  ticketGreetingText: 'Yo <@{userId}>! Gua Mia, helper joki Blox Fruit di sini. Ada kebutuhan joki apa nih atau ada yang bisa gua bantu buat info game? Spil aja lah bro!',
  ticketConnectAdminText: 'Mohon segera membalas <@&{adminRoleId}>',
  ticketCloseText: 'Tiket joki kamu telah ditutup oleh {closedBy}. Makasih banyak sudah order jasa joki di Mia!',
  botLanguageStyle: 'kasar',
  nameKasar: 'Mia',
  nameSoftspoken: 'Mia',
  nameTsundere: 'Mia',
  nameTengil: 'Mia',
  nameSombong: 'Mia',
  nameCustom: 'Mia',
  promptKasar: '',
  promptSoftspoken: '',
  promptTsundere: '',
  promptTengil: '',
  promptSombong: '',
  promptCustom: ''
};

const keyMap = {
  discord_token: ['discord', 'token'],
  discord_guild_id: ['discord', 'guildId'],
  discord_ticket_category_id: ['discord', 'ticketCategoryId'],
  discord_admin_role_id: ['discord', 'adminRoleId'],
  discord_staff_channel_id: ['discord', 'staffChannelId'],
  discord_joki_status_channel_id: ['discord', 'jokiStatusChannelId'],
  discord_closed_ticket_role_id: ['discordClosedTicketRoleId'],
  whatsapp_autoreply: ['whatsapp', 'autoreply'],
  whatsapp_autoreply_text: ['whatsapp', 'autoreplyText'],
  gemini_api_key: ['gemini', 'apiKey'],
  gemini_model: ['gemini', 'model'],
  gemini_active_key_index: ['gemini', 'activeKeyIndex'],
  qris_image_path: ['qrisImagePath'],
  global_ai_enabled: ['globalAiEnabled'],
  ticket_welcome_title: ['ticketWelcomeTitle'],
  ticket_welcome_desc: ['ticketWelcomeDesc'],
  ticket_greeting_text: ['ticketGreetingText'],
  ticket_connect_admin_text: ['ticketConnectAdminText'],
  ticket_close_text: ['ticketCloseText'],
  bot_language_style: ['botLanguageStyle'],
  name_kasar: ['nameKasar'],
  name_softspoken: ['nameSoftspoken'],
  name_tsundere: ['nameTsundere'],
  name_tengil: ['nameTengil'],
  name_sombong: ['nameSombong'],
  name_custom: ['nameCustom'],
  prompt_kasar: ['promptKasar'],
  prompt_softspoken: ['promptSoftspoken'],
  prompt_tsundere: ['promptTsundere'],
  prompt_tengil: ['promptTengil'],
  prompt_sombong: ['promptSombong'],
  prompt_custom: ['promptCustom']
};

function setByPath(pathParts, value) {
  let target = config;
  for (let i = 0; i < pathParts.length - 1; i++) target = target[pathParts[i]];
  const leaf = pathParts[pathParts.length - 1];

  if (leaf === 'autoreply' || leaf === 'globalAiEnabled') {
    target[leaf] = parseBool(value, target[leaf]);
  } else if (leaf === 'activeKeyIndex') {
    target[leaf] = parseIntSafe(value, 0);
  } else {
    target[leaf] = value ?? '';
  }

  if (pathParts[0] === 'gemini' && leaf === 'apiKey') {
    config.gemini.apiKeys = splitKeys(target[leaf]);
    config.gemini.apiKey = config.gemini.apiKeys[0] || '';
    if (config.gemini.activeKeyIndex >= config.gemini.apiKeys.length) config.gemini.activeKeyIndex = 0;
  }
}

async function loadConfigFromDb() {
  const rows = await prisma.config.findMany();
  for (const row of rows) {
    const pathParts = keyMap[row.key];
    if (pathParts) setByPath(pathParts, row.value);
  }
  return config;
}

async function updateConfigInDb(key, value) {
  const stringValue = value === undefined || value === null ? '' : String(value);
  await prisma.config.upsert({
    where: { key },
    update: { value: stringValue },
    create: { key, value: stringValue }
  });
  const pathParts = keyMap[key];
  if (pathParts) setByPath(pathParts, stringValue);
  return config;
}

module.exports = { config, loadConfigFromDb, updateConfigInDb };
