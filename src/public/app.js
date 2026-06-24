// ============================================
// Helper Mia — Dashboard Frontend JavaScript
// ============================================

const socket = io();

// ============================================
// Navigation Tab Switching
// ============================================
const navItems = document.querySelectorAll('.nav-item');
const tabContents = document.querySelectorAll('.tab-content');
const pageTitle = document.getElementById('page-title');

const tabTitles = {
  overview: 'Overview',
  control: 'Bot Control',
  apikeys: 'API Key Manager',
  config: 'Config & Teks Bot',
  whatsapp: 'WhatsApp Pairing',
  tickets: 'Tickets Monitor',
  pricelist: 'Price Manager',
  calculator: 'Calculator Playground',
  orders: 'Order Manager',
  broadcast: 'Broadcast Otomatis',
  logs: 'Live Console'
};

// Switch tabs
navItems.forEach(btn => {
  btn.addEventListener('click', () => {
    navItems.forEach(b => b.classList.remove('active'));
    tabContents.forEach(tc => tc.classList.remove('active'));

    btn.classList.add('active');
    const tabId = btn.getAttribute('data-tab');
    const target = document.getElementById(`tab-${tabId}`);
    if (target) {
      target.classList.add('active');
      document.getElementById('page-title').textContent = btn.textContent.trim();

      // Auto load data based on tab
      if (tabId === 'tickets') loadTickets();
      if (tabId === 'pricelist') loadPricelist(); // changed loadPriceItems to loadPricelist
      if (tabId === 'config') loadStatus();
      if (tabId === 'apikeys') loadApiKeys();
      if (tabId === 'orders') loadOrders();
      if (tabId === 'control') {
        loadMutedChats();
        loadStoppedChats();
        loadBackupStatus();
      }
      if (tabId === 'broadcast') {
        loadBroadcastPresets();
        loadBroadcastJobs();
      }
    }
  });
});

// Header Clock
setInterval(() => {
  document.getElementById('time-display').textContent = new Date().toLocaleTimeString();
}, 1000);

// ============================================
// Toast Notifications
// ============================================
function showToast(message, type = 'success') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icon = type === 'success' ? 'check-circle' : type === 'error' ? 'x-circle' : 'alert-triangle';
  toast.innerHTML = `<i data-lucide="${icon}"></i> ${message}`;
  document.body.appendChild(toast);
  lucide.createIcons();
  setTimeout(() => toast.remove(), 3200);
}

// ============================================
// WebSocket Event Listeners
// ============================================
const logTerminal = document.getElementById('log-terminal');

socket.on('server_log', (log) => {
  const line = document.createElement('div');
  line.className = `log-line ${log.type}`;
  line.textContent = `[${log.timestamp}] ${log.message}`;
  logTerminal.appendChild(line);
  logTerminal.scrollTop = logTerminal.scrollHeight;
});

// Gemini Key Rotation socket listener
socket.on('gemini_key_rotation', (data) => {
  console.log('[Socket] Gemini key rotated:', data);
  updateKeyListRealTime(data.keys, data.activeIndex);

  // Update AI engine indicators on Overview tab
  const activeLabel = document.getElementById('gemini-active-key');
  if (activeLabel) activeLabel.textContent = `#${data.activeIndex + 1}`;
});

// Gemini Key Status Update socket listener
socket.on('gemini_key_status_update', (data) => {
  console.log('[Socket] Gemini key status update:', data);
  loadApiKeys();
  loadStatus();
});

function clearLogs() {
  logTerminal.innerHTML = '<div class="log-line info">[System] Log screen cleared.</div>';
}

// WhatsApp Connection State
socket.on('wa_status', (data) => {
  const badge = document.getElementById('wa-badge');
  const waBadgeDot = document.getElementById('wa-badge-dot');
  const qrLoading = document.getElementById('qr-loading');
  const qrDisconnected = document.getElementById('qr-disconnected');
  const qrConnected = document.getElementById('qr-connected');
  const qrImage = document.getElementById('qr-image');
  const qrFrameContainer = document.getElementById('qr-frame-container');
  const waConnectedInfo = document.getElementById('wa-connected-info');
  const waPhoneText = document.getElementById('wa-phone-text');
  const waNameText = document.getElementById('wa-name-text');
  const ctrlWaStatus = document.getElementById('ctrl-wa-status');

  if (data.status !== 'WAITING_QR') {
    qrImage.classList.add('hidden');
    qrFrameContainer.classList.remove('scanning');
  }

  if (data.status === 'CONNECTED') {
    badge.textContent = 'Connected';
    badge.className = 'text-sm text-success';
    waBadgeDot.className = 'indicator online';
    qrLoading.classList.add('hidden');
    qrDisconnected.classList.add('hidden');
    qrConnected.classList.remove('hidden');
    waConnectedInfo.textContent = `${data.name || '-'} | ${data.phone || '-'}`;
    waPhoneText.textContent = data.phone || '-';
    if (waNameText) waNameText.textContent = data.name || '-';
    ctrlWaStatus.textContent = 'Connected';
  } else if (data.status === 'WAITING_QR') {
    badge.textContent = 'Scan QR';
    badge.className = 'text-sm text-warning';
    waBadgeDot.className = 'indicator warning';
    qrLoading.classList.add('hidden');
    qrDisconnected.classList.add('hidden');
    qrConnected.classList.add('hidden');
    qrImage.src = data.qr;
    qrImage.classList.remove('hidden');
    qrFrameContainer.classList.add('scanning');
    waPhoneText.textContent = '-';
    if (waNameText) waNameText.textContent = '-';
    ctrlWaStatus.textContent = 'Waiting QR';
  } else if (data.status === 'CONNECTING') {
    badge.textContent = 'Connecting';
    badge.className = 'text-sm text-warning';
    waBadgeDot.className = 'indicator warning';
    qrLoading.classList.remove('hidden');
    qrDisconnected.classList.add('hidden');
    qrConnected.classList.add('hidden');
    waPhoneText.textContent = '-';
    if (waNameText) waNameText.textContent = '-';
    ctrlWaStatus.textContent = 'Connecting...';
  } else {
    badge.textContent = 'Disconnected';
    badge.className = 'text-sm text-error';
    waBadgeDot.className = 'indicator offline';
    qrLoading.classList.add('hidden');
    qrDisconnected.classList.remove('hidden');
    qrConnected.classList.add('hidden');
    waPhoneText.textContent = '-';
    if (waNameText) waNameText.textContent = '-';
    ctrlWaStatus.textContent = 'Disconnected';
  }
});

// ============================================
// API: Load Status & Config
// ============================================
let personaCache = {};

