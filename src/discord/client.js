const { Client, GatewayIntentBits, Partials, ActivityType, ButtonBuilder, ButtonStyle, ActionRowBuilder, AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const { config } = require('../config');
const { prisma } = require('../database');
const { getGeminiReply } = require('../ai/gemini');
const { addMessageToSession } = require('../ai/memoryManager');
const { handleSlashCommand, registerSlashCommands } = require('./commands');
const { handleTicketCreate, handleTicketClose, parseLastOrderFormat } = require('./ticketManager');
const { isExploitAttempt, sanitizeInput } = require('../utils/securityAudit');
const fs = require('fs');
const path = require('path');

// Initialize Discord Client
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions
  ],
  partials: [Partials.Channel, Partials.Message]
});

// Event: Client Ready
client.once('ready', async () => {
  console.log(`Discord Bot logged in as ${client.user.tag}`);

  // Set bot activity
  client.user.setActivity('Blox Fruits Helper', { type: ActivityType.Playing });

  // Register commands
  await registerSlashCommands(client);
});

// Event: Interaction Create (Buttons & Commands)
client.on('interactionCreate', async (interaction) => {
  if (interaction.isChatInputCommand()) {
    return handleSlashCommand(interaction);
  }

  if (interaction.isButton()) {
    const customId = interaction.customId;

    if (customId === 'open_ticket') {
      return handleTicketCreate(interaction);
    }

    if (customId === 'close_ticket') {
      const ticket = await prisma.ticket.findUnique({
        where: { discordChanId: interaction.channel.id }
      });
      if (ticket) {
        return handleTicketClose(interaction, ticket);
      }
    }

    if (customId === 'connect_admin') {
      const ticket = await prisma.ticket.findUnique({
        where: { discordChanId: interaction.channel.id }
      });

      if (ticket) {
        // Set aiDisabled to true
        await prisma.ticket.update({
          where: { id: ticket.id },
          data: { aiDisabled: true }
        });

        // Determine slang settings from member / preferences
        const member = interaction.member;
        const hasUnderageRole = member ? member.roles.cache.some(role =>
          role.name.includes('<15') || role.name.toLowerCase().includes('under-15')
        ) : false;

        let allowHarsh = !hasUnderageRole;
        if (member && !hasUnderageRole) {
          const userPref = await prisma.userPreference.findUnique({
            where: { userId: interaction.user.id }
          });
          if (userPref) {
            allowHarsh = userPref.allowHarshSlang;
          }
        }

        // Disable only the connect_admin button, preserving all other buttons (e.g. Payment)
        const originalMsg = interaction.message;
        if (originalMsg && originalMsg.components.length > 0) {
          const updatedRows = originalMsg.components.map(row => {
            const newRow = new ActionRowBuilder();
            row.components.forEach(btn => {
              const newBtn = ButtonBuilder.from(btn);
              if (btn.customId === 'connect_admin') {
                newBtn.setDisabled(true);
              }
              newRow.addComponents(newBtn);
            });
            return newRow;
          });
          await interaction.update({ components: updatedRows }).catch(() => null);
        } else {
          await interaction.deferUpdate().catch(() => null);
        }

        const adminRoleId = config.discord.adminRoleId;
        const connectTemplate = config.ticketConnectAdminText || 'Mohon segera membalas <@&{adminRoleId}>';
        const responseMsg = connectTemplate.replace(/{adminRoleId}/g, adminRoleId || '');

        await interaction.channel.send(responseMsg);

        // Log in database
        await prisma.message.create({
          data: {
            ticketId: ticket.id,
            senderId: interaction.client.user.id,
            senderName: 'System',
            content: 'AI Disabled: Connected to Admin.',
            source: 'SYSTEM'
          }
        });
      }
    }

    // Handle admin payment trigger button
    if (customId === 'admin_payment_trigger') {
      // Check admin permissions
      const adminRoleId = config.discord.adminRoleId;
      const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
        (adminRoleId && interaction.member.roles.cache.has(adminRoleId));

      if (!isAdmin) {
        return interaction.reply({ content: '❌ Lu bukan admin, bro. Tombol ini cuma buat admin.', ephemeral: true });
      }

      try {
        // Fetch messages from the channel and parse order format
        const messages = await interaction.channel.messages.fetch({ limit: 50 });
        const parsedOrder = parseLastOrderFormat(messages);

        if (!parsedOrder) {
          return interaction.reply({ content: '❌ Gak nemu format harga joki di chat tiket ini. Pastikan Mia udah kirim rincian harganya.', ephemeral: true });
        }

        const { price } = parsedOrder;
        const qrisPath = config.qrisImagePath ? path.resolve(config.qrisImagePath) : null;

        let paymentContent = `💳 **TOTAL TAGIHAN: Rp ${price.toLocaleString('id-ID')}**\n\nSilakan scan QRIS di bawah ini untuk pembayaran. Jika sudah, kirim bukti transfer ya bro! 🙏`;
        let options = { content: paymentContent };

        if (qrisPath && fs.existsSync(qrisPath)) {
          const attachment = new AttachmentBuilder(qrisPath);
          options.files = [attachment];
        } else {
          options.content += `\n*(Note: Gambar QRIS belum di-upload di Dashboard)*`;
        }

        await interaction.channel.send(options);

        // Disable the payment button on the original message
        const originalMsg = interaction.message;
        if (originalMsg && originalMsg.components.length > 0) {
          const updatedRows = originalMsg.components.map(row => {
            const newRow = new ActionRowBuilder();
            row.components.forEach(btn => {
              const newBtn = ButtonBuilder.from(btn);
              if (btn.customId === 'admin_payment_trigger') {
                newBtn.setDisabled(true);
              }
              newRow.addComponents(newBtn);
            });
            return newRow;
          });
          await interaction.update({ components: updatedRows });
        } else {
          await interaction.reply({ content: '✅ Payment info terkirim!', ephemeral: true });
        }
      } catch (error) {
        console.error('Error handling admin_payment_trigger:', error);
        await interaction.reply({ content: '❌ Gagal mengirim info pembayaran.', ephemeral: true }).catch(() => null);
      }
    }

    // Handle delete ticket confirmation
    if (customId === 'delete_ticket_confirm') {
      const adminRoleId = config.discord.adminRoleId;
      const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator) ||
        (adminRoleId && interaction.member.roles.cache.has(adminRoleId));

      if (!isAdmin) {
        return interaction.reply({ content: '❌ Lu bukan admin, bro.', ephemeral: true });
      }

      try {
        const ticket = await prisma.ticket.findUnique({
          where: { discordChanId: interaction.channel.id }
        });

        if (ticket) {
          // Delete ticket from DB (messages cascade delete automatically)
          await prisma.ticket.delete({ where: { id: ticket.id } });
        }

        await interaction.reply({ content: '🗑️ Tiket akan dihapus dalam **5 detik**...' });

        setTimeout(async () => {
          try {
            await interaction.channel.delete();
          } catch (err) {
            console.error('Error deleting ticket channel:', err);
          }
        }, 5000);
      } catch (error) {
        console.error('Error handling delete_ticket_confirm:', error);
        await interaction.reply({ content: '❌ Gagal menghapus tiket.', ephemeral: true }).catch(() => null);
      }
    }

    // Handle delete ticket cancellation
    if (customId === 'delete_ticket_cancel') {
      try {
        await interaction.message.delete();
      } catch (err) {
        await interaction.reply({ content: '✅ Penghapusan dibatalkan.', ephemeral: true }).catch(() => null);
      }
    }
  }
});

