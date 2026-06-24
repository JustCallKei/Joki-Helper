const { REST, Routes, SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { config } = require('../config');
const { prisma } = require('../database');
const { calculateJockeyPrice } = require('../utils/jockeyCalculator');
const { getTemplate } = require('../ai/slangTemplates');
const { handleTicketClose, createTicketPanelEmbed, parseLastOrderFormat } = require('./ticketManager');
const path = require('path');
const fs = require('fs');

// Define Slash Command Builders
const commandsList = [
  new SlashCommandBuilder()
    .setName('setup-panel')
    .setDescription('Kirim panel tombol buka tiket (Khusus Admin/Staff).')
    .addStringOption(opt =>
      opt.setName('judul')
        .setDescription('Judul panel tiket (contoh: 🎫 BUKA TIKET JOKI 🎫)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('deskripsi')
        .setDescription('Isi deskripsi panel joki. Gunakan \\n untuk pindah baris.')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('warna')
        .setDescription('Warna panel hex (contoh: ff75a0 untuk pink, 0d9488 untuk teal)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('label_tombol')
        .setDescription('Tulisan tombol joki (contoh: Buka Tiket 🎫)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('banner_url')
        .setDescription('Link URL gambar banner untuk dipasang di dalam embed')
        .setRequired(false)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),

  new SlashCommandBuilder()
    .setName('hitung-joki')
    .setDescription('Kalkulator manual joki Blox Fruits (Khusus Staff/Worker).')
    .addIntegerOption(opt =>
      opt.setName('level_sekarang')
        .setDescription('Level akun saat ini (1-2550)')
        .setRequired(true)
    )
    .addIntegerOption(opt =>
      opt.setName('level_target')
        .setDescription('Target level setelah joki (1-2550)')
        .setRequired(false)
    )
    .addStringOption(opt =>
      opt.setName('items')
        .setDescription('Nama item joki, dipisah koma (contoh: Godhuman, Soul Guitar)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('bahasa')
    .setDescription('Aktifkan atau nonaktifkan kata gaul kasar Mia.')
    .addBooleanOption(opt =>
      opt.setName('kasar_aktif')
        .setDescription('Gunakan true untuk mode gaul kasar, false untuk mode bersih')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('close')
    .setDescription('Tutup tiket aktif ini dan simpan log chat.'),

  new SlashCommandBuilder()
    .setName('terima')
    .setDescription('Admin: Terima order joki dan buat status tracker.')
    .addStringOption(opt => opt.setName('nama_joki').setDescription('Nama pesanan joki').setRequired(true))
    .addIntegerOption(opt => opt.setName('harga').setDescription('Total harga (Rp)').setRequired(true))
    .addUserOption(opt => opt.setName('penjoki').setDescription('Worker yang bertugas (opsional)'))
    .addStringOption(opt => opt.setName('detail').setDescription('Detail tambahan (opsional)')),

  new SlashCommandBuilder()
    .setName('take')
    .setDescription('Admin: Ambil order joki di tiket ini secara otomatis dari format pesan.'),

  new SlashCommandBuilder()
    .setName('payment')
    .setDescription('Admin: Kirim format pembayaran & QRIS.')
    .addIntegerOption(opt => opt.setName('total').setDescription('Total tagihan (Rp)').setRequired(true)),

  new SlashCommandBuilder()
    .setName('done')
    .setDescription('Admin: Tandai order joki di tiket ini selesai.'),

  new SlashCommandBuilder()
    .setName('cancel')
    .setDescription('Admin: Batalkan order joki di tiket ini.'),

  new SlashCommandBuilder()
    .setName('payment-done')
    .setDescription('Admin: Tandai pembayaran order joki sudah lunas.')
];

/**
 * Registers slash commands with the Discord REST API.
 */
async function registerSlashCommands(client) {
  if (!config.discord.token || !config.discord.guildId) {
    console.log('Discord Token atau Guild ID kosong. Skip deploy slash commands.');
    return;
  }

  const rest = new REST({ version: '10' }).setToken(config.discord.token);
  try {
    console.log('Deploying slash commands to guild...');
    await rest.put(
      Routes.applicationGuildCommands(client.user.id, config.discord.guildId),
      { body: commandsList.map(cmd => cmd.toJSON()) }
    );
    console.log('Slash commands deployed successfully!');
  } catch (error) {
    console.error('Error deploying slash commands:', error);
  }
}

/**
 * Handles incoming Slash Command Interactions.
 */
async function handleSlashCommand(interaction) {
  const { commandName, user, guild, member } = interaction;

  // 1. Setup Panel command
  if (commandName === 'setup-panel') {
    const adminRoleId = config.discord.adminRoleId;
    const isStaff = member.permissions.has(PermissionFlagsBits.Administrator) ||
      (adminRoleId && member.roles.cache.has(adminRoleId));

    if (!isStaff) {
      const authError = getTemplate('ticket.unauthorized', true);
      return interaction.reply({ content: authError, ephemeral: true });
    }

    const judul = interaction.options.getString('judul');
    const rawDesc = interaction.options.getString('deskripsi') || '';
    const deskripsi = rawDesc ? rawDesc.replace(/\\n/g, '\n') : null;
    const warnaHex = interaction.options.getString('warna');
    const labelTombol = interaction.options.getString('label_tombol');
    const bannerUrl = interaction.options.getString('banner_url');

    let warna = 0xff75a0; // default pink
    if (warnaHex) {
      const cleanHex = warnaHex.replace('#', '').trim();
      const parsedColor = parseInt(cleanHex, 16);
      if (!isNaN(parsedColor)) warna = parsedColor;
    }

    const panelData = createTicketPanelEmbed(judul, deskripsi, warna, labelTombol, bannerUrl);
    await interaction.channel.send(panelData);
    return interaction.reply({ content: 'Panel tiket berhasil dideploy di channel ini, bro!', ephemeral: true });
  }

  // 2. Bahasa command (Toggle toxic filter)
  if (commandName === 'bahasa') {
    const kasarAktif = interaction.options.getBoolean('kasar_aktif');

    // Check age verification role (role <15)
    const hasUnderageRole = member.roles.cache.some(role =>
      role.name.includes('<15') || role.name.toLowerCase().includes('under-15')
    );

    if (hasUnderageRole && kasarAktif) {
      const blockMsg = getTemplate('bahasa.underage', true);
      return interaction.reply({ content: blockMsg, ephemeral: true });
    }

    // Update DB Preference
    await prisma.userPreference.upsert({
      where: { userId: user.id },
      update: { allowHarshSlang: kasarAktif },
      create: { userId: user.id, allowHarshSlang: kasarAktif }
    });

    const replyMsg = getTemplate(kasarAktif ? 'bahasa.harsh' : 'bahasa.clean', kasarAktif);
    return interaction.reply({ content: replyMsg, ephemeral: true });
  }

  // 3. Calculator command (restricted to staff)
  if (commandName === 'hitung-joki') {
    const adminRoleId = config.discord.adminRoleId;
    const isStaff = member.permissions.has(PermissionFlagsBits.Administrator) ||
      (adminRoleId && member.roles.cache.has(adminRoleId)) ||
      (interaction.channel.id === config.discord.staffChannelId);

    if (!isStaff) {
      const authError = getTemplate('ticket.unauthorized', true);
      return interaction.reply({ content: authError, ephemeral: true });
    }

    await interaction.deferReply();

    const currentLvl = interaction.options.getInteger('level_sekarang');
    const targetLvl = interaction.options.getInteger('level_target');
    const itemsRaw = interaction.options.getString('items') || '';

    const selectedItems = itemsRaw
      .split(',')
      .map(i => i.trim())
      .filter(i => i.length > 0);

    try {
      const calcResult = await calculateJockeyPrice(currentLvl, targetLvl, selectedItems);

      let replyContent = `**🧮 HASIL PERHITUNGAN JOKI**\n`;
      replyContent += `━━━━━━━━━━━━━━━━━━━━\n`;
      replyContent += `👤 **User**: <@${interaction.user.id}>\n`;
      replyContent += `🎮 **Level**: ${calcResult.currentLevel} ➔ ${calcResult.effectiveTargetLevel || calcResult.targetLevel || calcResult.currentLevel}\n`;

      if (calcResult.items.length > 0) {
        replyContent += `⚔️ **Farming Items**:\n`;
        calcResult.items.forEach(item => {
          const itemPrice = item.itemTotal ?? item.price ?? 0;
          replyContent += `  • ${item.name}: Rp ${itemPrice.toLocaleString('id-ID')}\n`;
        });
      }

      if (calcResult.prerequisites && calcResult.prerequisites.length > 0) {
        replyContent += `⚠️ **Syarat Tambahan**:\n`;
        calcResult.prerequisites.forEach(req => {
          replyContent += `  • ${req.name}: Rp ${(req.price || 0).toLocaleString('id-ID')}\n`;
        });
      }

      if (calcResult.leveling && calcResult.leveling.total > 0) {
        replyContent += `⚡ **Biaya Leveling**: Rp ${calcResult.leveling.total.toLocaleString('id-ID')}\n`;
      }

      replyContent += `━━━━━━━━━━━━━━━━━━━━\n`;
      replyContent += `💰 **TOTAL BIAYA**: **Rp ${calcResult.totalPrice.toLocaleString('id-ID')}**\n`;
      replyContent += `━━━━━━━━━━━━━━━━━━━━`;

      return interaction.editReply(replyContent);
    } catch (err) {
      let errorSlang = 'Gagal menghitung harga joki, anjir. Terjadi error.';
      if (err.message === 'target_lower') errorSlang = getTemplate('calculator.target_lower', true);
      if (err.message === 'invalid_current') errorSlang = getTemplate('calculator.invalid_current', true);
      if (err.message === 'invalid_target') errorSlang = getTemplate('calculator.invalid_target', true);

      return interaction.editReply(errorSlang);
    }
  }

  // 4. Close ticket command
  if (commandName === 'close') {
    const ticket = await prisma.ticket.findUnique({
      where: { discordChanId: interaction.channel.id }
    });

    if (!ticket) {
      return interaction.reply({ content: 'Buset, channel ini bukan channel tiket joki aktif, bro.', ephemeral: true });
    }

    await handleTicketClose(interaction, ticket);
  }

  // 5. /take Command
  if (commandName === 'take') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
      !(config.discord.adminRoleId && interaction.member.roles.cache.has(config.discord.adminRoleId))) {
      return interaction.reply({ content: 'Lu bukan admin bro.', ephemeral: true });
    }

    const ticket = await prisma.ticket.findUnique({ where: { discordChanId: interaction.channel.id } });
    if (!ticket) return interaction.reply({ content: 'Command ini harus dipakai di dalam channel tiket aktif.', ephemeral: true });

    await interaction.deferReply();

    try {
      // Check if there is already an active order in this channel
      const existingOrder = await prisma.jokiOrder.findFirst({
        where: { channelId: interaction.channel.id, status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] } }
      });
      if (existingOrder) {
        return interaction.editReply('❌ Sudah ada order joki aktif di tiket ini, bro. Selesaikan atau batalkan dulu orderan yang lama sebelum mengambil order baru.');
      }

      // Fetch last 50 messages from the channel and parse using shared helper
      const messages = await interaction.channel.messages.fetch({ limit: 50 });
      const parsedData = parseLastOrderFormat(messages);

      if (!parsedData) {
        return interaction.editReply('❌ Gak nemu format harga joki di chat log tiket ini, bro. Pastikan Mia udah kirim rincian harga jokinya dulu.');
      }

      const { namaJoki, price, detail } = parsedData;

      // Create DB record
      const order = await prisma.jokiOrder.create({
        data: {
          ticketId: ticket.id,
          channelId: interaction.channel.id,
          jokiName: namaJoki,
          detail: detail,
          price: price,
          buyerId: ticket.creatorId,
          buyerName: ticket.creatorName,
          workerId: interaction.user.id,
          workerName: interaction.user.username,
          status: 'ACCEPTED'
        }
      });

      // Send status embed to joki status channel
      if (config.discord.jokiStatusChannelId) {
        const statusChan = await interaction.guild.channels.fetch(config.discord.jokiStatusChannelId).catch(() => null);
        if (statusChan) {
          const embed = new EmbedBuilder()
            .setTitle(`Order Joki: ${namaJoki}`)
            .setColor(0x3b82f6) // Blue for ACCEPTED
            .addFields(
              { name: '👤 Pembeli', value: `<@${ticket.creatorId}>`, inline: true },
              { name: '⚔️ Penjoki', value: `<@${interaction.user.id}>`, inline: true },
              { name: '💰 Harga', value: `Rp ${price.toLocaleString('id-ID')}`, inline: true },
              { name: '📝 Detail', value: detail },
              { name: '📌 Status', value: 'ACCEPTED (Menunggu Pembayaran)' }
            )
            .setFooter({ text: `Order ID: ${order.id}` })
            .setTimestamp();

          const msg = await statusChan.send({ embeds: [embed] });
          await prisma.jokiOrder.update({ where: { id: order.id }, data: { statusMsgId: msg.id } });
        }
      }

      return interaction.editReply(`✅ Order **${namaJoki}** berhasil diambil oleh <@${interaction.user.id}> dengan harga **Rp ${price.toLocaleString('id-ID')}**! Silakan lanjut /payment.`);

    } catch (error) {
      console.error('Error in /take command:', error);
      return interaction.editReply('❌ Ada error pas mau nge-take orderan, bro.');
    }
  }

  // 6. /terima Command
  if (commandName === 'terima') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
      !(config.discord.adminRoleId && interaction.member.roles.cache.has(config.discord.adminRoleId))) {
      return interaction.reply({ content: 'Lu bukan admin bro.', ephemeral: true });
    }

    const ticket = await prisma.ticket.findUnique({ where: { discordChanId: interaction.channel.id } });
    if (!ticket) return interaction.reply({ content: 'Command ini harus dipakai di dalam channel tiket aktif.', ephemeral: true });

    await interaction.deferReply();

    const namaJoki = interaction.options.getString('nama_joki');
    const harga = interaction.options.getInteger('harga');
    const detail = interaction.options.getString('detail') || '-';
    const worker = interaction.options.getUser('penjoki') || interaction.user;

    // Create DB record
    const order = await prisma.jokiOrder.create({
      data: {
        ticketId: ticket.id,
        channelId: interaction.channel.id,
        jokiName: namaJoki,
        detail: detail,
        price: harga,
        buyerId: ticket.creatorId,
        buyerName: ticket.creatorName,
        workerId: worker.id,
        workerName: worker.username,
        status: 'ACCEPTED'
      }
    });

    // Send to status channel
    if (config.discord.jokiStatusChannelId) {
      const statusChan = await interaction.guild.channels.fetch(config.discord.jokiStatusChannelId).catch(() => null);
      if (statusChan) {
        const embed = new EmbedBuilder()
          .setTitle(`Order Joki: ${namaJoki}`)
          .setColor(0x3b82f6) // Blue for ACCEPTED
          .addFields(
            { name: '👤 Pembeli', value: `<@${ticket.creatorId}>`, inline: true },
            { name: '⚔️ Penjoki', value: `<@${worker.id}>`, inline: true },
            { name: '💰 Harga', value: `Rp ${harga.toLocaleString('id-ID')}`, inline: true },
            { name: '📝 Detail', value: detail },
            { name: '📌 Status', value: 'ACCEPTED (Menunggu Pembayaran)' }
          )
          .setFooter({ text: `Order ID: ${order.id}` })
          .setTimestamp();

        const msg = await statusChan.send({ embeds: [embed] });
        await prisma.jokiOrder.update({ where: { id: order.id }, data: { statusMsgId: msg.id } });
      }
    }

    return interaction.editReply(`✅ Order **${namaJoki}** berhasil diterima dan ditugaskan ke <@${worker.id}>. Silakan lanjut /payment.`);
  }

  // 7. /payment Command
  if (commandName === 'payment') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
      !(config.discord.adminRoleId && interaction.member.roles.cache.has(config.discord.adminRoleId))) {
      return interaction.reply({ content: 'Lu bukan admin bro.', ephemeral: true });
    }

    const total = interaction.options.getInteger('total');
    const qrisPath = config.qrisImagePath ? path.resolve(config.qrisImagePath) : null;

    let options = {
      content: `**TOTAL TAGIHAN: Rp ${total.toLocaleString('id-ID')}**\n\nSilakan scan QRIS di bawah ini untuk pembayaran. Jika sudah, kirim bukti transfer ya bro! 🙏`
    };

    if (qrisPath && fs.existsSync(qrisPath)) {
      const attachment = new AttachmentBuilder(qrisPath);
      options.files = [attachment];
    } else {
      options.content += `\n*(Note: Gambar QRIS belum di-upload di Dashboard)*`;
    }

    return interaction.reply(options);
  }

  // 8. /payment-done Command
  if (commandName === 'payment-done') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
      !(config.discord.adminRoleId && interaction.member.roles.cache.has(config.discord.adminRoleId))) {
      return interaction.reply({ content: 'Lu bukan admin bro.', ephemeral: true });
    }

    const ticket = await prisma.ticket.findUnique({ where: { discordChanId: interaction.channel.id } });
    if (!ticket) return interaction.reply({ content: 'Command ini harus dipakai di dalam channel tiket aktif.', ephemeral: true });

    await interaction.deferReply();

    try {
      // Fetch messages and parse order format
      const messages = await interaction.channel.messages.fetch({ limit: 50 });
      const parsedData = parseLastOrderFormat(messages);

      if (!parsedData) {
        return interaction.editReply('❌ Gak nemu format harga joki di chat log tiket ini.');
      }

      const { namaJoki, price, detail } = parsedData;

      // Check if an active order already exists for this channel
      let order = await prisma.jokiOrder.findFirst({
        where: { channelId: interaction.channel.id, status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] } },
        orderBy: { createdAt: 'desc' }
      });

      if (order) {
        // Update existing order
        order = await prisma.jokiOrder.update({
          where: { id: order.id },
          data: { status: 'IN_PROGRESS', paymentStatus: 'PAID' }
        });
      } else {
        // Create new order with IN_PROGRESS + PAID
        order = await prisma.jokiOrder.create({
          data: {
            ticketId: ticket.id,
            channelId: interaction.channel.id,
            jokiName: namaJoki,
            detail: detail,
            price: price,
            buyerId: ticket.creatorId,
            buyerName: ticket.creatorName,
            workerId: interaction.user.id,
            workerName: interaction.user.username,
            status: 'IN_PROGRESS',
            paymentStatus: 'PAID'
          }
        });
      }

      // Update or create status embed in joki status channel
      if (config.discord.jokiStatusChannelId) {
        const statusChan = await interaction.guild.channels.fetch(config.discord.jokiStatusChannelId).catch(() => null);
        if (statusChan) {
          const embed = new EmbedBuilder()
            .setTitle(`Order Joki: ${namaJoki}`)
            .setColor(0xf59e0b) // Amber for IN_PROGRESS
            .addFields(
              { name: '👤 Pembeli', value: `<@${ticket.creatorId}>`, inline: true },
              { name: '⚔️ Penjoki', value: order.workerId ? `<@${order.workerId}>` : 'Belum ditentukan', inline: true },
              { name: '💰 Harga', value: `Rp ${price.toLocaleString('id-ID')}`, inline: true },
              { name: '📝 Detail', value: detail },
              { name: '📌 Status', value: '✅ IN_PROGRESS (Sudah Bayar)' }
            )
            .setFooter({ text: `Order ID: ${order.id}` })
            .setTimestamp();

          // Try to edit existing status message, otherwise send new one
          if (order.statusMsgId) {
            const existingMsg = await statusChan.messages.fetch(order.statusMsgId).catch(() => null);
            if (existingMsg) {
              await existingMsg.edit({ embeds: [embed] });
            } else {
              const newMsg = await statusChan.send({ embeds: [embed] });
              await prisma.jokiOrder.update({ where: { id: order.id }, data: { statusMsgId: newMsg.id } });
            }
          } else {
            const newMsg = await statusChan.send({ embeds: [embed] });
            await prisma.jokiOrder.update({ where: { id: order.id }, data: { statusMsgId: newMsg.id } });
          }
        }
      }

      return interaction.editReply(`✅ Pembayaran **${namaJoki}** (Rp ${price.toLocaleString('id-ID')}) ditandai **LUNAS**! Status order diupdate ke IN_PROGRESS.`);

    } catch (error) {
      console.error('Error in /payment-done command:', error);
      return interaction.editReply('❌ Ada error pas mau update payment, bro.');
    }
  }

  // 9. /done & /cancel
  if (commandName === 'done' || commandName === 'cancel') {
    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator) &&
      !(config.discord.adminRoleId && interaction.member.roles.cache.has(config.discord.adminRoleId))) {
      return interaction.reply({ content: 'Lu bukan admin bro.', ephemeral: true });
    }

    await interaction.deferReply();

    // Find active order for this channel
    const order = await prisma.jokiOrder.findFirst({
      where: { channelId: interaction.channel.id, status: { in: ['PENDING', 'ACCEPTED', 'IN_PROGRESS'] } },
      orderBy: { createdAt: 'desc' }
    });

    if (!order) return interaction.editReply('Gak ada order joki aktif di tiket ini.');

    const newStatus = commandName === 'done' ? 'DONE' : 'CANCELLED';
    await prisma.jokiOrder.update({ where: { id: order.id }, data: { status: newStatus } });

    // Update status embed
    if (config.discord.jokiStatusChannelId && order.statusMsgId) {
      const statusChan = await interaction.guild.channels.fetch(config.discord.jokiStatusChannelId).catch(() => null);
      if (statusChan) {
        const msg = await statusChan.messages.fetch(order.statusMsgId).catch(() => null);
        if (msg && msg.embeds.length > 0) {
          const oldEmbed = msg.embeds[0];
          const newEmbed = EmbedBuilder.from(oldEmbed)
            .setColor(commandName === 'done' ? 0x10b981 : 0xef4444) // Green or Red
            .spliceFields(4, 1, { name: '📌 Status', value: commandName === 'done' ? '✅ DONE' : '❌ CANCELLED' });
          await msg.edit({ embeds: [newEmbed] });
        }
      }
    }

    return interaction.editReply(commandName === 'done' ? '✅ Order telah ditandai Selesai!' : '❌ Order dibatalkan.');
  }
}

module.exports = {
  registerSlashCommands,
  handleSlashCommand
};