async function loadStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    // Discord
    const dBadge = document.getElementById('discord-badge');
    const dBadgeDot = document.getElementById('discord-badge-dot');
    dBadge.textContent = data.discord.status;
    dBadge.className = `text-sm text-${data.discord.status === 'CONNECTED' ? 'success' : 'error'}`;
    dBadgeDot.className = `indicator ${data.discord.status === 'CONNECTED' ? 'online' : 'offline'}`;
    document.getElementById('discord-tag').textContent = data.discord.tag || '-';
    if (document.getElementById('discord-guild-text')) document.getElementById('discord-guild-text').textContent = data.discord.guildId || '-';
    document.getElementById('ctrl-discord-status').textContent = data.discord.status === 'CONNECTED' ? `Connected as ${data.discord.tag}` : 'Disconnected';

    // Gemini
    const gBadge = document.getElementById('gemini-badge');
    gBadge.textContent = data.gemini.hasKey ? 'Active' : 'No Key';
    gBadge.className = `badge badge-${data.gemini.hasKey ? 'success' : 'error'}`;
    document.getElementById('gemini-model-badge').textContent = data.gemini.model || '-';
    document.getElementById('gemini-key-count').textContent = data.gemini.totalKeys || 0;
    document.getElementById('gemini-active-key').textContent = `#${(data.gemini.activeKeyIndex || 0) + 1}`;
    document.getElementById('nav-key-count').textContent = data.gemini.totalKeys || 0;

    // Toggles
    const globalAiToggle = document.getElementById('toggle-global-ai');
    if (data.ai.globalAiEnabled) globalAiToggle.classList.add('active');
    else globalAiToggle.classList.remove('active');

    const waToggle = document.getElementById('toggle-wa-autoreply');
    if (data.whatsapp.autoreply) waToggle.classList.add('active');
    else waToggle.classList.remove('active');

    // Fill config form inputs
    document.getElementById('input-discord-guild').value = data.discord.guildId || '';
    document.getElementById('input-ticket-category').value = data.discord.ticketCategoryId || '';
    document.getElementById('input-admin-role').value = data.discord.adminRoleId || '';
    document.getElementById('input-staff-channel').value = data.discord.staffChannelId || '';
    document.getElementById('input-joki-status-channel').value = data.discord.jokiStatusChannelId || '';
    document.getElementById('input-closed-ticket-role').value = data.discord.closedTicketRoleId || '';
    document.getElementById('input-gemini-model').value = data.gemini.model || 'gemini-2.5-flash';
    document.getElementById('input-autoreply-text').value = data.whatsapp.autoreplyText || '';
    document.getElementById('input-welcome-title').value = data.texts.ticketWelcomeTitle || '';
    document.getElementById('input-connect-admin-text').value = data.texts.ticketConnectAdminText || '';
    document.getElementById('input-welcome-desc').value = data.texts.ticketWelcomeDesc || '';
    document.getElementById('input-greeting-text').value = data.texts.ticketGreetingText || '';
    document.getElementById('input-close-text').value = data.texts.ticketCloseText || '';

    // Language Styles (Moved to Persona Editor)
    personaCache = data.texts || {};
    updateDropdownLabels();
    const presetSelect = document.getElementById('persona-preset');
    if (presetSelect) {
      presetSelect.value = personaCache.botLanguageStyle || 'kasar';
      loadPersonaEditor(presetSelect.value);
    }
    // Load cloud backup status as well
    loadBackupStatus().catch(() => {});
  } catch (err) {
    console.error(err);
    showToast('Gagal memuat status & konfigurasi.', 'error');
  }
}

// ==========================================
// ORDERS MANAGEMENT
// ==========================================

async function loadOrders() {
  try {
    const res = await fetch('/api/orders');
    const orders = await res.json();
    const tbody = document.getElementById('orders-table-body');

    const elTotalOrders = document.getElementById('stat-total-orders');
    if (elTotalOrders) elTotalOrders.textContent = orders.length;

    const totalIncome = orders.filter(o => o.status === 'DONE').reduce((acc, curr) => acc + (curr.price || 0), 0);
    const elIncome = document.getElementById('stat-total-income');
    if (elIncome) elIncome.textContent = 'Rp ' + totalIncome.toLocaleString('id-ID');

    if (orders.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:24px;">Belum ada order joki.</td></tr>';
      return;
    }

    let html = '';
    orders.forEach(order => {
      let statusBadge = '';
      if (order.status === 'PENDING') statusBadge = '<span class="badge badge-warning">PENDING</span>';
      else if (order.status === 'ACCEPTED') statusBadge = '<span class="badge badge-info">ACCEPTED</span>';
      else if (order.status === 'IN_PROGRESS') statusBadge = '<span class="badge badge-primary">IN PROGRESS</span>';
      else if (order.status === 'DONE') statusBadge = '<span class="badge badge-success">DONE</span>';
      else if (order.status === 'CANCELLED') statusBadge = '<span class="badge badge-error">CANCELLED</span>';

      html += `
          <tr>
            <td>
              <strong>${order.id.split('-')[0]}</strong><br>
              <small class="text-muted">${new Date(order.createdAt).toLocaleDateString()}</small>
            </td>
            <td>
              <strong>${order.jokiName}</strong><br>
              <small class="text-muted">${order.detail}</small>
            </td>
            <td>
              B: ${order.buyerName || order.buyerId}<br>
              W: ${order.workerName || order.workerId || '-'}
            </td>
            <td><strong>Rp ${order.price.toLocaleString('id-ID')}</strong></td>
            <td>${statusBadge}</td>
            <td>
              <button onclick="deleteOrder('${order.id}')" class="btn btn-secondary btn-sm" style="color:var(--color-error);"><i data-lucide="trash-2"></i></button>
            </td>
          </tr>
        `;
    });

    tbody.innerHTML = html;
    lucide.createIcons();
  } catch (err) {
    console.error(err);
    document.getElementById('orders-table-body').innerHTML = '<tr><td colspan="6" class="text-center text-error">Gagal memuat order.</td></tr>';
  }
}

async function deleteOrder(id) {
  if (!confirm('Yakin ingin menghapus order ini? Data akan hilang permanen.')) return;
  try {
    const res = await fetch(`/api/orders/${id}`, { method: 'DELETE' });
    if (res.ok) loadOrders();
  } catch (err) {
    alert('Gagal menghapus order');
  }
}

async function uploadQris() {
  const fileInput = document.getElementById('input-qris-file');
  const statusText = document.getElementById('qris-status');

  if (!fileInput.files || fileInput.files.length === 0) {
    statusText.textContent = 'Pilih file dulu!';
    statusText.style.color = 'var(--color-error)';
    return;
  }

  statusText.textContent = 'Mengupload...';
  statusText.style.color = 'var(--color-info)';

  const formData = new FormData();
  formData.append('qrisImage', fileInput.files[0]);

  try {
    const res = await fetch('/api/upload-qris', {
      method: 'POST',
      body: formData
    });
    const data = await res.json();
    if (data.success) {
      statusText.textContent = '✅ QRIS berhasil di-upload!';
      statusText.style.color = 'var(--color-success)';
    } else {
      throw new Error(data.error);
    }
  } catch (err) {
    console.error(err);
    statusText.textContent = '❌ Upload gagal: ' + err.message;
    statusText.style.color = 'var(--color-error)';
  }
}

// ============================================
// API: Save Config
// ============================================
document.getElementById('config-form').addEventListener('submit', async (e) => {
  e.preventDefault();

  const body = {
    discord_guild_id: document.getElementById('input-discord-guild').value,
    discord_ticket_category_id: document.getElementById('input-ticket-category').value,
    discord_admin_role_id: document.getElementById('input-admin-role').value,
    discord_staff_channel_id: document.getElementById('input-staff-channel').value,
    discord_joki_status_channel_id: document.getElementById('input-joki-status-channel').value,
    discord_closed_ticket_role_id: document.getElementById('input-closed-ticket-role').value,
    whatsapp_autoreply_text: document.getElementById('input-autoreply-text').value,
    gemini_model: document.getElementById('input-gemini-model').value,
    ticket_welcome_title: document.getElementById('input-welcome-title').value,
    ticket_connect_admin_text: document.getElementById('input-connect-admin-text').value,
    ticket_welcome_desc: document.getElementById('input-welcome-desc').value,
    ticket_greeting_text: document.getElementById('input-greeting-text').value,
    ticket_close_text: document.getElementById('input-close-text').value
  };

  const token = document.getElementById('input-discord-token').value;
  if (token) body.discord_token = token;

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await res.json();
    if (result.success) {
      showToast('Konfigurasi berhasil disimpan!');
      document.getElementById('input-discord-token').value = '';
      loadStatus();
    } else {
      showToast('Gagal menyimpan: ' + result.error, 'error');
    }
  } catch (err) {
    showToast('Network error, gagal menyimpan.', 'error');
  }
});

// ============================================
// Persona Editor Logic
// ============================================
function updateDropdownLabels() {
  const presetSelect = document.getElementById('persona-preset');
  if (!presetSelect) return;

  const map = {
    kasar: 'nameKasar',
    softspoken: 'nameSoftspoken',
    tsundere: 'nameTsundere',
    tengil: 'nameTengil',
    sombong: 'nameSombong',
    custom: 'nameCustom'
  };

  for (const option of presetSelect.options) {
    if (map[option.value] && personaCache[map[option.value]]) {
      option.text = personaCache[map[option.value]];
    }
  }
}

function loadPersonaEditor(preset) {
  const nameField = document.getElementById('persona-name');
  const promptField = document.getElementById('persona-prompt');

  const map = {
    kasar: { nameKey: 'nameKasar', promptKey: 'promptKasar' },
    softspoken: { nameKey: 'nameSoftspoken', promptKey: 'promptSoftspoken' },
    tsundere: { nameKey: 'nameTsundere', promptKey: 'promptTsundere' },
    tengil: { nameKey: 'nameTengil', promptKey: 'promptTengil' },
    sombong: { nameKey: 'nameSombong', promptKey: 'promptSombong' },
    custom: { nameKey: 'nameCustom', promptKey: 'promptCustom' },
  };

  if (nameField && promptField && map[preset]) {
    nameField.value = personaCache[map[preset].nameKey] || '';
    promptField.value = personaCache[map[preset].promptKey] || '';
    updateDropdownLabels(); // reset any unsaved label modifications
  }
}

