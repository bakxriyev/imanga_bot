require("dotenv").config();

const { Telegraf, session } = require("telegraf");
const axios = require("axios");
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const express = require("express");

/* =========================
   CONFIG
========================= */

const BOT_TOKEN = process.env.BOT_TOKEN;

if (!BOT_TOKEN) {
    console.error("❌ BOT_TOKEN yo‘q");
    process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

bot.use(session());

const API_URL =
    "https://b.kardioclinic.uz/userscha/address-a";

const LIMIT = 500;
const ADDRESS = "a";
const MAX_PAGES = 50;

/* =========================
   EXPRESS (RENDER FIX)
========================= */

const app = express();
const PORT = process.env.PORT || 10000;

app.get("/", (req, res) => {
    res.send("BOT RUNNING");
});

app.listen(PORT, () => {
    console.log("✅ Server:", PORT);
});

/* =========================
   HELPERS
========================= */

const sleep = (ms) =>
    new Promise((r) => setTimeout(r, ms));

/* =========================
   API FETCH SAFE
========================= */

async function fetchPage(page) {
    try {
        console.log("📡 PAGE:", page);

        const res = await axios.get(API_URL, {
            params: {
                page,
                limit: LIMIT,
                address: ADDRESS,
            },
            timeout: 30000,
        });

        const users = res.data?.users || [];

        return {
            users,
            total: res.data?.total || 0,
        };
    } catch (err) {
        console.log("❌ API ERROR:", err.message);

        return { users: [], total: 0 };
    }
}

/* =========================
   GET ALL USERS
========================= */

async function getAllUsers() {
    let page = 1;
    let all = [];

    while (page <= MAX_PAGES) {
        const { users } = await fetchPage(page);

        if (!users.length) break;

        all = all.concat(users);

        if (users.length < LIMIT) break;

        page++;

        await sleep(300);
    }

    return all;
}

/* =========================
   STATS BY DATE
========================= */

function getStats(users) {
    const map = {};

    users.forEach((u) => {
        const date = u.createdAt?.split("T")[0];

        if (!date) return;

        map[date] = (map[date] || 0) + 1;
    });

    return map;
}

/* =========================
   EXCEL USERS
========================= */

function makeUsersExcel(users) {
    const data = users.map((u) => ({
        ID: u.id,
        Name: u.full_name,
        Phone: u.phone_number,
        Address: u.address,
        Date: u.createdAt,
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "Users");

    const file = path.join(__dirname, `users_${Date.now()}.xlsx`);

    XLSX.writeFile(wb, file);

    return file;
}

/* =========================
   EXCEL STATS
========================= */

function makeStatsExcel(stats) {
    const data = Object.keys(stats).map((date) => ({
        Date: date,
        Count: stats[date],
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();

    XLSX.utils.book_append_sheet(wb, ws, "Stats");

    const file = path.join(__dirname, `stats_${Date.now()}.xlsx`);

    XLSX.writeFile(wb, file);

    return file;
}

/* =========================
   COMMANDS
========================= */

bot.start((ctx) => {
    ctx.reply(
        "🤖 Bot tayyor!\n\n" +
        "/test\n" +
        "/all\n" +
        "/excel\n" +
        "/stats\n" +
        "/stats_excel"
    );
});

/* =========================
   TEST
========================= */

bot.command("test", async (ctx) => {
    const { users } = await fetchPage(1);

    let text = "TEST USERS:\n\n";

    users.slice(0, 10).forEach((u) => {
        text += `${u.full_name} - ${u.phone_number}\n`;
    });

    ctx.reply(text);
});

/* =========================
   ALL USERS
========================= */

bot.command("all", async (ctx) => {
    ctx.reply("⏳ Yuklanmoqda...");

    const users = await getAllUsers();

    ctx.reply(`📊 Jami users: ${users.length}`);
});

/* =========================
   EXCEL USERS
========================= */

bot.command("excel", async (ctx) => {
    ctx.reply("⏳ Excel tayyorlanmoqda...");

    const users = await getAllUsers();

    const file = makeUsersExcel(users);

    await ctx.replyWithDocument({ source: file });

    fs.unlinkSync(file);
});

/* =========================
   STATS TEXT
========================= */

bot.command("stats", async (ctx) => {
    ctx.reply("⏳ Statistika...");

    const users = await getAllUsers();

    const stats = getStats(users);

    let text = "📊 STATISTICS:\n\n";

    Object.keys(stats).forEach((d) => {
        text += `${d}: ${stats[d]}\n`;
    });

    text += `\nTotal: ${users.length}`;

    ctx.reply(text);
});

/* =========================
   STATS EXCEL
========================= */

bot.command("stats_excel", async (ctx) => {
    ctx.reply("⏳ Stats Excel...");

    const users = await getAllUsers();

    const stats = getStats(users);

    const file = makeStatsExcel(stats);

    await ctx.replyWithDocument({ source: file });

    fs.unlinkSync(file);
});

/* =========================
   ERROR HANDLER
========================= */

bot.catch((err) => {
    console.log("BOT ERROR:", err);
});

/* =========================
   START BOT
========================= */

bot.launch()
    .then(() => console.log("✅ BOT STARTED"))
    .catch((err) => console.log("❌ START ERROR:", err));

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));