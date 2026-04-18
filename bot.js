require('dotenv').config();
const { Telegraf, session } = require('telegraf');
const axios = require('axios');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const express = require('express');

// -------------------- TELEGRAM BOT --------------------
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN topilmadi! .env faylga yozing.');
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);
bot.use(session());
bot.use((ctx, next) => {
    if (!ctx.session) ctx.session = {};
    return next();
});

const API_URL = 'https://b.kardioclinic.uz/userscha/address-a';
const DEFAULT_LIMIT = 10000;
const DEFAULT_ADDRESS = 'a';

// Paginatsiya bilan barcha foydalanuvchilarni yuklash (timeout 60 sek, retry 3 marta)
async function fetchAllUsersWithRetry(address = DEFAULT_ADDRESS, limit = DEFAULT_LIMIT, retries = 3) {
    let page = 1;
    let allUsers = [];
    let hasMore = true;

    while (hasMore) {
        let attempt = 0;
        let success = false;
        let users = [];

        while (attempt < retries && !success) {
            try {
                const response = await axios.get(API_URL, {
                    params: { page, limit, address },
                    timeout: 60000, // 60 sekund
                });
                users = response.data.users || [];
                success = true;
            } catch (error) {
                attempt++;
                console.error(`API xatosi (attempt ${attempt}/${retries}): ${error.message}`);
                if (attempt === retries) throw new Error(`Ma'lumotlarni yuklab bo‘lmadi: ${error.message}`);
                await new Promise(r => setTimeout(r, 2000)); // 2 sek kutish
            }
        }

        if (users.length === 0) break;

        allUsers = allUsers.concat(users);
        if (users.length < limit) {
            hasMore = false;
        } else {
            page++;
        }
    }
    return allUsers;
}

