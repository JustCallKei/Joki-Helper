# Arsitektur AI Helper Joko (Mia)

Dokumen ini menjelaskan alur kerja, logika internal, dan arsitektur model AI yang mengendalikan asisten "Mia" dalam proyek Helper Joko. Tujuannya adalah untuk memastikan pengembangan selanjutnya (termasuk penambahan fitur dan prompt injection defense) tetap selaras dengan pondasi yang sudah ada.

## 1. Komponen Utama
Arsitektur AI dibagi menjadi beberapa modul utama di dalam direktori `src/ai/`:

- **`gemini.js`**: Core engine untuk pemrosesan teks. Menangani koneksi dengan Google Gemini API, merakit *System Instructions*, dan mengeksekusi fungsi/tool calls yang dipicu oleh model AI.
- **`memoryManager.js`**: Sistem manajemen memori jangka pendek dan menengah. Bertugas memastikan batas maksimal token chat tidak tercapai dengan cara memadatkan (summarize) konteks lama, namun tetap mempertahankan detail krusial.
- **`blox_fruit_kb.json`**: *Knowledge Base* (KB). Basis pengetahuan statis yang bertindak sebagai *ground truth* untuk harga, syarat item, wilayah (sea), dan level di game Blox Fruits. Model diinstruksikan untuk selalu memprioritaskan data dari KB ini.

## 2. Alur Kerja (Workflow) Pemrosesan Chat

1. **Penerimaan Pesan**: Pesan masuk (dari Discord atau WhatsApp) ditangkap oleh event listener masing-masing platform.
2. **Pengambilan Memori**: `memoryManager.js` dipanggil untuk mengambil riwayat percakapan sebelumnya terkait User ID tersebut.
3. **Penyusunan Prompt Sistem**: `gemini.js` merakit *System Instruction*. Instruksi sistem dibangun secara dinamis berdasarkan konfigurasi:
   - **Gaya Bahasa**: Diambil dari konfigurasi sistem (misalnya: *kasar*, *softspoken*, *tsundere*).
   - **Aturan Dasar**: Menyertakan identitas (Mia), instruksi menolak pertanyaan di luar topik joki Blox Fruits, format harga (Rp), dsb.
   - **Referensi KB**: Teks dari `blox_fruit_kb.json` disematkan ke dalam prompt.
4. **Pemanggilan Gemini API**: Pesan user dan riwayat chat dikirimkan ke model Gemini beserta definisi fungsi (Tools).
5. **Tool Calling (Jika Ada)**: Jika Gemini mendeteksi bahwa user meminta perhitungan harga, ia akan merespons dengan panggilan fungsi (misal: `calculateJockeyPrice`).
   - Node.js mengeksekusi perhitungan nyata via `src/utils/jockeyCalculator.js`.
   - Hasil perhitungan dikembalikan lagi ke model Gemini untuk diubah menjadi narasi balasan ke user.
6. **Respons & Penyimpanan**: AI merespons dengan teks bahasa natural. Riwayat chat (pesan user & respons bot) disimpan kembali ke memori menggunakan `memoryManager.js`.

## 3. Sistem "Universal Thinking Logic" (Kalkulator Joki)

Logika penentuan harga tidak diserahkan sepenuhnya ke LLM karena model rentan mengalami halusinasi matematika. Oleh karena itu, kita memisahkan **pemahaman intent** dan **kalkulasi matematis**:
- **`src/utils/jockeyCalculator.js`**: Melakukan perhitungan deterministik murni menggunakan JavaScript.
- AI hanya bertugas mengekstraksi **apa yang diinginkan** oleh user, mencocokkannya dengan `blox_fruit_kb.json`, lalu mengirim parameter tersebut ke kalkulator.

## 4. Key Rotation System

Karena menggunakan API gratisan yang memiliki batasan rate-limit, `src/utils/geminiKeyManager.js` memegang sekumpulan API Key. Jika satu key gagal karena limit token (kode status 429), manager otomatis memutar dan menggunakan key berikutnya yang tersedia.

## 5. Security & Prompt Injection
Prompt disetel agar kebal terhadap upaya bypass harga. Instruksi secara eksplisit melarang Mia mengubah harga, memberikan diskon, atau memberikan item secara gratis jika tidak ada dalam instruksi sistem.