const personaPresetEl = document.getElementById('persona-preset');
if (personaPresetEl) {
  personaPresetEl.addEventListener('change', (e) => {
    loadPersonaEditor(e.target.value);
  });
}

const personaNameEl = document.getElementById('persona-name');
if (personaNameEl) {
  personaNameEl.addEventListener('input', (e) => {
    const presetSelect = document.getElementById('persona-preset');
    if (presetSelect && presetSelect.options[presetSelect.selectedIndex]) {
      presetSelect.options[presetSelect.selectedIndex].text = e.target.value || presetSelect.value;
    }
  });
}

const personaFormEl = document.getElementById('persona-form');
if (personaFormEl) {
  personaFormEl.addEventListener('submit', async (e) => {
    e.preventDefault();
    const preset = document.getElementById('persona-preset').value;
    const newName = document.getElementById('persona-name').value;
    const newPrompt = document.getElementById('persona-prompt').value;

    const map = {
      kasar: { n: 'name_kasar', p: 'prompt_kasar' },
      softspoken: { n: 'name_softspoken', p: 'prompt_softspoken' },
      tsundere: { n: 'name_tsundere', p: 'prompt_tsundere' },
      tengil: { n: 'name_tengil', p: 'prompt_tengil' },
      sombong: { n: 'name_sombong', p: 'prompt_sombong' },
      custom: { n: 'name_custom', p: 'prompt_custom' },
    };

    const body = { bot_language_style: preset };
    body[map[preset].n] = newName;
    body[map[preset].p] = newPrompt;

    const btn = document.getElementById('btn-save-persona');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Saving...';
    lucide.createIcons();

    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const result = await res.json();
      if (result.success) {
        showToast('Persona updated and activated!');
        // Update cache so switching back doesn't revert
        const camelNameKey = map[preset].n.replace(/_([a-z])/g, g => g[1].toUpperCase());
        const camelPromptKey = map[preset].p.replace(/_([a-z])/g, g => g[1].toUpperCase());
        personaCache[camelNameKey] = newName;
        personaCache[camelPromptKey] = newPrompt;
        personaCache.botLanguageStyle = preset;
        updateDropdownLabels();
      } else {
        showToast('Failed: ' + result.error, 'error');
      }
    } catch (err) {
      showToast('Network error.', 'error');
    } finally {
      btn.innerHTML = originalHtml;
      lucide.createIcons();
    }
  });
}


// ============================================
// API: Toggle Settings
// ============================================
async function toggleSetting(setting) {
  const el = document.getElementById(`toggle-${setting}`);
  const isActive = el.classList.contains('active');
  const newValue = !isActive;

  const bodyMap = {
    'global-ai': { global_ai_enabled: newValue },
    'wa-autoreply': { whatsapp_autoreply: newValue }
  };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bodyMap[setting])
    });
    const result = await res.json();
    if (result.success) {
      if (newValue) el.classList.add('active');
      else el.classList.remove('active');
      showToast(`${setting === 'global-ai' ? 'AI Autoreply' : 'WA Autoreply'} ${newValue ? 'diaktifkan' : 'dimatikan'}.`);
    }
  } catch (err) {
    showToast('Gagal mengubah setting.', 'error');
  }
}

// ============================================
// API: Bot Service Control & WA Mute
// ============================================
async function controlService(service, action) {
  const confirmed = await showCustomConfirm('Control Service', `Yakin ingin ${action} service ${service}?`, false);
  if (!confirmed) return;
  try {
    const res = await fetch('/api/control', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ service, action })
    });
    const result = await res.json();
    showToast(result.message || result.error, result.message ? 'success' : 'error');
    loadStatus();
  } catch (err) {
    showToast('Gagal memproses control service.', 'error');
  }
}

async function loadMutedChats() {
  try {
    const res = await fetch('/api/whatsapp/muted');
    const data = await res.json();
    renderMutedChats(data.muted || []);
  } catch (err) {
    console.error('Error loading muted chats:', err);
  }
}

function renderMutedChats(mutedList) {
  const tbody = document.getElementById('muted-chats-table-body');
  if (!tbody) return;

  if (mutedList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted" style="padding:16px;">Tidak ada obrolan yang sedang diambil alih.</td></tr>';
    return;
  }

  tbody.innerHTML = mutedList.map(item => {
    const date = new Date(item.timestamp);
    const timeStr = date.toLocaleTimeString('id-ID');
    return `
      <tr>
        <td><strong>${item.jid}</strong></td>
        <td>${timeStr}</td>
        <td>
          <button onclick="toggleMuteChat('${item.jid}', false)" class="btn btn-primary btn-xs">
            <i data-lucide="mic"></i> Resume Bot
          </button>
        </td>
      </tr>
    `;
  }).join('');
  lucide.createIcons();
}

async function toggleMuteChat(jid, isMuted) {
  if (!jid) {
    showToast('JID tidak boleh kosong', 'error');
    return;
  }
  try {
    const res = await fetch('/api/whatsapp/toggle-mute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid, isMuted })
    });
    const result = await res.json();
    if (result.success) {
      showToast(`Bot ${isMuted ? 'dimatikan' : 'diaktifkan'} untuk ${jid}`);
      loadMutedChats();
      if (isMuted) document.getElementById('manual-mute-jid').value = '';
    } else {
      showToast(result.error, 'error');
    }
  } catch (err) {
    showToast('Gagal mengubah status chat.', 'error');
  }
}

function manualToggleMute() {
  const jid = document.getElementById('manual-mute-jid').value.trim();
  if (!jid) return;
  toggleMuteChat(jid, true);
}

socket.on('wa_handover_update', (data) => {
  const controlTab = document.getElementById('tab-control');
  if (controlTab && controlTab.classList.contains('active')) {
    loadMutedChats();
  }
});

socket.on('wa_stopped_update', (data) => {
  const controlTab = document.getElementById('tab-control');
  if (controlTab && controlTab.classList.contains('active')) {
    loadStoppedChats();
  }
});

// ============================================
// API Key Manager
// ============================================
function updateKeyListRealTime(keys, activeIndex) {
  const container = document.getElementById('key-list');
  const badge = document.getElementById('key-total-badge');
  if (!container || !badge) return;

  badge.textContent = `${keys.length} Key${keys.length !== 1 ? 's' : ''}`;
  if (keys.length === 0) {
    container.innerHTML = '<p class="text-muted text-center" style="padding:20px;">Belum ada API key. Tambahkan key baru di bawah.</p>';
    return;
  }

  container.innerHTML = keys.map(k => {
    let statusBadge = '';
    if (k.status === 'Active') {
      statusBadge = '<span class="badge badge-glow-success"><i data-lucide="check-circle-2" style="width:12.5px;height:12.5px;margin-right:4px;"></i>Active</span>';
    } else if (k.status === 'Rate Limited / 429') {
      statusBadge = '<span class="badge badge-glow-warning"><i data-lucide="alert-triangle" style="width:12.5px;height:12.5px;margin-right:4px;"></i>Rate Limited / 429</span>';
    } else {
      statusBadge = '<span class="badge badge-glow-error"><i data-lucide="x-circle" style="width:12.5px;height:12.5px;margin-right:4px;"></i>Invalid/Expired</span>';
    }

    const isActive = k.index === activeIndex;
    return `
      <div class="key-card ${isActive ? 'active' : ''}" id="key-card-${k.index}">
        <div class="key-card-left">
          <div class="key-index">${k.index + 1}</div>
          <span class="key-hash" style="font-weight: 500;">${k.masked}</span>
          <div style="margin-left:12px; display:flex; align-items:center; gap:8px;">
            ${statusBadge}
            ${isActive ? '<span class="badge badge-success badge-active-dot" style="margin-left:4px;">ACTIVE SLOT</span>' : ''}
          </div>
        </div>
        <div class="key-actions">
          <button onclick="testApiKey(${k.index}, this)" class="btn btn-secondary btn-xs"><i data-lucide="activity"></i> Test Connection</button>
          <button onclick="removeApiKey(${k.index})" class="btn btn-danger btn-xs"><i data-lucide="trash-2"></i> Delete</button>
        </div>
      </div>
    `;
  }).join('');
  lucide.createIcons();
}

