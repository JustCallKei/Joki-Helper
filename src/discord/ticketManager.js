const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, ChannelType } = require('discord.js');
const fs = require('fs');
const path = require('path');
const { prisma } = require('../database');
const { config } = require('../config');
const { getTemplate } = require('../ai/slangTemplates');
const { getGeminiReply } = require('../ai/gemini');

/**
 * Parses the last order format from a collection of Discord messages.
 * Looks for messages containing 'Nama Joki:' and 'Total Estimasi Harga:'.
 * Returns { namaJoki, price, detail, statusAwalTarget, pemeriksaanSyarat, rincianKebutuhan } or null.
 */
function parseLastOrderFormat(messages) {
  for (const [msgId, msg] of messages) {
    const content = msg.content || '';
    if (content.includes('Nama Joki:') && content.includes('Total Estimasi Harga:')) {
      const lines = content.split('\n');
      let namaJoki = '';
      let statusAwalTarget = '';
      let pemeriksaanSyarat = '';
      let rincianKebutuhan = '';
      let price = 0;

      for (const line of lines) {
        const cleanLine = line.replace(/[*_~`•\-]/g, '').trim();
        const lowerLine = cleanLine.toLowerCase();

        if (lowerLine.startsWith('nama joki:')) {
          namaJoki = cleanLine.substring('nama joki:'.length).trim();
        } else if (lowerLine.startsWith('status awal → target:')) {
          statusAwalTarget = cleanLine.substring('status awal → target:'.length).trim();
        } else if (lowerLine.startsWith('status awal -> target:')) {
          statusAwalTarget = cleanLine.substring('status awal -> target:'.length).trim();
        } else if (lowerLine.startsWith('pemeriksaan syarat:')) {
          pemeriksaanSyarat = cleanLine.substring('pemeriksaan syarat:'.length).trim();
        } else if (lowerLine.startsWith('rincian kebutuhan akun:')) {
          rincianKebutuhan = cleanLine.substring('rincian kebutuhan akun:'.length).trim();
        } else if (lowerLine.startsWith('total estimasi harga:')) {
          const priceStr = cleanLine.substring('total estimasi harga:'.length).trim();
          const digits = priceStr.replace(/\D/g, '');
          price = parseInt(digits, 10) || 0;
        }
      }

      if (namaJoki && price > 0) {
        let detailsArr = [];
        if (statusAwalTarget) detailsArr.push(`Target: ${statusAwalTarget}`);
        if (pemeriksaanSyarat) detailsArr.push(`Syarat: ${pemeriksaanSyarat}`);
        if (rincianKebutuhan) detailsArr.push(`Bahan: ${rincianKebutuhan}`);
        const detail = detailsArr.join(' | ') || '-';

        return { namaJoki, price, detail, statusAwalTarget, pemeriksaanSyarat, rincianKebutuhan };
      }
    }
  }
  return null;
}

/**
 * Builds the initial aesthetic ticket dashboard embed.
 */
function createTicketPanelEmbed(judul, deskripsi, warna, labelTombol, bannerUrl) {
  const embed = new EmbedBuilder()
    .setTitle(judul || '🎀  BLOX FRUITS TICKET DESK  🎀')
    .setDescription(deskripsi || 'Silakan klik tombol di bawah untuk membuka tiket.')
    .setColor(warna || 0xff75a0)
    .setTimestamp();

  if (bannerUrl && bannerUrl.startsWith('http')) {
    embed.setImage(bannerUrl);
  }

  const button = new ButtonBuilder()
    .setCustomId('open_ticket')
    .setLabel(labelTombol || 'Buka Tiket 🎫')
    .setStyle(ButtonStyle.Danger);

  const row = new ActionRowBuilder().addComponents(button);

  return { embeds: [embed], components: [row] };
}

/**
 * Handles ticket room creation.
 */
async function handleTicketCreate(interaction) {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  const member = interaction.member;

  // 1. Check if category is configured
  const categoryId = config.discord.ticketCategoryId;
  if (!categoryId) {
    return interaction.editReply('Buset dah, category ID untuk tiket belum disetting admin. Hubungi admin gih.');
  }

  // 2. Setup permissions overrides
  const adminRoleId = config.discord.adminRoleId;
  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionFlagsBits.ViewChannel]
    },
    {
      id: member.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    }
  ];

  // 3. Find all roles with Administrator permission and grant them access automatically
  const adminRoles = guild.roles.cache.filter(role => 
    role.permissions.has(PermissionFlagsBits.Administrator)
  );

  adminRoles.forEach(role => {
    permissionOverwrites.push({
      id: role.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    });
  });

  // Also include the specific config role if defined (e.g. for custom moderator roles without Admin power)
  if (adminRoleId && !permissionOverwrites.some(po => po.id === adminRoleId)) {
    permissionOverwrites.push({
      id: adminRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    });
  }

  // 3. Create private channel
  const channelName = `tiket-${member.user.username.toLowerCase()}`;
  try {
    const channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: categoryId,
      permissionOverwrites
    });

    // 4. Save ticket to database
    const ticket = await prisma.ticket.create({
      data: {
        discordChanId: channel.id,
        creatorId: member.id,
        creatorName: member.user.username,
        status: 'OPEN'
      }
    });

    // 5. Determine Language Mode (Check if user has under 15 role)
    const hasUnderageRole = member.roles.cache.some(role => 
      role.name.includes('<15') || role.name.toLowerCase().includes('under-15')
    );
    if (hasUnderageRole) {
      await prisma.userPreference.upsert({
        where: { userId: member.id },
        update: { allowHarshSlang: false },
        create: { userId: member.id, allowHarshSlang: false }
      });
    }

    const allowHarsh = !hasUnderageRole;

    // 6. Send welcome embed in ticket channel
    const welcomeTitle = config.ticketWelcomeTitle || '✨ TIKET JOKI BERHASIL DIBUKA ✨';
    const welcomeDescTemplate = config.ticketWelcomeDesc || '';
    const welcomeDesc = welcomeDescTemplate.replace(/{username}/g, member.user.username);

    const welcomeEmbed = new EmbedBuilder()
      .setTitle(welcomeTitle)
      .setDescription(welcomeDesc)
      .setColor(0x7f5fff) // Cool purple-cyan accent
      .setTimestamp();

    const closeButton = new ButtonBuilder()
      .setCustomId('close_ticket')
      .setLabel('Tutup Tiket 🔒')
      .setStyle(ButtonStyle.Secondary);

    const rowClose = new ActionRowBuilder().addComponents(closeButton);

    // Send Message 1: Welcome Embed
    await channel.send({ content: `<@${member.id}>`, embeds: [welcomeEmbed], components: [rowClose] });

    // Send Message 2: Greeting Text
    const greetingTemplate = config.ticketGreetingText || 'Yo <@{userId}>! Gua Mia, helper joki Blox Fruit di sini. Ada kebutuhan joki apa nih atau ada yang bisa gua bantu buat info game? Spil aja lah bro!';
    const greetingText = greetingTemplate
      .replace(/{userId}/g, member.id)
      .replace(/{username}/g, member.user.username);

    const connectAdminBtn = new ButtonBuilder()
      .setCustomId('connect_admin')
      .setLabel('Hubungkan langsung dengan Admin')
      .setStyle(ButtonStyle.Primary);

    const rowConnect = new ActionRowBuilder().addComponents(connectAdminBtn);

    await channel.send({ content: greetingText, components: [rowConnect] });

    await interaction.editReply(`Tiket berhasil dibuka di <#${channel.id}>, bro!`);

  } catch (error) {
    console.error('Error creating ticket channel:', error);
    await interaction.editReply('Gagal bikin channel tiket anjir, cek permission bot lo.');
  }
}

/**
 * Handles ticket closing, saves HTML transcript.
 */
async function handleTicketClose(interaction, ticket) {
  const channel = interaction.channel;

  // If ticket is already CLOSED, show delete confirmation instead of double-locking
  if (ticket.status === 'CLOSED') {
    const deleteBtn = new ButtonBuilder()
      .setCustomId('delete_ticket_confirm')
      .setLabel('Hapus Tiket 🗑️')
      .setStyle(ButtonStyle.Danger);

    const cancelBtn = new ButtonBuilder()
      .setCustomId('delete_ticket_cancel')
      .setLabel('Batal ❌')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(deleteBtn, cancelBtn);

    return interaction.reply({
      content: '⚠️ **Tiket ini sudah ditutup & dikunci.** Mau hapus channel tiket ini secara permanen?',
      components: [row]
    });
  }

  await interaction.reply({ content: 'Sedang memproses penutupan dan mengunci tiket...' });

  try {
    // 1. Rename the channel to Closed state (e.g. 🔒-username)
    const currentName = channel.name;
    const newName = `🔒-${currentName.replace('tiket-', '')}`;
    await channel.setName(newName).catch(err => console.error("Gagal ganti nama channel joki:", err.message));

    // 2. Modify permission overwrites to lock the channel
    const overwrites = [
      {
        id: interaction.guild.roles.everyone.id,
        deny: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
      }
    ];

    // Allow Admin Role from config if configured
    const adminRoleId = config.discord.adminRoleId;
    if (adminRoleId) {
      overwrites.push({
        id: adminRoleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
      });
    }

    // Allow Custom Closed Ticket Viewer Roles configured in dashboard
    const closedRoles = (config.discordClosedTicketRoleId || '')
      .split(',')
      .map(r => r.trim())
      .filter(Boolean);

    for (const roleId of closedRoles) {
      if (roleId === adminRoleId) continue;
      overwrites.push({
        id: roleId,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
      });
    }

    // Ensure Administrators always have access
    const adminRoles = interaction.guild.roles.cache.filter(role => 
      role.permissions.has(PermissionFlagsBits.Administrator)
    );
    adminRoles.forEach(role => {
      if (!overwrites.some(o => o.id === role.id)) {
        overwrites.push({
          id: role.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
          deny: [PermissionFlagsBits.SendMessages, PermissionFlagsBits.AddReactions]
        });
      }
    });

    await channel.permissionOverwrites.set(overwrites);

    // 3. Format Close message
    const closeTextTemplate = config.ticketCloseText || 'Tiket joki kamu telah ditutup oleh {closedBy}. Makasih banyak sudah order jasa joki di Mia!';
    const closeMsg = closeTextTemplate.replace(/{closedBy}/g, interaction.user.username);

    // 4. Send message in the channel itself
    await channel.send(`🔒 **Tiket dikunci.**\n${closeMsg}`);

    // 5. Send DM to ticket creator
    const creatorUser = await interaction.client.users.fetch(ticket.creatorId).catch(() => null);
    if (creatorUser) {
      await creatorUser.send(closeMsg).catch(() => null);
    }

    // 6. Send log to staff channel
    const staffChannelId = config.discord.staffChannelId;
    if (staffChannelId) {
      const logsChan = await interaction.guild.channels.fetch(staffChannelId).catch(() => null);
      if (logsChan) {
        await logsChan.send(`🔒 **Tiket ${currentName} telah ditutup & dikunci**\nDibuka oleh: <@${ticket.creatorId}> | Ditutup oleh: <@${interaction.user.id}>\n"${closeMsg}"`);
      }
    }

    // 7. Update ticket status in DB to CLOSED (do NOT delete)
    await prisma.ticket.update({
      where: { id: ticket.id },
      data: { status: 'CLOSED' }
    });

    await interaction.followUp('Tiket berhasil ditutup dan channel telah dikunci.');

  } catch (error) {
    console.error('Error closing ticket:', error);
    await interaction.followUp('Gagal menutup/mengunci tiket, cek console log bot.');
  }
}

module.exports = {
  createTicketPanelEmbed,
  handleTicketCreate,
  handleTicketClose,
  parseLastOrderFormat
};
