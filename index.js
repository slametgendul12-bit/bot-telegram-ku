const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

// 1. ISI TOKEN DAN URL MONGODB-MU
const token = '8714507910:AAGU5B28IRZe1gxUSUNrJ76UhQtIluzwVBs';
const mongoUri = 'mongodb+srv://erenluxx:eren1212@cluster0.ccwzvj2.mongodb.net/?appName=Cluster0';

// PERHATIKAN: Kita hapus {polling: true} karena kita pakai Webhook sekarang
const bot = new TelegramBot(token);
const app = express();

app.use(cors());
app.use(express.json()); // Wajib agar bisa membaca kiriman data dari Telegram

let db, collection;

// Fungsi koneksi Database untuk Serverless Vercel
async function connectDB() {
    if (collection) return; // Kalau sudah konek, jangan konek lagi
    try {
        const client = new MongoClient(mongoUri);
        await client.connect();
        db = client.db('BotDatabase');
        collection = db.collection('ChatStats');
        console.log('✅ Database Terhubung!');
    } catch (error) {
        console.error('❌ Gagal konek DB:', error);
    }
}

// 2. JALUR WEBHOOK UNTUK TELEGRAM (PINTU MASUK PESAN)
app.post('/api/webhook', async (req, res) => {
    try {
        const msg = req.body.message || req.body.callback_query?.message;
        const callbackQuery = req.body.callback_query;

        await connectDB();
        if (!collection) {
            return res.status(500).send("DB Error");
        }

        // --- LOGIKA JIKA ADA TOMBOL YANG DIKLIK ---
        if (callbackQuery) {
            const chatIdPesan = callbackQuery.message.chat.id;
            const dataTombol = callbackQuery.data;

            if (dataTombol.startsWith('cek_')) {
                const targetGrupId = dataTombol.split('_')[1];
                const users = await collection.find({ chatId: targetGrupId }).sort({ msg: -1 }).limit(10).toArray();

                let reply = `📊 **Top 10 Pengirim Pesan (Grup ${targetGrupId}):**\n\n`;
                if (users.length > 0) {
                    users.forEach((u, i) => {
                        reply += `${i + 1}. ${u.name} (${u.username}) - **${u.msg} pesan**\n   └ Terakhir: ${u.last_msg}\n\n`;
                    });
                    await bot.sendMessage(chatIdPesan, reply, { parse_mode: 'Markdown' });
                } else {
                    await bot.sendMessage(chatIdPesan, "Maaf, data grup tidak ditemukan.");
                }
                await bot.answerCallbackQuery(callbackQuery.id);
            }
            // Memberi tahu Vercel bahwa tugas selesai
            return res.status(200).send('OK'); 
        }

        // --- LOGIKA PESAN MASUK & /STATS ---
        if (msg) {
            if (msg.chat.type === 'private' && !msg.text?.startsWith('/stats')) {
                return res.status(200).send('OK');
            }

            const chatId = msg.chat.id.toString();

            if (msg.text && msg.text.startsWith('/stats')) {
                const chatIds = await collection.distinct('chatId');
                const keyboardOptions = chatIds.map(idGrup => ([{ text: `📊 Cek Data Grup ${idGrup}`, callback_data: `cek_${idGrup}` }]));
                
                if (keyboardOptions.length === 0) {
                    await bot.sendMessage(chatId, "Belum ada data grup sama sekali di Cloud.");
                } else {
                    await bot.sendMessage(chatId, "Pilih grup mana yang ingin kamu cek statistiknya:", {
                        reply_markup: { inline_keyboard: keyboardOptions }
                    });
                }
                return res.status(200).send('OK');
            }

            // Simpan data pesan baru ke MongoDB
            const userId = msg.from.id.toString();
            const name = msg.from.first_name;
            const username = msg.from.username ? `@${msg.from.username}` : "-";
            const now = new Date();
            const lastMsgTime = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta', month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

            await collection.updateOne(
                { chatId: chatId, id: userId },
                { $inc: { msg: 1 }, $set: { name, username, last_msg: lastMsgTime } },
                { upsert: true }
            );
        }

        // Akhir dari segalanya, berikan lampu hijau ke Telegram dan Vercel
        res.status(200).send('OK');

    } catch (error) {
        console.error("Error di Webhook:", error);
        res.status(500).send("Terjadi Kesalahan");
    }
});

app.get('/api/data', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const groupFilter = req.query.group || 'all';
    
    // Parameter baru untuk waktu dan sorting
    const timeFilter = req.query.time || 'all'; 
    const sortBy = req.query.sort || 'msg'; 

    await connectDB();

    let query = {};
    if (groupFilter !== 'all') {
        query = { chatId: groupFilter };
    }

    // Ambil semua data untuk grup tersebut terlebih dahulu
    let allData = await collection.find(query).toArray();

    // 1. LOGIKA FILTER RENTANG WAKTU (DATE RANGE)
    if (timeFilter !== 'all') {
        const now = new Date();
        allData = allData.filter(user => {
            const lastMsgDate = new Date(user.last_msg);
            const diffDays = Math.ceil(Math.abs(now - lastMsgDate) / (1000 * 60 * 60 * 24));

            if (timeFilter === 'today') return diffDays <= 1;
            if (timeFilter === '7days') return diffDays <= 7;
            if (timeFilter === '4weeks') return diffDays <= 28;
            return true;
        });
    }

    // 2. LOGIKA PENGURUTAN (SORTING)
    if (sortBy === 'date') {
        // Urutkan berdasarkan waktu terbaru
        allData.sort((a, b) => new Date(b.last_msg) - new Date(a.last_msg)); 
    } else {
        // Urutkan berdasarkan jumlah pesan terbanyak
        allData.sort((a, b) => b.msg - a.msg); 
    }

    // 3. LOGIKA PAGINATION MANUAL
    const total = allData.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;
    
    // Potong data sesuai halaman yang diminta
    const paginatedData = allData.slice(skip, skip + limit);

    res.json({ data: paginatedData, totalPages: totalPages, currentPage: page });
});
// API TAMBAHAN: Untuk mengambil daftar grup unik agar dropdown tidak kosong
app.get('/api/groups', async (req, res) => {
    try {
        await connectDB();
        const chatIds = await collection.distinct('chatId');
        res.json(chatIds);
    } catch (error) {
        res.status(500).send({ error: "Gagal ambil daftar grup" });
    }
});
// WAJIB UNTUK VERCEL: Mengekspor aplikasi agar bisa dibaca Vercel
module.exports = app;