async function loadApiKeys() {
  try {
    const res = await fetch('/api/gemini-keys');
    const data = await res.json();
    updateKeyListRealTime(data.keys, data.activeIndex);
  } catch (err) {
    console.error('Error loading API keys:', err);
  }
}

async function addApiKey() {
  const input = document.getElementById('input-new-key');
  const key = input.value.trim();

  // Client-side validation: must not be empty, must meet length & prefix requirements
  if (!key) {
    showToast('API Key cannot be empty.', 'warning');
    return;
  }
  if (!key.startsWith('AIzaSy') || key.length < 20) {
    showToast('Invalid Gemini API Key format (normally starts with AIzaSy and is 20+ chars long).', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/gemini-keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key })
    });
    const result = await res.json();
    if (result.success) {
      showToast(result.message);
      input.value = '';
      loadApiKeys();
      loadStatus();
    } else {
      showToast(result.error, 'error');
    }
  } catch (err) {
    showToast('Gagal menambah key.', 'error');
  }
}

async function testApiKey(index, btn) {
  if (!btn) return;
  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Testing...';
  lucide.createIcons();

  try {
    const res = await fetch('/api/gemini-keys/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ index })
    });
    const result = await res.json();
    if (result.success) {
      showToast(`Key #${index + 1} is Active and ready!`, 'success');
    } else {
      showToast(`Key #${index + 1} test failed: ${result.error || 'Check key quota/status'}`, 'error');
    }
    loadApiKeys();
    loadStatus();
  } catch (err) {
    showToast('Server connection failed.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    lucide.createIcons();
  }
}

