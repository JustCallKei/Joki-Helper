const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // 1. Config Defaults
  const defaultConfig = [
    { key: 'discord_token', value: '' },
    { key: 'discord_guild_id', value: '' },
    { key: 'discord_ticket_category_id', value: '' },
    { key: 'discord_admin_role_id', value: '' },
    { key: 'discord_staff_channel_id', value: '' },
    { key: 'whatsapp_autoreply', value: 'true' },
    { key: 'whatsapp_autoreply_text', value: 'Halo bro! Sorry banget, admin lagi sibuk/slow respon nih. Tapi santai aja, gue Mia yang bakal bantuin lo. Ada yang bisa gue bantu soal syarat joki atau harga?' },
    { key: 'gemini_api_key', value: '' },
    { key: 'gemini_model', value: 'gemini-1.5-flash' },
    { key: 'ticket_greeting_text', value: 'Yo <@{userId}>! Gua Mia, helper joki Blox Fruit di sini. Ada kebutuhan joki apa nih atau ada yang bisa gua bantu buat info game? Spil aja lah bro!' }
  ];

  for (const item of defaultConfig) {
    await prisma.config.upsert({
      where: { key: item.key },
      update: {},
      create: item
    });
  }

  // 2. Default Price Items
  const defaultPriceItems = [
    {
      name: 'Joki Leveling (Per 100 Level)',
      type: 'LEVELING',
      basePrice: 5000,
      requirements: JSON.stringify([]),
      description: 'Jasa leveling per 100 level.'
    },
    {
      name: 'Godhuman',
      type: 'ITEM',
      basePrice: 75000,
      requirements: JSON.stringify([
        'Level 1500+',
        'Mastery 400 Dragon Talon',
        'Mastery 400 Electric Claw',
        'Mastery 400 Death Step',
        'Mastery 400 Sharkman Karate',
        'Mastery 400 Superhuman',
        '20 Dragon Scales',
        '20 Mystic Droplets',
        '10 Cocoa Powder',
        '10 Demonic Souls',
        '5,000,000 Beli'
      ]),
      description: 'Fighting style terkuat, butuh bahan & mastery semua style sebelumnya.'
    },
    {
      name: 'Cursed Dual Katana (CDK)',
      type: 'ITEM',
      basePrice: 120000,
      requirements: JSON.stringify([
        'Level 2200+',
        'Mastery 350 Yama',
        'Mastery 350 Tushita',
        'Alchemist scroll quest',
        'Dock scroll quest'
      ]),
      description: 'Dual sword legendaris perpaduan Yama dan Tushita.'
    },
    {
      name: 'Soul Guitar',
      type: 'ITEM',
      basePrice: 50000,
      requirements: JSON.stringify([
        'Level 2300+',
        'Weird Machine quest saat Full Moon',
        '500 Bones',
        '250 Ectoplasm',
        '1 Dark Fragment',
        '5,000 Fragments'
      ]),
      description: 'Gun legendaris kelas Mythical.'
    },
    {
      name: 'Sanguine Art',
      type: 'ITEM',
      basePrice: 80000,
      requirements: JSON.stringify([
        'Level 1500+',
        'Leviathan Heart',
        '5,000 Fragments',
        '5,000,000 Beli'
      ]),
      description: 'Fighting style vampiric di Sea 3.'
    },
    {
      name: 'Shark Anchor',
      type: 'ITEM',
      basePrice: 45000,
      requirements: JSON.stringify([
        'Level 1500+',
        'Monster Magnet',
        'Defeat TerrorShark (Anchor drop)'
      ]),
      description: 'Pedang jangkar besar dari TerrorShark.'
    },
    {
      name: 'Normal Raid (Per Run)',
      type: 'RAID',
      basePrice: 5000,
      requirements: JSON.stringify(['Level 1100+']),
      description: 'Bantu raid normal (Flame, Ice, Buddha, dll) untuk fragments/awakening.'
    },
    {
      name: 'Advanced Raid (Dough/Phoenix - Per Run)',
      type: 'RAID',
      basePrice: 15000,
      requirements: JSON.stringify(['Level 1100+', 'Raid unlocked']),
      description: 'Bantu raid advanced untuk awakening Dough atau Phoenix.'
    },
    {
      name: 'Full Awakening (Normal Fruit)',
      type: 'AWAKENING',
      basePrice: 30000,
      requirements: JSON.stringify(['Level 1100+', '14,500 Fragments']),
      description: 'Awaken semua jurus buah iblis tipe normal.'
    },
    {
      name: 'Full Awakening (Dough/Phoenix)',
      type: 'AWAKENING',
      basePrice: 75000,
      requirements: JSON.stringify(['Level 1100+', '18,500 Fragments']),
      description: 'Awaken semua jurus buah iblis Dough atau Phoenix.'
    }
  ];

  for (const item of defaultPriceItems) {
    await prisma.priceItem.upsert({
      where: { name: item.name },
      update: {
        basePrice: item.basePrice,
        requirements: item.requirements,
        description: item.description
      },
      create: item
    });
  }

  console.log('Database seeded successfully!');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
