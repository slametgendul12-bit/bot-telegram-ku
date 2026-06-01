const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');

const token = '8714507910:AAGU5B28IRZe1gxUSUNrJ76UhQtIluzwVBs';
const mongoUri = 'mongodb+srv://erenluxx:eren1212@cluster0.ccwzvj2.mongodb.net/?appName=Cluster0';

const bot = new TelegramBot(token);
const app = express();

app.use(cors());
app.use(express.json());

let db, collection;

async function connectDB() {
    if (collection) return;
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

// 1. WEBHOOK TELEGRAM
app.post('/api/webhook', async (req, res) => {
    try {
        const msg = req.body.message || req.body.callback_query?.message;
        await connectDB();
        
        if (msg) {
            const chatId = msg.chat.id.toString();
            const userId = msg.from.id.toString();
            const name = msg.from.first_name;
            const username = msg.from.username ? `@${msg.from.username}` : "-";
            
            const now = new Date();
            const lastMsgTime = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta', month: '2-digit', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });

            // Membuat "Kunci Tanggal" untuk buku harian (Format: YYYY-MM-DD)
            const year = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric' });
            const month = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta', month: '2-digit' });
            const day = now.toLocaleString('en-US', { timeZone: 'Asia/Jakarta', day: '2-digit' });
            const todayKey = `${year}-${month}-${day}`;

            // Perintah untuk menambah total pesan DAN pesan hari ini
            const incQuery = { msg: 1 };
            incQuery[`history.${todayKey}`] = 1;

            await collection.updateOne(
                { chatId: chatId, id: userId },
                { $inc: incQuery, $set: { name, username, last_msg: lastMsgTime } },
                { upsert: true }
            );
        }
        res.status(200).send('OK');
    } catch (error) {
        res.status(500).send("Error");
    }
});

// 2. API UNTUK DATA TABLE (DENGAN KALKULASI HISTORY)
app.get('/api/data', async (req, res) => {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const groupFilter = req.query.group || 'all';
    const timeFilter = req.query.time || 'all'; 
    const sortBy = req.query.sort || 'msg'; 

    await connectDB();

    let query = groupFilter !== 'all' ? { chatId: groupFilter } : {};
    let allData = await collection.find(query).toArray();

    // LOGIKA PERHITUNGAN JUMLAH PESAN BERDASARKAN RENTANG WAKTU
    if (timeFilter !== 'all') {
        const now = new Date();

        allData = allData.map(user => {
            let count = 0;
            // Jika user belum punya data history (pesan lama), anggap 0
            if (!user.history) return { ...user, msg: 0 }; 

            const daysToLookBack = timeFilter === 'today' ? 0 : (timeFilter === '7days' ? 6 : 27);

            // Loop untuk menjumlahkan pesan dari hari-hari yang diminta
            for (let i = 0; i <= daysToLookBack; i++) {
                const checkDate = new Date(now);
                checkDate.setDate(now.getDate() - i);

                const y = checkDate.toLocaleString('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric' });
                const m = checkDate.toLocaleString('en-US', { timeZone: 'Asia/Jakarta', month: '2-digit' });
                const d = checkDate.toLocaleString('en-US', { timeZone: 'Asia/Jakarta', day: '2-digit' });
                const key = `${y}-${m}-${d}`;

                if (user.history[key]) {
                    count += user.history[key];
                }
            }
            // Ubah tampilan jumlah pesan sesuai periode yang dipilih
            return { ...user, msg: count };
        });

        // Buang user yang jumlah pesannya 0 pada periode tersebut
        allData = allData.filter(user => user.msg > 0);
    }

    // LOGIKA PENGURUTAN (SORTING)
    if (sortBy === 'date') {
        allData.sort((a, b) => new Date(b.last_msg) - new Date(a.last_msg)); 
    } else {
        allData.sort((a, b) => b.msg - a.msg); 
    }

    // LOGIKA PAGINATION
    const total = allData.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const skip = (page - 1) * limit;
    const paginatedData = allData.slice(skip, skip + limit);

    res.json({ data: paginatedData, totalPages: totalPages, currentPage: page });
});

// 3. API UNTUK DROPDOWN GRUP
app.get('/api/groups', async (req, res) => {
    try {
        await connectDB();
        const chatIds = await collection.distinct('chatId');
        res.json(chatIds);
    } catch (error) {
        res.status(500).send({ error: "Gagal ambil daftar grup" });
    }
});

module.exports = app;