async function removeApiKey(index) {
  const confirmed = await showCustomConfirm('Hapus API Key', `Yakin ingin menghapus Key #${index + 1}?`, true);
  if (!confirmed) return;
  try {
    const res = await fetch(`/api/gemini-keys/${index}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) {
      showToast(result.message);
      loadApiKeys();
      loadStatus();
    } else {
      showToast(result.error, 'error');
    }
  } catch (err) {
    showToast('Gagal menghapus key.', 'error');
  }
}

// ============================================
// Tickets Monitor
// ============================================
async function loadTickets() {
  const tbody = document.getElementById('tickets-table-body');
  try {
    const res = await fetch('/api/tickets');
    const tickets = await res.json();

    // Stats
    document.getElementById('stat-total-tickets').textContent = tickets.length;
    document.getElementById('stat-open-tickets').textContent = tickets.filter(t => t.status !== 'CLOSED').length;
    document.getElementById('stat-closed-tickets').textContent = tickets.filter(t => t.status === 'CLOSED').length;

    if (tickets.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:24px;">Belum ada tiket.</td></tr>';
      return;
    }

    tbody.innerHTML = tickets.map((t, idx) => {
      const statusClass = t.status === 'OPEN' ? 'success' : t.status === 'CLOSED' ? 'error' : 'warning';
      const date = new Date(t.createdAt).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
      return `
        <tr class="ticket-expand" onclick="toggleTicketMessages('tmsg-${idx}')">
          <td><strong>${t.creatorName}</strong><br><small class="text-muted">${t.creatorId}</small></td>
          <td><span class="badge badge-${statusClass}">${t.status}</span></td>
          <td>${t.aiDisabled ? '<span class="badge badge-error">OFF</span>' : '<span class="badge badge-success">ON</span>'}</td>
          <td>${date}</td>
          <td>${t.messages ? t.messages.length : 0}</td>
          <td><i data-lucide="chevron-down" style="width:16px;height:16px;color:var(--text-muted);"></i></td>
        </tr>
        <tr>
          <td colspan="6" style="padding:0;border:none;">
            <div id="tmsg-${idx}" class="ticket-messages">
              ${(t.messages || []).slice(-15).map(m => {
        const srcClass = m.source.toLowerCase();
        const time = new Date(m.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
        return `
                  <div class="ticket-msg">
                    <span class="msg-sender">${m.senderName}</span>
                    <span class="msg-source ${srcClass}">${m.source}</span>
                    <span class="msg-time">${time}</span>
                    <div class="msg-content">${m.content.length > 200 ? m.content.substring(0, 200) + '...' : m.content}</div>
                  </div>
                `;
      }).join('')}
              ${(t.messages || []).length === 0 ? '<p class="text-muted text-sm" style="padding:8px;">Tidak ada pesan.</p>' : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');

    lucide.createIcons();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center" style="color:var(--color-error);padding:24px;">Error loading tickets.</td></tr>';
  }
}

function toggleTicketMessages(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('show');
}

// ============================================
// Pricelist Management CRUD
// ============================================
let pricelistCache = [];

async function loadPricelist() {
  const tbody = document.getElementById('pricelist-table-body');
  try {
    const res = await fetch('/api/pricelist');
    const items = await res.json();
    pricelistCache = items;

    const countEl = document.getElementById('stat-pricelist-count');
    if (countEl) {
      countEl.textContent = `${items.length} Item${items.length !== 1 ? 's' : ''}`;
    }

    if (items.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted" style="padding:24px;">Belum ada pricelist joki.</td></tr>';
      return;
    }

    tbody.innerHTML = items.map(item => `
      <tr>
        <td><strong>${item.name}</strong><br><small class="text-muted">${item.description || '-'}</small></td>
        <td><span class="badge badge-accent">${item.type}</span></td>
        <td>Rp ${item.basePrice.toLocaleString('id-ID')}</td>
        <td>${item.requirements.map(r => `<span style="display:inline-block;background:var(--bg-input);padding:2px 6px;border-radius:5px;margin:1px;font-size:0.78rem;">${r}</span>`).join('')}</td>
        <td>
          <button onclick="editPriceItem('${item.id}')" class="btn btn-secondary btn-xs" style="margin-right:4px;"><i data-lucide="edit-3"></i></button>
          <button onclick="deletePriceItem('${item.id}')" class="btn btn-secondary btn-xs" style="color:var(--color-error);"><i data-lucide="trash-2"></i></button>
        </td>
      </tr>
    `).join('');

    lucide.createIcons();
    loadCalculatorItems();
  } catch (err) {
    tbody.innerHTML = '<tr><td colspan="5" class="text-center" style="color:var(--color-error);padding:24px;">Error memuat pricelist!</td></tr>';
  }
}

const priceModal = document.getElementById('price-modal');

function openPriceForm() {
  document.getElementById('modal-title').textContent = 'Tambah Item Joki';
  document.getElementById('price-id').value = '';
  document.getElementById('price-form').reset();
  priceModal.style.display = 'flex';
}

function closePriceForm() { priceModal.style.display = 'none'; }

function editPriceItem(id) {
  const item = pricelistCache.find(i => i.id === id);
  if (!item) return;
  document.getElementById('modal-title').textContent = 'Edit Item Joki';
  document.getElementById('price-id').value = item.id;
  document.getElementById('price-name').value = item.name;
  document.getElementById('price-type').value = item.type;
  document.getElementById('price-val').value = item.basePrice;
  document.getElementById('price-req').value = item.requirements.join(', ');
  document.getElementById('price-desc').value = item.description || '';
  priceModal.style.display = 'flex';
}

document.getElementById('price-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const reqVal = document.getElementById('price-req').value;
  const requirements = reqVal.split(',').map(r => r.trim()).filter(Boolean);
  const body = {
    id: document.getElementById('price-id').value || null,
    name: document.getElementById('price-name').value,
    type: document.getElementById('price-type').value,
    basePrice: document.getElementById('price-val').value,
    requirements,
    description: document.getElementById('price-desc').value
  };
  try {
    const res = await fetch('/api/pricelist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await res.json();
    if (result.success) {
      closePriceForm();
      loadPricelist();
      showToast('Item berhasil disimpan!');
    } else {
      showToast('Gagal menyimpan: ' + result.error, 'error');
    }
  } catch (err) {
    showToast('Gagal menyimpan item.', 'error');
  }
});

async function deletePriceItem(id) {
  const confirmed = await showCustomConfirm('Hapus Item', 'Yakin ingin menghapus item ini?', true);
  if (!confirmed) return;
  try {
    const res = await fetch(`/api/pricelist/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) { loadPricelist(); showToast('Item dihapus.'); }
    else showToast('Gagal: ' + result.error, 'error');
  } catch (err) { showToast('Gagal menghapus item.', 'error'); }
}

async function clearAllPriceItems() {
  const confirmed = await showCustomConfirm('Hapus Semua', 'Yakin hapus seluruh pricelist? Tidak bisa dibatalkan!', true);
  if (!confirmed) return;
  try {
    const res = await fetch('/api/pricelist', { method: 'DELETE' });
    const result = await res.json();
    if (result.success) { loadPricelist(); showToast('Semua item dihapus.'); }
    else showToast('Gagal: ' + result.error, 'error');
  } catch (err) { showToast('Gagal menghapus.', 'error'); }
}

// ============================================
// Calculator Playground
// ============================================
function loadCalculatorItems() {
  const container = document.getElementById('calc-items-checkboxes');
  container.innerHTML = '';
  const nonLeveling = pricelistCache.filter(item => item.type !== 'LEVELING');
  if (nonLeveling.length === 0) {
    container.innerHTML = '<p class="text-muted">Pricelist item belum ada.</p>';
    return;
  }
  nonLeveling.forEach(item => {
    const label = document.createElement('label');
    label.className = 'checkbox-group';
    label.innerHTML = `<input type="checkbox" name="calc-items" value="${item.name}"> <span>${item.name} (Rp ${item.basePrice.toLocaleString('id-ID')})</span>`;
    container.appendChild(label);
  });
}

document.getElementById('calc-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const currentLevel = document.getElementById('calc-current').value;
  const targetLevel = document.getElementById('calc-target').value;
  const checkboxes = document.querySelectorAll('input[name="calc-items"]:checked');
  const items = Array.from(checkboxes).map(c => c.value);

  try {
    const res = await fetch('/api/calculator', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ currentLevel, targetLevel, items })
    });
    const result = await res.json();
    if (res.status !== 200) throw new Error(result.error);

    document.getElementById('calc-result-placeholder').classList.add('hidden');
    document.getElementById('calc-result-data').classList.remove('hidden');

    document.getElementById('res-total-price').textContent = `Rp ${result.totalPrice.toLocaleString('id-ID')}`;
    document.getElementById('res-levels').textContent = `${result.currentLevel} ➔ ${result.finalTargetLevel}`;
    document.getElementById('res-leveling-cost').textContent = `Rp ${result.levelingPrice.toLocaleString('id-ID')}`;
    document.getElementById('res-items-cost').textContent = `Rp ${result.itemsPrice.toLocaleString('id-ID')}`;

    const comboBox = document.getElementById('res-combo-box');
    if (result.autoComboAdded) {
      document.getElementById('res-combo-target').textContent = result.finalTargetLevel;
      document.getElementById('res-combo-cost').textContent = `Rp ${result.extraLevelingPrice.toLocaleString('id-ID')}`;
      comboBox.classList.remove('hidden');
    } else {
      comboBox.classList.add('hidden');
    }

    const itemsList = document.getElementById('res-items-list');
    itemsList.innerHTML = '<h4 style="margin-top:12px;">Rincian Item:</h4>';
    if (result.items.length === 0) {
      itemsList.innerHTML += '<p class="text-sm text-muted">Tidak ada item dipilih.</p>';
    } else {
      result.items.forEach(i => {
        itemsList.innerHTML += `
          <div style="display:flex;justify-content:space-between;font-size:0.88rem;margin-top:6px;">
            <span>• ${i.name} ${i.requiredLevel ? `<small class="text-muted">(Req Lvl ${i.requiredLevel})</small>` : ''}</span>
            <strong>Rp ${i.price.toLocaleString('id-ID')}</strong>
          </div>
        `;
      });
    }
  } catch (err) {
    showToast('Simulasi gagal: ' + err.message, 'error');
  }
});

// ============================================
// Dark/Light Mode Toggle
// ============================================
const themeToggle = document.getElementById('theme-toggle');

function setDarkMode(dark) {
  if (dark) {
    document.body.classList.add('dark');
    if (themeToggle) themeToggle.innerHTML = '<i data-lucide="sun"></i> Light';
    localStorage.setItem('darkMode', 'enabled');
  } else {
    document.body.classList.remove('dark');
    if (themeToggle) themeToggle.innerHTML = '<i data-lucide="moon"></i> Dark';
    localStorage.setItem('darkMode', 'disabled');
  }
  if (window.lucide) lucide.createIcons();
}

if (themeToggle) {
  themeToggle.addEventListener('click', () => {
    setDarkMode(!document.body.classList.contains('dark'));
  });
}

// Load saved preference
if (localStorage.getItem('darkMode') === 'enabled') {
  setDarkMode(true);
}

// ============================================
// Custom Confirmation Dialog
// ============================================
function showCustomConfirm(title, message, isDanger = false) {
  return new Promise((resolve) => {
    const modal = document.getElementById('confirm-modal');
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-message');
    const iconEl = document.getElementById('confirm-icon');
    const cancelBtn = document.getElementById('btn-confirm-cancel');
    const okBtn = document.getElementById('btn-confirm-ok');

    titleEl.textContent = title || 'Konfirmasi';
    msgEl.textContent = message || 'Apakah Anda yakin?';

    if (isDanger) {
      iconEl.setAttribute('data-lucide', 'alert-triangle');
      iconEl.style.color = 'var(--color-error)';
      okBtn.className = 'btn btn-danger btn-sm';
      okBtn.style.flex = '1';
      okBtn.style.padding = '10px';
      okBtn.textContent = 'Ya, Hapus';
    } else {
      iconEl.setAttribute('data-lucide', 'help-circle');
      iconEl.style.color = 'var(--color-warning)';
      okBtn.className = 'btn btn-primary btn-sm';
      okBtn.style.flex = '1';
      okBtn.style.padding = '10px';
      okBtn.textContent = 'Ya, Lanjutkan';
    }

    lucide.createIcons();
    modal.style.display = 'flex';

    function handleCancel() { cleanup(); resolve(false); }
    function handleOk() { cleanup(); resolve(true); }
    function cleanup() {
      modal.style.display = 'none';
      cancelBtn.removeEventListener('click', handleCancel);
      okBtn.removeEventListener('click', handleOk);
    }

    cancelBtn.addEventListener('click', handleCancel);
    okBtn.addEventListener('click', handleOk);
  });
}

// ============================================
// AI Pricelist Raw Text Importer
// ============================================
let extractedItemsCache = [];

function extractMinLevel(requirements) {
  if (!requirements || !Array.isArray(requirements)) return '-';
  for (const req of requirements) {
    const match = req.match(/(?:Level|Lvl)\s*(\d+)/i);
    if (match) return `Level ${match[1]}`;
  }
  return '-';
}

async function extractPricelistWithAI() {
  const inputEl = document.getElementById('ai-import-input');
  const extractBtn = document.getElementById('btn-extract-ai');
  const loadingOverlay = document.getElementById('ai-preview-loading');
  const commitBtn = document.getElementById('btn-commit-db');
  const previewBody = document.getElementById('ai-preview-body');
  const countLabel = document.getElementById('ai-import-count');

  const text = inputEl.value.trim();

  // Client-side validation: non-empty, min length
  if (!text) {
    showToast('Please paste a raw pricelist to extract.', 'warning');
    return;
  }
  if (text.length < 5) {
    showToast('Teks terlalu pendek untuk dianalisis.', 'warning');
    return;
  }

  // Show loading state
  loadingOverlay.classList.remove('hidden');
  extractBtn.disabled = true;
  const originalBtnText = extractBtn.innerHTML;
  extractBtn.innerHTML = '<i data-lucide="loader" class="spin"></i> Analyzing...';
  lucide.createIcons();

  // Reset preview grid during loading to show skeletal loader/placeholder
  previewBody.innerHTML = `
    <tr class="skeletal-row">
      <td><span class="skeleton-text"></span></td>
      <td><span class="skeleton-badge"></span></td>
      <td><span class="skeleton-text short"></span></td>
      <td><span class="skeleton-text short"></span></td>
    </tr>
    <tr class="skeletal-row">
      <td><span class="skeleton-text"></span></td>
      <td><span class="skeleton-badge"></span></td>
      <td><span class="skeleton-text short"></span></td>
      <td><span class="skeleton-text short"></span></td>
    </tr>
  `;

  try {
    const res = await fetch('/api/pricelist/analyze-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    const result = await res.json();
    if (!res.ok || !result.success) {
      throw new Error(result.error || 'Failed to extract data.');
    }

    extractedItemsCache = result.items || [];
    renderAIPreviewGrid(extractedItemsCache);
  } catch (err) {
    showToast(`AI extraction failed: ${err.message}`, 'error');

    // Restore empty skeletal rows
    previewBody.innerHTML = `
      <tr><td colspan="4" class="text-center text-muted" style="padding: 24px;">Failed to extract. Try again.</td></tr>
    `;
    commitBtn.disabled = true;
    countLabel.textContent = '0 items ready to commit.';
  } finally {
    // Clear loading state
    loadingOverlay.classList.add('hidden');
    extractBtn.disabled = false;
    extractBtn.innerHTML = originalBtnText;
    lucide.createIcons();
  }
}

function renderAIPreviewGrid(items) {
  const previewBody = document.getElementById('ai-preview-body');
  const commitBtn = document.getElementById('btn-commit-db');
  const countLabel = document.getElementById('ai-import-count');

  if (!items || items.length === 0) {
    previewBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted" style="padding: 24px;">AI detected no services.</td></tr>';
    commitBtn.disabled = true;
    countLabel.textContent = '0 items ready to commit.';
    return;
  }

  // Render preview grid rows
  previewBody.innerHTML = items.map((item) => {
    // Format price in IDR
    const priceStr = 'Rp ' + (item.basePrice || 0).toLocaleString('id-ID');
    // Extract Min. Level
    const minLevel = extractMinLevel(item.requirements);

    return `
      <tr>
        <td style="font-weight:600;">${item.name || '-'}</td>
        <td><span class="badge badge-glow-success" style="font-size:0.7rem; padding: 2px 8px;">${item.type || 'OTHER'}</span></td>
        <td style="color:var(--color-success); font-weight:600;">${priceStr}</td>
        <td style="font-weight:500; color:var(--text-secondary);">${minLevel}</td>
      </tr>
    `;
  }).join('');

  // Enable Commit button and update count
  commitBtn.disabled = false;
  countLabel.textContent = `${items.length} item(s) extracted successfully and ready to save.`;
}

async function commitImportedPricelist() {
  const commitBtn = document.getElementById('btn-commit-db');
  const inputEl = document.getElementById('ai-import-input');
  const previewBody = document.getElementById('ai-preview-body');
  const countLabel = document.getElementById('ai-import-count');

  if (extractedItemsCache.length === 0) {
    showToast('No valid items to commit.', 'warning');
    return;
  }

  const originalHtml = commitBtn.innerHTML;
  commitBtn.disabled = true;
  commitBtn.innerHTML = '<i data-lucide="loader" class="spin"></i> Saving...';
  lucide.createIcons();

  try {
    const res = await fetch('/api/pricelist/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: extractedItemsCache })
    });
    const result = await res.json();
    if (result.success) {
      showToast(`Successfully saved ${result.count} service(s) to Database!`, 'success');

      // Clear input and cache
      inputEl.value = '';
      extractedItemsCache = [];

      // Restore skeletal placeholders
      previewBody.innerHTML = `
        <tr class="skeletal-row">
          <td><span class="skeleton-text"></span></td>
          <td><span class="skeleton-badge"></span></td>
          <td><span class="skeleton-text short"></span></td>
          <td><span class="skeleton-text short"></span></td>
        </tr>
        <tr class="skeletal-row">
          <td><span class="skeleton-text"></span></td>
          <td><span class="skeleton-badge"></span></td>
          <td><span class="skeleton-text short"></span></td>
          <td><span class="skeleton-text short"></span></td>
        </tr>
      `;
      commitBtn.disabled = true;
      countLabel.textContent = '0 items ready to commit.';

      // Reload Master Pricelist table dynamically
      loadPricelist();
    } else {
      showToast(`Failed to commit: ${result.error}`, 'error');
      commitBtn.disabled = false;
    }
  } catch (err) {
    showToast('Network error while saving pricelist.', 'error');
    commitBtn.disabled = false;
  } finally {
    commitBtn.innerHTML = originalHtml;
    lucide.createIcons();
  }
}

// ============================================
// Google Workspace Cloud Sync & Restore
// ============================================
async function loadBackupStatus() {
  try {
    const res = await fetch('/api/backup/status');
    const data = await res.json();

    const badge = document.getElementById('google-sync-status-badge');
    const emailSpan = document.getElementById('google-sync-email');
    const timeSpan = document.getElementById('google-last-sync-time');
    const sizeSpan = document.getElementById('google-backup-size');

    if (badge) {
      badge.textContent = data.status || 'Disconnected';
      badge.className = 'badge';
      if (data.status === 'Connected') {
        badge.classList.add('badge-glow-success');
      } else if (data.status === 'Syncing') {
        badge.classList.add('badge-glow-warning');
      } else if (data.status === 'Sync Failed') {
        badge.classList.add('badge-glow-error');
      } else {
        badge.classList.add('badge-glow-error');
      }
    }

    if (emailSpan) emailSpan.textContent = data.email || 'Not Connected';
    if (timeSpan) timeSpan.textContent = data.lastSync || '-';
    if (sizeSpan) sizeSpan.textContent = data.size || '-';
  } catch (err) {
    console.error('Error loading backup status:', err);
  }
}

async function triggerCloudBackup() {
  const btn = document.getElementById('btn-cloud-sync');
  if (!btn) return;

  const originalHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Syncing...';
  lucide.createIcons();

  try {
    const res = await fetch('/api/backup/trigger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await res.json();
    if (res.ok && result.success) {
      showToast('Database cloud sync completed successfully!', 'success');
    } else {
      showToast(`Cloud sync failed: ${result.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    showToast('Network error while triggering cloud sync.', 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHtml;
    lucide.createIcons();
    await loadBackupStatus();
  }
}

async function confirmCloudRestore() {
  const confirm1 = await showCustomConfirm(
    'Cloud Restore',
    '⚠️ WARNING: Restoring the database will overwrite all your current local data, configurations, order registers, and keys with the cloud backup version. Do you want to proceed?',
    true
  );
  if (!confirm1) return;

  const confirm2 = await showCustomConfirm(
    'CRITICAL WARNING',
    '🚨 LAST WARNING: This action is irreversible. Your active database connection will be temporarily hot-swapped. Are you absolutely certain you want to proceed?',
    true
  );
  if (!confirm2) return;

  const btn = document.getElementById('btn-cloud-restore');
  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<i data-lucide="loader" class="spin"></i> Restoring...';
    lucide.createIcons();
  }

  try {
    const res = await fetch('/api/backup/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });
    const result = await res.json();
    if (res.ok && result.success) {
      showToast('Database restored successfully! Hot-swapping complete.', 'success');
      setTimeout(() => {
        window.location.reload();
      }, 1500);
    } else {
      showToast(`Restore failed: ${result.error || 'Unknown error'}`, 'error');
    }
  } catch (err) {
    showToast('Network error while restoring database.', 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = originalHtml;
      lucide.createIcons();
    }
    await loadBackupStatus();
  }
}

// Poll backup status every 30 seconds if page is visible
setInterval(() => {
  const controlTab = document.getElementById('tab-control');
  if (controlTab && controlTab.classList.contains('active')) {
    loadBackupStatus().catch(() => {});
  }
}, 30000);

// ============================================
// STOPPED CHATS
// ============================================
async function loadStoppedChats() {
  try {
    const res = await fetch('/api/whatsapp/stopped');
    const data = await res.json();
    renderStoppedChats(data.stopped || []);
  } catch (err) {
    console.error('Error loading stopped chats:', err);
  }
}

function renderStoppedChats(list) {
  const tbody = document.getElementById('stopped-chats-table-body');
  if (!tbody) return;

  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted" style="padding:16px;">Tidak ada stopped chats.</td></tr>';
    return;
  }

  tbody.innerHTML = list.map(item => {
    const dateStr = item.stoppedAt ? new Date(item.stoppedAt).toLocaleString('id-ID') : '-';
    const repliedBadge = item.adminReplied
      ? '<span class="badge badge-success">Ya</span>'
      : '<span class="badge badge-warning">Belum</span>';
    return `
      <tr>
        <td><strong>${item.jid}</strong></td>
        <td>${dateStr}</td>
        <td>${repliedBadge}</td>
        <td style="text-align:right;">
          <button onclick="unstopChat('${item.jid}')" class="btn btn-primary btn-xs">
            <i data-lucide="play"></i> Aktifkan Bot
          </button>
        </td>
      </tr>
    `;
  }).join('');
  lucide.createIcons();
}

async function unstopChat(jid) {
  try {
    const res = await fetch('/api/whatsapp/stopped', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jid, isStopped: false })
    });
    const result = await res.json();
    if (result.success) {
      showToast(`Bot diaktifkan kembali untuk ${jid}`);
      loadStoppedChats();
    } else {
      showToast(result.error, 'error');
    }
  } catch (err) {
    showToast('Gagal mengaktifkan bot.', 'error');
  }
}

function manualStopChat() {
  const jid = document.getElementById('manual-stop-jid').value.trim();
  if (!jid) { showToast('JID tidak boleh kosong', 'warning'); return; }
  fetch('/api/whatsapp/stopped', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jid, isStopped: true })
  }).then(r => r.json()).then(r => {
    if (r.success) { showToast(`Bot dihentikan untuk ${jid}`); loadStoppedChats(); document.getElementById('manual-stop-jid').value = ''; }
    else showToast(r.error, 'error');
  }).catch(() => showToast('Gagal menghentikan bot.', 'error'));
}