// Expose a WhatsApp bridge send callback (to be set by index.js/whatsapp handler)
let sendToWhatsAppCallback = null;
function setWhatsAppBridgeCallback(callback) {
  sendToWhatsAppCallback = callback;
}

// Event: Message Create (Trigger AI and WhatsApp bridges)
client.on('messageCreate', async (message) => {
  // Ignore bots
  if (message.author.bot) return;

  // 1. Check if message is in an active ticket channel
  const ticket = await prisma.ticket.findUnique({
    where: { discordChanId: message.channel.id }
  });

  if (!ticket) return; // Not a ticket channel

  // Log incoming message in DB
  await prisma.message.create({
    data: {
      ticketId: ticket.id,
      senderId: message.author.id,
      senderName: message.author.username,
      content: message.content,
      source: 'DISCORD'
    }
  });

  // Save to rolling memory session buffer
  const isTicketCreator = message.author.id === ticket.creatorId;
  try {
    if (isTicketCreator) {
      await addMessageToSession(ticket.id, 'user', message.content);
    } else {
      // Admin/staff message — save as 'model' so AI knows what admin said
      await addMessageToSession(ticket.id, 'model', `[Admin ${message.author.username}]: ${message.content}`);
    }
  } catch (memErr) {
    console.error('[MemoryManager] Failed to save Discord message to session:', memErr.message);
  }

  // 2. WhatsApp Forward Bridge
  // If the admin is listening on WhatsApp and this ticket has a WA link
  if (sendToWhatsAppCallback) {
    sendToWhatsAppCallback(ticket, message.author.username, message.content);
  }

  // 3. AI Reply Trigger (Automatic for ticket creator if AI is not disabled globally & on ticket)
  if (config.globalAiEnabled && !ticket.aiDisabled && message.author.id === ticket.creatorId) {
    let promptText = message.content.trim();
    const prefix = 'ai ';
    if (promptText.toLowerCase().startsWith(prefix)) {
      promptText = promptText.substring(prefix.length).trim();
    }
    promptText = sanitizeInput(promptText);

    // Exploit/Jailbreak Auditing
    if (isExploitAttempt(promptText)) {
      console.warn(`[Security Alert] Potential exploit attempt by ${message.author.tag}: ${promptText}`);
      return message.reply("Kagak mempan anjir trik kek gitu di gua. Tanya yang bener aja lah bro, lol.");
    }

    if (!promptText) {
      return message.reply("Apaan sih jir? Nulis pesan yang bener lah biar gua ngerti.");
    }

    // Check user preference & roles for slang filtering
    const member = message.member;
    const hasUnderageRole = member ? member.roles.cache.some(role =>
      role.name.includes('<15') || role.name.toLowerCase().includes('under-15')
    ) : false;

    let allowHarsh = !hasUnderageRole;

    if (!hasUnderageRole) {
      const userPref = await prisma.userPreference.findUnique({
        where: { userId: message.author.id }
      });
      if (userPref) {
        allowHarsh = userPref.allowHarshSlang;
      }
    }

    // Trigger typing state to look interactive
    await message.channel.sendTyping();

    // Fetch conversation logs from database for context (retrieve up to 25 messages)
    const dbMessages = await prisma.message.findMany({
      where: { ticketId: ticket.id },
      orderBy: { createdAt: 'desc' },
      take: 25
    });

    // Format chat history for Gemini (reverse to chronological order)
    const chatHistory = dbMessages.reverse().map(msg => {
      // Map author to role: 'user' or 'model'
      const role = (msg.senderId === message.client.user.id || msg.source === 'AI') ? 'model' : 'user';
      return {
        role,
        content: msg.content
      };
    });

    try {
      const reply = await getGeminiReply(chatHistory, allowHarsh, message.author.id, ticket.id);

      // Guard: skip empty AI replies
      if (!reply || !reply.trim()) {
        return;
      }

      // Save AI reply in Database logs
      await prisma.message.create({
        data: {
          ticketId: ticket.id,
          senderId: message.client.user.id,
          senderName: 'Mia',
          content: reply,
          source: 'AI'
        }
      });

      const connectAdminBtn = new ButtonBuilder()
        .setCustomId('connect_admin')
        .setLabel('Hubungkan langsung dengan Admin')
        .setStyle(ButtonStyle.Primary);

      const buttons = [connectAdminBtn];

      // Detect if this AI response is an order confirmation
      const replyLower = reply.toLowerCase();
      const isOrderConfirmation = (replyLower.includes('ada orderan masuk nih') ||
        replyLower.includes('proses pembayarannya') ||
        replyLower.includes('total estimasi harga'));

      if (isOrderConfirmation) {
        const paymentBtn = new ButtonBuilder()
          .setCustomId('admin_payment_trigger')
          .setLabel('Payment 💳')
          .setStyle(ButtonStyle.Danger);
        buttons.push(paymentBtn);
      }

      const replyRow = new ActionRowBuilder().addComponents(...buttons);

      // Reply back to user
      await message.reply({ content: reply, components: [replyRow] });
    } catch (error) {
      console.error('Gemini error:', error);
      await message.reply("Aduh anjir, otak gua lagi nge-hang (Gemini Error). Coba chat lagi ntar deh bro.");
    }
  }
});

/**
 * Starts the Discord Client.
 */
function startDiscordBot() {
  if (!config.discord.token) {
    console.warn('[Warning] Discord Token kosong. Discord Bot tidak dijalankan.');
    return;
  }
  client.login(config.discord.token).catch(err => {
    console.error('Gagal login Discord bot:', err.message);
  });
}

module.exports = {
  startDiscordBot,
  setWhatsAppBridgeCallback,
  discordClient: client
};
