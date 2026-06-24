const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function runDiagnostics() {
  console.log('=== GEMINI API DIAGNOSTICS ===');
  
  // 1. Load config
  let apiKey = process.env.GEMINI_API_KEY;
  try {
    const dbConfig = await prisma.config.findUnique({ where: { key: 'gemini_api_key' } });
    if (dbConfig && dbConfig.value) {
      apiKey = dbConfig.value;
    }
  } catch (e) {}

  if (!apiKey) {
    console.error('❌ Error: API Key tidak ditemukan. Pastikan sudah diisi di .env atau di dashboard.');
    process.exit(1);
  }

  console.log(`🔑 API Key detected: ${apiKey.substring(0, 6)}...${apiKey.substring(apiKey.length - 4)}`);

  // 2. Test standard connection using v1 endpoint
  console.log('\n--- Test 1: Mencoba koneksi dengan endpoint v1 (Stable) ---');
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    // Explicitly request v1 endpoint if supported by SDK options
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }, { apiVersion: 'v1' });
    const result = await model.generateContent('Say hello back in Indonesian in one short word.');
    console.log('✅ Sukses koneksi v1! Respon AI:', result.response.text().trim());
  } catch (err) {
    console.error('❌ Gagal koneksi v1:', err.message);
  }

  // 3. Test connection using default SDK endpoint (v1beta)
  console.log('\n--- Test 2: Mencoba koneksi dengan endpoint default SDK (v1beta) ---');
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
    const result = await model.generateContent('Say hello back in Indonesian in one short word.');
    console.log('✅ Sukses koneksi v1beta! Respon AI:', result.response.text().trim());
  } catch (err) {
    console.error('❌ Gagal koneksi v1beta:', err.message);
    
    if (err.message.includes('404')) {
      console.log('\n💡 ANALISIS ERROR 404:');
      console.log('Kemungkinan besar kamu membuat API Key melalui Google Cloud Console (GCP) bukannya Google AI Studio.');
      console.log('API Key dari GCP memerlukan aktivasi manual "Generative Language API" di halaman library API Google Cloud.');
      console.log('\nSOLUSI MUDAH:');
      console.log('1. Buka https://aistudio.google.com/');
      console.log('2. Login dengan akun Google-mu.');
      console.log('3. Klik tombol "Get API key" di bagian kiri atas.');
      console.log('4. Buat kunci baru, lalu salin dan masukkan ke dalam dashboard bot kamu.');
    }
  }
}

runDiagnostics().catch(console.error);