function manualUnstopChat() {
  const jid = document.getElementById('manual-stop-jid').value.trim();
  if (!jid) { showToast('JID tidak boleh kosong', 'warning'); return; }
  unstopChat(jid).then(() => { document.getElementById('manual-stop-jid').value = ''; });
}

// ============================================
// BROADCAST PANEL
// ============================================

let broadcastGroups = []; // Cache of fetched groups
let broadcastPresetsCache = [];

// --- Message Textboxes ---

function addMsgBox() {
  const container = document.getElementById('broadcast-messages-container');
  const index = container.querySelectorAll('.broadcast-msg-row').length;
  const div = document.createElement('div');
  div.className = 'broadcast-msg-row';
  div.dataset.index = index;
  div.style.cssText = 'display:flex; gap:10px; align-items:flex-start;';
  div.innerHTML = `
    <div style="flex:1;">
      <label class="form-label" style="font-size:0.8rem;">Pesan ${index + 1}</label>
      <textarea class="form-control broadcast-msg-input" rows="3" placeholder="Ketik pesan broadcast #${index + 1}..."></textarea>
    </div>
    <button onclick="removeMsgBox(this)" class="btn btn-icon btn-danger" style="margin-top:28px;" title="Hapus">
      <i data-lucide="trash-2"></i>
    </button>
  `;
  container.appendChild(div);
  lucide.createIcons();
}