// Excel generatsiyasi
function generateExcel(users, filename = 'users.xlsx') {
    const worksheetData = users.map(u => ({
        ID: u.id,
        'To\'liq ism': u.full_name,
        'Telefon raqam': u.phone_number,
        'Tur': u.type || '',
        'Manzil': u.address || '',
        'Yaratilgan vaqt': u.createdAt,
        'Yangilangan vaqt': u.updatedAt,
    }));
    const worksheet = XLSX.utils.json_to_sheet(worksheetData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Users');
    const filePath = path.join(__dirname, filename);
    XLSX.writeFile(workbook, filePath);
    return filePath;
}

function getStatsByDate(users) {
    const dateCount = new Map();
    users.forEach(user => {
        const date = user.createdAt.split('T')[0];
        dateCount.set(date, (dateCount.get(date) || 0) + 1);
    });
    const sortedDates = Array.from(dateCount.keys()).sort();
    let statsText = `<b>📊 Umumiy statistika (manzil = a)</b>\n👥 Jami lidlar: ${users.length}\n\n<b>📅 Kunlik lidlar:</b>\n`;
    for (const date of sortedDates) {
        statsText += `• ${date}: ${dateCount.get(date)} ta\n`;
    }
    return statsText;
}

function filterUsersByDateRange(users, startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    return users.filter(user => {
        const createdAt = new Date(user.createdAt);
        return createdAt >= start && createdAt <= end;
    });
}

function isValidDate(dateStr) {
    return /^\d{4}-\d{2}-\d{2}$/.test(dateStr);
}

// Bot komandalari
bot.start(async (ctx) => {
    await ctx.reply(
        '👋 <b>Kardioklinik Botiga xush kelibsiz!</b>\n\n' +
        'Bot faqat <b>address = "a"</b> bo‘lgan foydalanuvchilarni ko‘rsatadi.\n\n' +
        'Quyidagi buyruqlar bilan ishlang:\n' +
        '/all_excel - Barcha “a” manzilli foydalanuvchilarni Excel fayl qilib yuklab olish\n' +
        '/all_stats - Barcha “a” manzilli lidlar bo‘yicha statistika (sanalar kesimida)\n' +
        '/date_stats - Sana oralig‘i bo‘yicha statistika va Excel olish\n' +
        '/cancel - Amalni bekor qilish',
        { parse_mode: 'HTML' }
    );
});

bot.command('all_excel', async (ctx) => {
    const msg = await ctx.reply('⏳ Maʼlumotlar yuklanmoqda, iltimos kuting...');
    try {
        const users = await fetchAllUsersWithRetry(DEFAULT_ADDRESS);
        if (!users.length) {
            await ctx.reply('Hech qanday foydalanuvchi topilmadi (address = a).');
            return;
        }
        const filePath = generateExcel(users, `all_users_a_${Date.now()}.xlsx`);
        await ctx.replyWithDocument({ source: filePath, filename: 'barcha_lidlar_a.xlsx' });
        fs.unlinkSync(filePath);
        await ctx.deleteMessage(msg.message_id);
    } catch (err) {
        console.error(err);
        await ctx.reply('❌ Xatolik yuz berdi: ' + err.message);
    }
});

bot.command('all_stats', async (ctx) => {
    const msg = await ctx.reply('⏳ Statistika tayyorlanmoqda...');
    try {
        const users = await fetchAllUsersWithRetry(DEFAULT_ADDRESS);
        if (!users.length) {
            await ctx.reply('Hech qanday foydalanuvchi yo‘q (address = a).');
            return;
        }
        const statsText = getStatsByDate(users);
        await ctx.reply(statsText, { parse_mode: 'HTML' });
        await ctx.deleteMessage(msg.message_id);
    } catch (err) {
        await ctx.reply('❌ Xatolik: ' + err.message);
    }
});

bot.command('date_stats', async (ctx) => {
    if (!ctx.session) ctx.session = {};
    ctx.session.waitingForDateRange = true;
    ctx.session.dateStep = 'start';
    await ctx.reply(
        '📅 <b>Sana oralig‘ini kiriting</b>\n\n' +
        'Boshlanish sanasini <code>YYYY-MM-DD</code> formatida yuboring.\n' +
        'Masalan: <code>2026-04-01</code>\n\n' +
        'Bekor qilish uchun /cancel bosing.',
        { parse_mode: 'HTML' }
    );
});

bot.command('cancel', async (ctx) => {
    if (ctx.session && ctx.session.waitingForDateRange) {
        ctx.session.waitingForDateRange = false;
        ctx.session.dateStep = null;
        await ctx.reply('✅ Amal bekor qilindi.');
    } else {
        await ctx.reply('Hech qanday faol amal yo‘q.');
    }
});

bot.on('text', async (ctx) => {
    if (!ctx.session || !ctx.session.waitingForDateRange) return;
    const text = ctx.message.text.trim();

    if (ctx.session.dateStep === 'start') {
        if (!isValidDate(text)) {
            await ctx.reply('❌ Noto‘g‘ri format. Iltimos <code>YYYY-MM-DD</code> shaklida yuboring. Misol: 2026-04-01', { parse_mode: 'HTML' });
            return;
        }
        ctx.session.startDate = text;
        ctx.session.dateStep = 'end';
        await ctx.reply('✅ Boshlanish sanasi qabul qilindi. Endi tugash sanasini kiriting (YYYY-MM-DD):');
    } 
    else if (ctx.session.dateStep === 'end') {
        if (!isValidDate(text)) {
            await ctx.reply('❌ Noto‘g‘ri format. Iltimos <code>YYYY-MM-DD</code> shaklida yuboring.', { parse_mode: 'HTML' });
            return;
        }
        ctx.session.endDate = text;
        ctx.session.waitingForDateRange = false;
        ctx.session.dateStep = null;

        const start = ctx.session.startDate;
        const end = ctx.session.endDate;

        if (new Date(start) > new Date(end)) {
            await ctx.reply('❌ Boshlanish sanasi tugash sanasidan katta bo‘lishi mumkin emas. Iltimos /date_stats bilan qayta urining.');
            return;
        }

        await ctx.reply(`⏳ ${start} dan ${end} gacha bo‘lgan maʼlumotlar tahlil qilinmoqda...`);

        try {
            const users = await fetchAllUsersWithRetry(DEFAULT_ADDRESS);
            const filtered = filterUsersByDateRange(users, start, end);
            if (filtered.length === 0) {
                await ctx.reply(`⚠️ Ushbu oraliqda hech qanday lid topilmadi: ${start} — ${end}`);
                return;
            }
            const stats = getStatsByDate(filtered);
            await ctx.reply(stats, { parse_mode: 'HTML' });
            const filePath = generateExcel(filtered, `date_range_${start}_to_${end}.xlsx`);
            await ctx.replyWithDocument({ source: filePath, filename: `lidlar_${start}_${end}.xlsx` });
            fs.unlinkSync(filePath);
        } catch (err) {
            await ctx.reply('❌ Xatolik: ' + err.message);
        }
    }
});

bot.catch((err, ctx) => {
    console.error('Bot xatosi:', err);
    ctx.reply('⚠️ Kutilmagan xatolik yuz berdi. Iltimos /start bilan qayta urining.');
});

// -------------------- HTTP HEALTH CHECK SERVER (Render uchun) --------------------
const app = express();
const PORT = process.env.PORT || 10000;

app.get('/health', (req, res) => {
    res.status(200).send('Bot is running');
});

app.get('/', (req, res) => {
    res.status(200).send('Telegram bot is active');
});

const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`✅ Health check server running on port ${PORT}`);
});

// Botni ishga tushirish (polling)
bot.launch().then(() => {
    console.log('✅ Telegram bot started');
}).catch(err => {
    console.error('Bot launch error:', err);
    server.close();
    process.exit(1);
});

process.once('SIGINT', () => {
    bot.stop('SIGINT');
    server.close();
});
process.once('SIGTERM', () => {
    bot.stop('SIGTERM');
    server.close();
});