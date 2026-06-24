const templates = {
  bahasa: {
    harsh: "Mode kasar aktif, bro. Ngl, sekarang lo bakal dichat pake bahasa gaul TikTok gua. Don't cry ya anjir kalo kesindir, lol.",
    clean: "Mode bersih aktif. Sekarang gua bakal ngomong sopan santun kek anak rajin. Aman kok bro, no toxic-toxic club.",
    underage: "Buset dah, role lo masih bocil (<15) tapi mau aktifin mode kasar? Kagak bisa lah anjir, belajar yang bener dulu sana gih!"
  },
  calculator: {
    target_lower: "Lah kocak, level target lo malah lebih rendah dari level sekarang? Lo mau joki turun level apa gimana sih jir? Capek banget gua.",
    invalid_current: "Buset, level lo apaan dah? Kagak ada level se-gitu di Blox Fruit anjir. Literally ngaco banget.",
    invalid_target: "Target level lo kagak make sense. Max level itu 2550 ya bro, jangan ngadi-ngadi deh lo.",
    level_required: "Buset dah, lo minta {item} tapi level lo masih {level}? Kagak bisa lah jir, minimal level {reqLevel} dulu baru bisa. Mau sekalian joki level kagak bro? Biar langsung digas.",
    max_reached: "Gila lo ya, level lo udah max atau target lo udah tercapai. Mau joki apa lagi dah?"
  },
  ticket: {
    panel_title: "🎫 BUKA TIKET JOKI DI SINI BRO! 🎫",
    panel_description: "━━━━━━━ 🎀 CARA ORDER 🎀 ━━━━━━━\n\n♥ Klik tombol di bawah buat bikin tiket joki lo.\n♥ Nanti Mia yang bakal bantu jawab syarat & hitung harga sementara nunggu admin bales.\n♥ Jangan nge-spam, jangan ngetroll admin, literally be patient bro.",
    welcome: "Yo bro! Tiket lo udah kebuka nih. Kenalin, gua Mia yang bakal bantuin lo. Lo mau joki apaan? Leveling, cari sword, atau raid? Tulis aja, ntar gua bantu hitung harganya, ngl.",
    close: "Dah lah, tiket lo gua close ya. Ini file transkrip chat lo biar kagak ilang. Makasih udah order di joki gua, bro! Ditunggu next ordernya, anjir.",
    unauthorized: "Kagak bisa bro, ini command khusus staff/admin doang. Ngl, lo cari masalah ya, lol."
  }
};

// Safe/Polite fallback templates for when allowHarsh is false
const cleanFallbacks = {
  bahasa: {
    harsh: "Mode bahasa gaul telah diaktifkan. Saya akan merespons menggunakan bahasa yang lebih santai.",
    clean: "Mode ramah-sopan telah diaktifkan. Saya akan berbicara dengan sopan dan menghindari kata-kata gaul kasar.",
    underage: "Maaf, role akun Anda masih di bawah 15 tahun (<15), jadi Anda tidak diperbolehkan mengaktifkan mode bahasa gaul kasar."
  },
  calculator: {
    target_lower: "Maaf kak, target level yang Anda masukkan lebih kecil dari level saat ini. Mohon masukkan target level yang benar ya.",
    invalid_current: "Mohon masukkan level saat ini yang valid (1 sampai 2550). Terima kasih.",
    invalid_target: "Target level tidak valid. Level maksimal di Blox Fruits adalah 2550 kak.",
    level_required: "Maaf kak, untuk memesan {item}, Anda harus mencapai level {reqLevel} terlebih dahulu. Level Anda saat ini baru {level}. Apakah ingin memesan paket joki level sekaligus?",
    max_reached: "Sepertinya target level Anda sudah tercapai kak. Ada jasa joki lain yang bisa dibantu?"
  },
  ticket: {
    panel_title: "🎫 DIENY LAYANAN TIKET JOKI 🎫",
    panel_description: "━━━━━━━ 🎀 CARA PEMESANAN 🎀 ━━━━━━━\n\n♥ Silakan klik tombol di bawah untuk membuka tiket joki Anda.\n♥ Mia akan membantu menjelaskan syarat & harga sambil menunggu respon admin.\n♥ Harap tidak melakukan spam di channel tiket ya kak. Terima kasih.",
    welcome: "Halo kak! Selamat datang di tiket joki. Saya Mia yang akan membantu Anda di sini. Ada yang bisa saya bantu? Silakan tuliskan jasa joki yang Anda inginkan (misal leveling, farming item, atau raid).",
    close: "Baik kak, tiket ini akan saya tutup ya. Berikut adalah lampiran transkrip obrolan Anda. Terima kasih banyak sudah memesan jasa kami!",
    unauthorized: "Maaf, perintah ini hanya dapat dijalankan oleh staff atau admin saja ya kak."
  }
};

function getTemplate(path, allowHarsh = true, variables = {}) {
  const [category, key] = path.split('.');
  const source = allowHarsh ? templates : cleanFallbacks;
  
  if (!source[category] || !source[category][key]) {
    return "";
  }
  
  let text = source[category][key];
  
  // Replace template variables like {item}
  for (const [vKey, vVal] of Object.entries(variables)) {
    text = text.replace(new RegExp(`{${vKey}}`, 'g'), vVal);
  }
  
  return text;
}

module.exports = {
  templates,
  cleanFallbacks,
  getTemplate
};