function removeMsgBox(btn) {
  const row = btn.closest('.broadcast-msg-row');
  const container = document.getElementById('broadcast-messages-container');
  if (container.querySelectorAll('.broadcast-msg-row').length <= 1) {
    showToast('Minimal harus ada 1 pesan.', 'warning');
    return;
  }
  row.remove();
  // Re-number labels
  container.querySelectorAll('.broadcast-msg-row').forEach((r, i) => {
    const label = r.querySelector('label');
    if (label) label.textContent = `Pesan ${i + 1}`;
  });
}

function getBroadcastMessages() {
  return Array.from(document.querySelectorAll('.broadcast-msg-input'))
    .map(ta => ta.value.trim())
    .filter(v => v);
}

// --- Preset Management ---

async function loadBroadcastPresets() {
  try {
    const res = await fetch('/api/broadcast/presets');
    const data = await res.json();
    broadcastPresetsCache = data.presets || [];
    const sel = document.getElementById('broadcast-preset-select');
    if (!sel) return;
    const currentVal = sel.value;
    sel.innerHTML = '<option value="">— Pilih Preset —</option>' +
      broadcastPresetsCache.map(p => `<option value="${p.id}">${p.name}</option>`).join('');
    if (currentVal) sel.value = currentVal;
  } catch (err) {
    console.error('Error loading presets:', err);
  }
}

function loadPresetIntoForm() {
  const sel = document.getElementById('broadcast-preset-select');
  const presetId = sel?.value;
  if (!presetId) return;
  const preset = broadcastPresetsCache.find(p => p.id === presetId);
  if (!preset) return;

  let messages = [];
  try { messages = JSON.parse(preset.messages || '[]'); } catch (_) {}

  // Clear and rebuild message boxes
  const container = document.getElementById('broadcast-messages-container');
  container.innerHTML = '';
  if (messages.length === 0) messages = [''];
  messages.forEach((msg, i) => {
    const div = document.createElement('div');
    div.className = 'broadcast-msg-row';
    div.dataset.index = i;
    div.style.cssText = 'display:flex; gap:10px; align-items:flex-start;';
    div.innerHTML = `
      <div style="flex:1;">
        <label class="form-label" style="font-size:0.8rem;">Pesan ${i + 1}</label>
        <textarea class="form-control broadcast-msg-input" rows="3">${msg}</textarea>
      </div>
      <button onclick="removeMsgBox(this)" class="btn btn-icon btn-danger" style="margin-top:28px;" title="Hapus">
        <i data-lucide="trash-2"></i>
      </button>
    `;
    container.appendChild(div);
  });
  // Set preset name field
  const nameInput = document.getElementById('broadcast-preset-name');
  if (nameInput) nameInput.value = preset.name;
  lucide.createIcons();
  showToast(`Preset "${preset.name}" dimuat!`);
}

async function saveBroadcastPreset() {
  const name = document.getElementById('broadcast-preset-name').value.trim();
  if (!name) { showToast('Isi nama preset terlebih dahulu.', 'warning'); return; }

  const messages = getBroadcastMessages();
  if (messages.length === 0) { showToast('Minimal 1 pesan harus diisi.', 'warning'); return; }

  // Check if updating existing preset by name
  const existing = broadcastPresetsCache.find(p => p.name === name);

  try {
    const res = await fetch('/api/broadcast/presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: existing?.id, name, messages })
    });
    const result = await res.json();
    if (result.success) {
      showToast(`Preset "${name}" berhasil disimpan!`);
      await loadBroadcastPresets();
      // Select the saved preset
      const sel = document.getElementById('broadcast-preset-select');
      if (sel && result.preset) sel.value = result.preset.id;
    } else {
      showToast(result.error, 'error');
    }
  } catch (err) {
    showToast('Gagal menyimpan preset.', 'error');
  }
}

// --- Group List ---

async function loadGroupsForBroadcast() {
  const container = document.getElementById('broadcast-groups-list');
  container.innerHTML = '<p class="text-muted text-sm text-center" style="padding:16px;"><i data-lucide="loader" class="spin"></i> Memuat grup...</p>';
  lucide.createIcons();

  try {
    const res = await fetch('/api/whatsapp/groups');
    const data = await res.json();
    broadcastGroups = data.groups || [];

    if (broadcastGroups.length === 0) {
      container.innerHTML = '<p class="text-muted text-sm text-center" style="padding:16px;">Tidak ada grup ditemukan. Pastikan WhatsApp sudah terhubung.</p>';
      return;
    }

    container.innerHTML = broadcastGroups.map(g => `
      <label style="display:flex; align-items:center; gap:10px; padding:10px 12px; background:rgba(255,255,255,0.03); border-radius:10px; cursor:pointer; border:1px solid var(--border-glass);">
        <input type="checkbox" class="group-checkbox" value="${g.jid}" style="width:16px;height:16px; accent-color:var(--color-accent);">
        <div>
          <div style="font-weight:600; font-size:0.9rem;">${g.name}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${g.jid} &bull; ${g.participantCount} anggota</div>
        </div>
      </label>
    `).join('');

    const badge = document.getElementById('nav-broadcast-badge');
    if (badge) { badge.style.display = 'inline'; badge.textContent = broadcastGroups.length; }
  } catch (err) {
    container.innerHTML = '<p class="text-muted text-sm text-center" style="padding:16px;">Gagal memuat grup. WA mungkin belum terhubung.</p>';
  }
}

function toggleSelectAllGroups() {
  const checkboxes = document.querySelectorAll('.group-checkbox');
  const btn = document.getElementById('btn-select-all-groups');
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  checkboxes.forEach(cb => cb.checked = !allChecked);
  btn.textContent = allChecked ? 'Select All' : 'Deselect All';
}

function getSelectedGroups() {
  return Array.from(document.querySelectorAll('.group-checkbox:checked')).map(cb => cb.value);
}

// --- Interval Selection ---

function setInterval_(ms) {
  document.getElementById('broadcast-interval-ms').value = ms;
  const label = {
    '3600000': '1 Jam',
    '7200000': '2 Jam',
    '14400000': '4 Jam',
    '21600000': '6 Jam',
    '43200000': '12 Jam',
    '86400000': '24 Jam'
  };
  const display = document.getElementById('selected-interval-display');
  if (display) display.textContent = label[ms] || `${parseInt(ms)/60000} menit`;

  document.querySelectorAll('.interval-btn').forEach(btn => {
    btn.classList.toggle('btn-primary', btn.dataset.val === ms);
    btn.classList.toggle('btn-secondary', btn.dataset.val !== ms);
  });
}

function applyCustomInterval() {
  const minutes = parseInt(document.getElementById('broadcast-custom-interval').value, 10);
  if (!minutes || minutes < 1) { showToast('Masukkan interval minimal 1 menit.', 'warning'); return; }
  const ms = String(minutes * 60 * 1000);
  document.getElementById('broadcast-interval-ms').value = ms;
  const display = document.getElementById('selected-interval-display');
  if (display) display.textContent = `${minutes} menit (custom)`;
  document.querySelectorAll('.interval-btn').forEach(btn => btn.classList.replace('btn-primary', 'btn-secondary'));
}

// --- Start / Stop Job ---

async function startBroadcastJob() {
  const messages = getBroadcastMessages();
  if (messages.length === 0) { showToast('Isi minimal 1 pesan terlebih dahulu.', 'warning'); return; }

  const targetGroups = getSelectedGroups();
  if (targetGroups.length === 0) { showToast('Pilih minimal 1 grup target.', 'warning'); return; }

  const intervalMs = parseInt(document.getElementById('broadcast-interval-ms').value, 10);
  if (!intervalMs || intervalMs < 60000) { showToast('Pilih interval terlebih dahulu (minimal 1 menit).', 'warning'); return; }

  const confirmed = await showCustomConfirm(
    'Mulai Broadcast',
    `Kirim ${messages.length} pesan ke ${targetGroups.length} grup setiap ${Math.round(intervalMs/60000)} menit?`,
    false
  );
  if (!confirmed) return;

  try {
    const presetSel = document.getElementById('broadcast-preset-select');
    const presetId = presetSel?.value || null;

    const res = await fetch('/api/broadcast/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, targetGroups, intervalMs, presetId })
    });
    const result = await res.json();
    if (result.success) {
      showToast('Broadcast job dimulai!');
      loadBroadcastJobs();
    } else {
      showToast(result.error, 'error');
    }
  } catch (err) {
    showToast('Gagal memulai broadcast.', 'error');
  }
}

async function stopBroadcastJobById(id) {
  const confirmed = await showCustomConfirm('Stop Job', 'Yakin ingin menghentikan broadcast job ini?', true);
  if (!confirmed) return;
  try {
    const res = await fetch(`/api/broadcast/jobs/${id}/stop`, { method: 'PUT' });
    const result = await res.json();
    if (result.success) { showToast('Broadcast job dihentikan.'); loadBroadcastJobs(); }
    else showToast(result.error, 'error');
  } catch (err) {
    showToast('Gagal menghentikan job.', 'error');
  }
}

async function deleteBroadcastJob(id) {
  const confirmed = await showCustomConfirm('Hapus Job', 'Hapus broadcast job ini secara permanen?', true);
  if (!confirmed) return;
  try {
    const res = await fetch(`/api/broadcast/jobs/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (result.success) { showToast('Job dihapus.'); loadBroadcastJobs(); }
    else showToast(result.error, 'error');
  } catch (err) {
    showToast('Gagal menghapus job.', 'error');
  }
}

async function loadBroadcastJobs() {
  try {
    const res = await fetch('/api/broadcast/jobs');
    const data = await res.json();
    renderBroadcastJobs(data.jobs || []);

    // Update nav badge if any running
    const running = (data.jobs || []).filter(j => j.status === 'RUNNING').length;
    const badge = document.getElementById('nav-broadcast-badge');
    if (badge) {
      if (running > 0) { badge.style.display = 'inline'; badge.textContent = `${running} aktif`; }
      else { badge.style.display = 'none'; }
    }
  } catch (err) {
    console.error('Error loading broadcast jobs:', err);
  }
}

function renderBroadcastJobs(jobs) {
  const tbody = document.getElementById('broadcast-jobs-table-body');
  if (!tbody) return;

  if (jobs.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted" style="padding:24px;">Tidak ada broadcast job.</td></tr>';
    return;
  }

  tbody.innerHTML = jobs.map(job => {
    let msgs = [];
    let groups = [];
    try { msgs = JSON.parse(job.messages || '[]'); } catch (_) {}
    try { groups = JSON.parse(job.targetGroups || '[]'); } catch (_) {}

    const preview = msgs[0] ? (msgs[0].length > 50 ? msgs[0].slice(0, 50) + '...' : msgs[0]) : '-';
    const intervalLabel = job.intervalMs >= 3600000
      ? `${job.intervalMs / 3600000} Jam`
      : `${Math.round(job.intervalMs / 60000)} Menit`;
    const lastSent = job.lastSentAt ? new Date(job.lastSentAt).toLocaleString('id-ID') : 'Belum dikirim';
    const statusBadge = job.status === 'RUNNING'
      ? '<span class="badge badge-success">RUNNING</span>'
      : '<span class="badge badge-error">STOPPED</span>';

    return `
      <tr>
        <td>
          <div style="font-size:0.85rem; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${preview}</div>
          <small class="text-muted">${msgs.length} pesan</small>
        </td>
        <td><span class="badge badge-accent">${groups.length} grup</span></td>
        <td>${intervalLabel}</td>
        <td><small>${lastSent}</small></td>
        <td>${statusBadge}</td>
        <td style="text-align:right; display:flex; gap:6px; justify-content:flex-end;">
          ${job.status === 'RUNNING' ? `<button onclick="stopBroadcastJobById('${job.id}')" class="btn btn-secondary btn-sm" style="color:var(--color-warning);"><i data-lucide="square"></i> Stop</button>` : ''}
          <button onclick="deleteBroadcastJob('${job.id}')" class="btn btn-icon btn-danger" title="Hapus"><i data-lucide="trash-2"></i></button>
        </td>
      </tr>
    `;
  }).join('');
  lucide.createIcons();
}

// ============================================
// Page Bootstrap
// ============================================
window.onload = async () => {
  await loadStatus();
  await loadPricelist();
  await loadTickets();
  await loadOrders();
  loadApiKeys();
  renderMockCharts();
  lucide.createIcons();
};

function renderMockCharts() {
  const salesContainer = document.getElementById('sales-chart-container');
  if (salesContainer) {
    salesContainer.innerHTML = `
      <div class="bar-chart">
        <div class="bar" style="height: 30%" data-val="12"></div>
        <div class="bar" style="height: 50%" data-val="25"></div>
        <div class="bar" style="height: 40%" data-val="18"></div>
        <div class="bar" style="height: 80%" data-val="40"></div>
        <div class="bar" style="height: 60%" data-val="28"></div>
        <div class="bar" style="height: 90%" data-val="45"></div>
        <div class="bar" style="height: 100%" data-val="52"></div>
      </div>
    `;
  }

  const activityContainer = document.getElementById('activity-chart-container');
  if (activityContainer) {
    activityContainer.innerHTML = `
      <div class="doughnut-chart">
        <div class="doughnut-inner">
          <h2>82%</h2>
          <span>Active</span>
        </div>
      </div>
    `;
  }
}
