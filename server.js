const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
app.use(express.json({ limit: "8mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN || "";
const CHANNEL_USERNAME = process.env.CHANNEL_USERNAME || "@BELIVEIN_OG";
const WEBAPP_URL = process.env.WEBAPP_URL || "";
const ADMIN_IDS = new Set((process.env.ADMIN_IDS || "").split(",").map(s => s.trim()).filter(Boolean));

const pool = process.env.DATABASE_URL
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: /railway/i.test(process.env.DATABASE_URL)
        ? { rejectUnauthorized: false }
        : undefined
    })
  : null;

// Short-lived admin wizard state. Admin access is checked against ADMIN_IDS every time.
const adminState = new Map();

async function initDb() {
  if (!pool) {
    console.warn("DATABASE_URL is not set. Running without PostgreSQL; payments and persistent features are disabled.");
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      telegram_id BIGINT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      photo_url TEXT,
      balance NUMERIC(18,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS inventory (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
      reward_name TEXT NOT NULL,
      reward_image TEXT,
      reward_value NUMERIC(18,2) NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'owned',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS rewards (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      image_url TEXT,
      value NUMERIC(18,2) NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      rarity TEXT NOT NULL DEFAULT 'обычное',
      background_color TEXT NOT NULL DEFAULT '#123c2b',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS cases (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      image_url TEXT,
      price NUMERIC(18,2) NOT NULL DEFAULT 0,
      background_color TEXT NOT NULL DEFAULT '#123c2b',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS case_items (
      case_id BIGINT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
      reward_id BIGINT NOT NULL REFERENCES rewards(id) ON DELETE CASCADE,
      visual_chance NUMERIC(8,4) NOT NULL DEFAULT 0,
      real_chance NUMERIC(8,4) NOT NULL DEFAULT 0,
      PRIMARY KEY(case_id, reward_id),
      CHECK (visual_chance >= 0 AND visual_chance <= 100),
      CHECK (real_chance >= 0 AND real_chance <= 100)
    );
    CREATE TABLE IF NOT EXISTS case_openings (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
      case_id BIGINT NOT NULL REFERENCES cases(id),
      reward_id BIGINT REFERENCES rewards(id),
      reward_name TEXT,
      reward_value NUMERIC(18,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS upgrades (
      id BIGSERIAL PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
      stake NUMERIC(18,2) NOT NULL,
      reward_id BIGINT REFERENCES rewards(id),
      chance NUMERIC(8,4) NOT NULL,
      won BOOLEAN NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS pending_payments (
      invoice_payload TEXT PRIMARY KEY,
      telegram_id BIGINT NOT NULL REFERENCES users(telegram_id) ON DELETE CASCADE,
      stars_amount INTEGER NOT NULL CHECK (stars_amount > 0),
      credit_amount INTEGER NOT NULL CHECK (credit_amount > 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      paid_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS star_payments (
      telegram_payment_charge_id TEXT PRIMARY KEY,
      invoice_payload TEXT UNIQUE NOT NULL,
      telegram_id BIGINT NOT NULL,
      stars_amount INTEGER NOT NULL,
      credit_amount INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS bot_settings (
      key TEXT PRIMARY KEY,
      value JSONB NOT NULL DEFAULT '{}'::jsonb,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  // Safe migrations for existing Railway databases created by earlier versions.
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS photo_url TEXT;
    ALTER TABLE rewards ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
    ALTER TABLE rewards ADD COLUMN IF NOT EXISTS rarity TEXT NOT NULL DEFAULT 'обычное';
    ALTER TABLE rewards ADD COLUMN IF NOT EXISTS background_color TEXT NOT NULL DEFAULT '#123c2b';
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS reward_rarity TEXT NOT NULL DEFAULT 'обычное';
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS reward_background TEXT NOT NULL DEFAULT '#123c2b';
  `);
}

function parseInitData(initData) {
  if (!BOT_TOKEN || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}=${value}`).join("\n");
  const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const calculated = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (calculated.length !== hash.length || !crypto.timingSafeEqual(Buffer.from(calculated), Buffer.from(hash))) return null;

  // Reject old Mini App initData to reduce replay risk.
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || Math.abs(Date.now() / 1000 - authDate) > 86400) return null;
  try {
    const user = JSON.parse(params.get("user") || "null");
    return user?.id ? user : null;
  } catch (_) { return null; }
}

async function requireUser(req, res, next) {
  try {
    const user = parseInitData(req.headers["x-telegram-init-data"] || "");
    if (!user) return res.status(401).json({ error: "Недействительная сессия Telegram. Открой Mini App через бота." });
    req.telegramUser = user;
    if (pool) {
      await pool.query(
        `INSERT INTO users (telegram_id, username, first_name, photo_url) VALUES ($1,$2,$3,$4)
         ON CONFLICT (telegram_id) DO UPDATE SET username=EXCLUDED.username, first_name=EXCLUDED.first_name, photo_url=COALESCE(EXCLUDED.photo_url, users.photo_url), updated_at=NOW()`,
        [user.id, user.username || null, user.first_name || null, user.photo_url || null]
      );
    }
    next();
  } catch (error) {
    console.error("Authentication error:", error);
    res.status(500).json({ error: "Не удалось проверить сессию" });
  }
}

async function requireAdmin(req, res, next) {
  if (!isAdmin(req.telegramUser?.id)) return res.status(403).json({ error: "Нет доступа к админ-панели" });
  if (!pool) return res.status(503).json({ error: "База данных не настроена" });
  next();
}

async function checkSubscription(telegramId) {
  if (!BOT_TOKEN) return false;
  const data = await telegramApi("getChatMember", { chat_id: CHANNEL_USERNAME, user_id: telegramId }).catch(() => null);
  return !!data && ["creator", "administrator", "member"].includes(data.status);
}

async function telegramApi(method, body = {}) {
  if (!BOT_TOKEN) throw new Error("BOT_TOKEN не задан");
  const response = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.description || `Telegram API error: ${method}`);
  return data.result;
}

async function getSetting(key, fallback = {}) {
  if (!pool) return fallback;
  const result = await pool.query("SELECT value FROM bot_settings WHERE key=$1", [key]);
  return result.rows[0]?.value ?? fallback;
}
async function setSetting(key, value) {
  await pool.query(`INSERT INTO bot_settings(key,value) VALUES($1,$2::jsonb)
    ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value, updated_at=NOW()`, [key, JSON.stringify(value)]);
}
function isAdmin(id) { return ADMIN_IDS.has(String(id)); }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>\"]/g, ch => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
}
function parseUsername(value) { return String(value || "").trim().replace(/^@/, "").toLowerCase(); }

app.get("/api/subscription", requireUser, async (req, res) => {
  try { res.json({ subscribed: await checkSubscription(req.telegramUser.id) }); }
  catch (error) { console.error("Subscription check error:", error); res.status(500).json({ error: "Не удалось проверить подписку" }); }
});

app.get("/api/me", requireUser, async (req, res) => {
  if (!pool) return res.json({ user: { telegram_id: req.telegramUser.id, username: req.telegramUser.username || null, first_name: req.telegramUser.first_name || null, photo_url: req.telegramUser.photo_url || null, created_at: null }, balance: 0, inventory: [], stats: {} });
  try {
    const userResult = await pool.query("SELECT telegram_id, username, first_name, COALESCE(photo_url,$2) AS photo_url, balance, created_at FROM users WHERE telegram_id=$1", [req.telegramUser.id, req.telegramUser.photo_url || null]);
    const inventoryResult = await pool.query(`SELECT id, reward_name, reward_image, reward_value, status, created_at, reward_rarity, reward_background FROM inventory WHERE telegram_id=$1 ORDER BY created_at DESC`, [req.telegramUser.id]);
    const statsResult = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM case_openings WHERE telegram_id=$1) AS cases_opened,
        (SELECT COUNT(*)::int FROM upgrades WHERE telegram_id=$1) AS games_played,
        (SELECT COALESCE(MAX(reward_value),0) FROM inventory WHERE telegram_id=$1) AS best_prize_value,
        (SELECT reward_name FROM inventory WHERE telegram_id=$1 ORDER BY reward_value DESC, created_at ASC LIMIT 1) AS best_prize_name,
        (SELECT COUNT(*)::int FROM inventory WHERE telegram_id=$1) AS items_owned
    `, [req.telegramUser.id]);
    const user = userResult.rows[0] || null;
    if (user && req.telegramUser.photo_url && !user.photo_url) user.photo_url = req.telegramUser.photo_url;
    res.json({ user, balance: user?.balance ?? 0, inventory: inventoryResult.rows, stats: statsResult.rows[0] || {} });
  } catch (error) { console.error("/api/me error:", error); res.status(500).json({ error: "Не удалось загрузить профиль" }); }
});

app.get("/api/rewards", async (_req, res) => {
  if (!pool) return res.json([]);
  try {
    const result = await pool.query("SELECT id, name, image_url, value, description, rarity, background_color FROM rewards WHERE active=TRUE ORDER BY value ASC");
    res.json(result.rows);
  } catch (error) { console.error("/api/rewards error:", error); res.status(500).json({ error: "Не удалось загрузить награды" }); }
});

app.get("/api/cases", async (_req, res) => {
  if (!pool) return res.json([]);
  try {
    const result = await pool.query(`SELECT c.id,c.name,c.description,c.image_url,c.price,c.background_color,
      COUNT(ci.reward_id)::int AS item_count
      FROM cases c LEFT JOIN case_items ci ON ci.case_id=c.id
      WHERE c.active=TRUE GROUP BY c.id ORDER BY c.created_at DESC`);
    res.json(result.rows);
  } catch (error) { console.error("/api/cases error:", error); res.status(500).json({ error: "Не удалось загрузить кейсы" }); }
});

app.get("/api/cases/:id", async (req, res) => {
  if (!pool) return res.status(503).json({ error: "База данных не настроена" });
  try {
    const result = await pool.query(`SELECT c.id,c.name,c.description,c.image_url,c.price,c.background_color,
      r.id AS reward_id,r.name AS reward_name,r.image_url AS reward_image,r.value AS reward_value,r.description AS reward_description,
      r.rarity,r.background_color AS reward_background,ci.visual_chance
      FROM cases c LEFT JOIN case_items ci ON ci.case_id=c.id LEFT JOIN rewards r ON r.id=ci.reward_id AND r.active=TRUE
      WHERE c.id=$1 AND c.active=TRUE ORDER BY r.value ASC`, [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: "Кейс не найден" });
    const first = result.rows[0];
    res.json({ case: { id:first.id,name:first.name,description:first.description,image_url:first.image_url,price:first.price,background_color:first.background_color }, items: result.rows.filter(x=>x.reward_id).map(x=>({id:x.reward_id,name:x.reward_name,image_url:x.reward_image,value:x.reward_value,description:x.reward_description,rarity:x.rarity,background_color:x.reward_background,visual_chance:x.visual_chance})) });
  } catch (error) { console.error("/api/cases/:id error:", error); res.status(500).json({ error: "Не удалось загрузить кейс" }); }
});

app.get("/api/admin/status", requireUser, (req,res) => res.json({ isAdmin: isAdmin(req.telegramUser.id) }));

app.get("/api/admin/items", requireUser, requireAdmin, async (_req,res) => {
  try { const r=await pool.query("SELECT id,name,image_url,value,description,rarity,background_color,active FROM rewards ORDER BY created_at DESC"); res.json(r.rows); }
  catch(e){ console.error(e); res.status(500).json({error:"Не удалось загрузить предметы"}); }
});
app.post("/api/admin/items", requireUser, requireAdmin, async (req,res) => {
  const {name,image_url, value, description, rarity, background_color}=req.body||{};
  if(!String(name||'').trim()) return res.status(400).json({error:"Укажи название предмета"});
  const price=Number(value);
  if(!Number.isFinite(price)||price<0) return res.status(400).json({error:"Укажи корректную стоимость"});
  if(image_url && !/^https?:\/\//i.test(image_url) && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(image_url)) return res.status(400).json({error:"Изображение должно быть загружено или иметь ссылку http(s)"});
  const rarities=["обычное","необычное","редкое","сверхредкое","легендарное","мифическое","???"];
  if(rarity && !rarities.includes(rarity)) return res.status(400).json({error:"Неизвестная редкость"});
  try { const r=await pool.query(`INSERT INTO rewards(name,image_url,value,description,rarity,background_color,active) VALUES($1,$2,$3,$4,$5,$6,TRUE) RETURNING *`,[String(name).trim(),image_url||null,price,String(description||''),rarity||'обычное',/^#[0-9a-f]{6}$/i.test(background_color||'')?background_color:'#123c2b']); res.status(201).json(r.rows[0]); }
  catch(e){console.error(e);res.status(500).json({error:"Не удалось создать предмет"});}
});
app.put("/api/admin/items/:id", requireUser, requireAdmin, async (req,res) => {
  const {name,image_url,value,description,rarity,background_color,active}=req.body||{};
  const price=Number(value); const rarities=["обычное","необычное","редкое","сверхредкое","легендарное","мифическое","???"];
  if(!String(name||'').trim()||!Number.isFinite(price)||price<0) return res.status(400).json({error:"Проверь название и стоимость"});
  if(rarity && !rarities.includes(rarity)) return res.status(400).json({error:"Неизвестная редкость"});
  if(image_url && !/^https?:\/\//i.test(image_url) && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(image_url)) return res.status(400).json({error:"Неверное изображение"});
  try { const r=await pool.query(`UPDATE rewards SET name=$1,image_url=$2,value=$3,description=$4,rarity=$5,background_color=$6,active=$7 WHERE id=$8 RETURNING *`,[String(name).trim(),image_url||null,price,String(description||''),rarity||'обычное',/^#[0-9a-f]{6}$/i.test(background_color||'')?background_color:'#123c2b',active!==false,req.params.id]); if(!r.rows[0]) return res.status(404).json({error:"Предмет не найден"}); res.json(r.rows[0]); }
  catch(e){console.error(e);res.status(500).json({error:"Не удалось сохранить предмет"});}
});
app.delete("/api/admin/items/:id", requireUser, requireAdmin, async (req,res) => {
  try { const r=await pool.query("UPDATE rewards SET active=FALSE WHERE id=$1 RETURNING id",[req.params.id]); if(!r.rows[0]) return res.status(404).json({error:"Предмет не найден"}); res.json({ok:true}); }
  catch(e){console.error(e);res.status(500).json({error:"Не удалось удалить предмет"});}
});
app.get("/api/admin/cases", requireUser, requireAdmin, async (_req,res) => {
  try { const r=await pool.query(`SELECT c.*,COUNT(ci.reward_id)::int AS item_count FROM cases c LEFT JOIN case_items ci ON ci.case_id=c.id GROUP BY c.id ORDER BY c.created_at DESC`); res.json(r.rows); }
  catch(e){console.error(e);res.status(500).json({error:"Не удалось загрузить кейсы"});}
});
app.post("/api/admin/cases", requireUser, requireAdmin, async (req,res) => {
  const {name,description,image_url,price,background_color}=req.body||{}; const amount=Number(price);
  if(!String(name||'').trim()) return res.status(400).json({error:"Укажи название кейса"});
  if(!Number.isFinite(amount)||amount<0) return res.status(400).json({error:"Укажи корректную цену кейса"});
  if(image_url && !/^https?:\/\//i.test(image_url) && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(image_url)) return res.status(400).json({error:"Неверное изображение"});
  try {const r=await pool.query(`INSERT INTO cases(name,description,image_url,price,background_color) VALUES($1,$2,$3,$4,$5) RETURNING *`,[String(name).trim(),String(description||''),image_url||null,amount,/^#[0-9a-f]{6}$/i.test(background_color||'')?background_color:'#123c2b']);res.status(201).json(r.rows[0]);}
  catch(e){console.error(e);res.status(500).json({error:"Не удалось создать кейс"});}
});
app.put("/api/admin/cases/:id", requireUser, requireAdmin, async (req,res) => {
  const {name,description,image_url,price,background_color,active}=req.body||{}; const amount=Number(price);
  if(!String(name||'').trim()||!Number.isFinite(amount)||amount<0) return res.status(400).json({error:"Проверь название и цену кейса"});
  if(image_url && !/^https?:\/\//i.test(image_url) && !/^data:image\/(png|jpeg|webp|gif);base64,/i.test(image_url)) return res.status(400).json({error:"Неверное изображение"});
  try {const r=await pool.query(`UPDATE cases SET name=$1,description=$2,image_url=$3,price=$4,background_color=$5,active=$6 WHERE id=$7 RETURNING *`,[String(name).trim(),String(description||''),image_url||null,amount,/^#[0-9a-f]{6}$/i.test(background_color||'')?background_color:'#123c2b',active!==false,req.params.id]);if(!r.rows[0])return res.status(404).json({error:"Кейс не найден"});res.json(r.rows[0]);}
  catch(e){console.error(e);res.status(500).json({error:"Не удалось сохранить кейс"});}
});
app.delete("/api/admin/cases/:id", requireUser, requireAdmin, async (req,res) => {
  try { const r=await pool.query("UPDATE cases SET active=FALSE WHERE id=$1 RETURNING id",[req.params.id]); if(!r.rows[0]) return res.status(404).json({error:"Кейс не найден"}); res.json({ok:true}); }
  catch(e){console.error(e);res.status(500).json({error:"Не удалось скрыть кейс"});}
});
app.post("/api/admin/cases/:id/items", requireUser, requireAdmin, async (req,res) => {
  const rewardId=Number(req.body?.reward_id), visual=Number(req.body?.visual_chance), real=Number(req.body?.real_chance);
  if(!Number.isInteger(rewardId)||!Number.isFinite(visual)||visual<0||visual>100||!Number.isFinite(real)||real<0||real>100) return res.status(400).json({error:"Шансы должны быть от 0 до 100"});
  try {const r=await pool.query(`INSERT INTO case_items(case_id,reward_id,visual_chance,real_chance) SELECT $1,id,$3,$4 FROM rewards WHERE id=$2 AND active=TRUE ON CONFLICT(case_id,reward_id) DO UPDATE SET visual_chance=EXCLUDED.visual_chance,real_chance=EXCLUDED.real_chance RETURNING *`,[req.params.id,rewardId,visual,real]);if(!r.rows[0])return res.status(404).json({error:"Кейс или предмет не найден"});res.json(r.rows[0]);}
  catch(e){console.error(e);res.status(500).json({error:"Не удалось добавить предмет в кейс"});}
});
app.get("/api/admin/cases/:id/items", requireUser, requireAdmin, async (req,res) => {
  try { const r=await pool.query(`SELECT r.id,r.name,r.image_url,r.value,r.rarity,ci.visual_chance,ci.real_chance FROM case_items ci JOIN rewards r ON r.id=ci.reward_id WHERE ci.case_id=$1 ORDER BY r.value ASC`,[req.params.id]); res.json(r.rows); }
  catch(e){console.error(e);res.status(500).json({error:"Не удалось загрузить содержимое кейса"});}
});
app.delete("/api/admin/cases/:caseId/items/:rewardId", requireUser, requireAdmin, async (req,res) => {
  try {await pool.query("DELETE FROM case_items WHERE case_id=$1 AND reward_id=$2",[req.params.caseId,req.params.rewardId]);res.json({ok:true});}
  catch(e){console.error(e);res.status(500).json({error:"Не удалось убрать предмет из кейса"});}
});
app.post("/api/cases/:id/open", requireUser, async (req,res) => {
  if(!pool) return res.status(503).json({error:"База данных не настроена"});
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    const c=await client.query("SELECT * FROM cases WHERE id=$1 AND active=TRUE FOR UPDATE",[req.params.id]);
    if(!c.rows[0]) throw Object.assign(new Error("Кейс не найден"),{status:404});
    const box=c.rows[0];
    const user=await client.query("SELECT balance FROM users WHERE telegram_id=$1 FOR UPDATE",[req.telegramUser.id]);
    if(!user.rows[0] || Number(user.rows[0].balance)<Number(box.price)) throw Object.assign(new Error("Недостаточно звёзд на балансе"),{status:400});
    const items=await client.query(`SELECT r.*,ci.real_chance FROM case_items ci JOIN rewards r ON r.id=ci.reward_id WHERE ci.case_id=$1 AND r.active=TRUE ORDER BY r.id`,[box.id]);
    if(!items.rows.length) throw Object.assign(new Error("В этом кейсе пока нет предметов"),{status:400});
    const sum=items.rows.reduce((a,x)=>a+Number(x.real_chance),0);
    if(Math.abs(sum-100)>0.01) throw Object.assign(new Error(`Сумма реальных шансов должна быть 100%. Сейчас: ${sum.toFixed(2)}%`),{status:400});
    await client.query("UPDATE users SET balance=balance-$1,updated_at=NOW() WHERE telegram_id=$2",[box.price,req.telegramUser.id]);
    const roll=Math.random()*100; let acc=0, picked=items.rows[items.rows.length-1];
    for(const item of items.rows){acc+=Number(item.real_chance);if(roll<acc){picked=item;break;}}
    await client.query(`INSERT INTO inventory(telegram_id,reward_name,reward_image,reward_value,status,reward_rarity,reward_background) VALUES($1,$2,$3,$4,'Из кейса',$5,$6)`,[req.telegramUser.id,picked.name,picked.image_url,picked.value,picked.rarity,picked.background_color]);
    await client.query(`INSERT INTO case_openings(telegram_id,case_id,reward_id,reward_name,reward_value) VALUES($1,$2,$3,$4,$5)`,[req.telegramUser.id,box.id,picked.id,picked.name,picked.value]);
    await client.query("COMMIT");
    res.json({ok:true,balance:Number(user.rows[0].balance)-Number(box.price),reward:{id:picked.id,name:picked.name,image_url:picked.image_url,value:picked.value,rarity:picked.rarity,background_color:picked.background_color}});
  } catch(e){await client.query("ROLLBACK").catch(()=>{});res.status(e.status||500).json({error:e.message||"Не удалось открыть кейс"});}
  finally{client.release();}
});

// Invoice link for Telegram Stars. Balance is NOT credited here: only successful_payment can do that.
app.post("/api/topup", requireUser, async (req, res) => {
  if (!pool || !BOT_TOKEN) return res.status(503).json({ error: "Пополнение временно недоступно: сервер не настроен" });
  const amount = Number(req.body?.amount);
  if (!Number.isInteger(amount) || amount < 1 || amount > 10000) return res.status(400).json({ error: "Укажи сумму от 1 до 10 000 ⭐" });
  try {
    const user = req.telegramUser;
    await pool.query(`INSERT INTO users(telegram_id, username, first_name) VALUES($1,$2,$3)
      ON CONFLICT(telegram_id) DO UPDATE SET username=EXCLUDED.username, first_name=EXCLUDED.first_name, updated_at=NOW()`,
      [user.id, user.username || null, user.first_name || null]);
    const payload = `belivein_stars:${user.id}:${crypto.randomUUID()}`;
    const bonus = Math.floor(amount / 100) * 10;
    const credit = amount + bonus;
    await pool.query("INSERT INTO pending_payments(invoice_payload,telegram_id,stars_amount,credit_amount) VALUES($1,$2,$3,$4)", [payload, user.id, amount, credit]);
    const link = await telegramApi("createInvoiceLink", {
      title: `Пополнение BELIVEIN на ${amount} ⭐`,
      description: bonus ? `На баланс поступит ${credit} ⭐ (включая бонус ${bonus} ⭐).` : `Пополнение баланса на ${amount} ⭐.`,
      payload,
      provider_token: "",
      currency: "XTR",
      prices: [{ label: "Пополнение баланса", amount }]
    });
    res.json({ invoiceLink: link, amount, bonus, creditAmount: credit });
  } catch (error) {
    console.error("Create Stars invoice error:", error);
    res.status(500).json({ error: "Не удалось создать счёт Telegram Stars" });
  }
});

app.post("/api/upgrade", requireUser, async (req, res) => {
  if (!pool) return res.status(503).json({ error: "База данных не настроена" });
  const stake = Number(req.body?.stake);
  const rewardId = Number(req.body?.rewardId);
  if (!Number.isFinite(stake) || stake <= 0 || !Number.isInteger(rewardId)) return res.status(400).json({ error: "Некорректный запрос" });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rewardResult = await client.query("SELECT id,name,image_url,value,rarity,background_color FROM rewards WHERE id=$1 AND active=TRUE FOR UPDATE", [rewardId]);
    if (!rewardResult.rows[0]) throw new Error("Награда не найдена");
    const userResult = await client.query("SELECT balance FROM users WHERE telegram_id=$1 FOR UPDATE", [req.telegramUser.id]);
    const user = userResult.rows[0];
    if (!user || Number(user.balance) < stake) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Недостаточно средств" });
    }
    const reward = rewardResult.rows[0];
    const chance = Math.min(75, Math.max(0, (stake / Number(reward.value)) * 100));
    const won = Math.random() * 100 < chance;
    await client.query("UPDATE users SET balance=balance-$1, updated_at=NOW() WHERE telegram_id=$2", [stake, req.telegramUser.id]);
    await client.query("INSERT INTO upgrades(telegram_id,stake,reward_id,chance,won) VALUES($1,$2,$3,$4,$5)", [req.telegramUser.id, stake, reward.id, chance, won]);
    if (won) await client.query("INSERT INTO inventory(telegram_id,reward_name,reward_image,reward_value,reward_rarity,reward_background) VALUES($1,$2,$3,$4,$5,$6)", [req.telegramUser.id, reward.name, reward.image_url, reward.value, reward.rarity || 'обычное', reward.background_color || '#123c2b']);
    await client.query("COMMIT");
    res.json({ won, chance, reward: { id: reward.id, name: reward.name, image_url: reward.image_url, value: reward.value } });
  } catch (error) {
    await client.query("ROLLBACK"); console.error("Upgrade error:", error);
    res.status(500).json({ error: "Не удалось выполнить действие" });
  } finally { client.release(); }
});

app.get("/{*splat}", (_req, res) => res.sendFile(path.join(__dirname, "public", "index.html")));

// ---------- Bot helpers / admin panel ----------
async function sendText(chatId, text, extra = {}) {
  return telegramApi("sendMessage", { chat_id: chatId, text, ...extra });
}
async function adminPanel(chatId) {
  const keyboard = { inline_keyboard: [
    [{ text: "💰 Выдать баланс", callback_data: "adm:balance" }, { text: "📢 Рассылка", callback_data: "adm:broadcast" }],
    [{ text: "📝 Уведомление о пополнении", callback_data: "adm:template" }],
    [{ text: "🎁 Добавить предмет", callback_data: "adm:additem" }, { text: "📦 Выдать предмет", callback_data: "adm:grantitem" }],
    [{ text: "📊 Статистика", callback_data: "adm:stats" }, { text: "❌ Закрыть", callback_data: "adm:close" }]
  ] };
  await sendText(chatId, "<b>BELIVEIN — админ-панель</b>\nВыбери действие:", { parse_mode: "HTML", reply_markup: keyboard });
}
async function findUserByUsername(username) {
  const clean = parseUsername(username);
  if (!clean) return null;
  const result = await pool.query("SELECT telegram_id,username,first_name,balance FROM users WHERE LOWER(username)=$1 LIMIT 1", [clean]);
  return result.rows[0] || null;
}
async function notifyTopup(userId, creditedAmount, paidAmount) {
  const template = await getSetting("topup_notification", { text: "✅ Баланс успешно пополнен!\n\nЗачислено: <b>(upbal) ⭐</b>" });
  const text = String(template.text || "Баланс пополнен: <b>(upbal) ⭐</b>").replaceAll("(upbal)", String(creditedAmount));
  const extra = { parse_mode: "HTML" };
  try {
    if (template.mediaType === "photo" && template.fileId) {
      await telegramApi("sendPhoto", { chat_id: userId, photo: template.fileId, caption: text, parse_mode: "HTML" });
    } else if (template.mediaType === "animation" && template.fileId) {
      await telegramApi("sendAnimation", { chat_id: userId, animation: template.fileId, caption: text, parse_mode: "HTML" });
    } else {
      await sendText(userId, text, extra);
    }
  } catch (error) {
    console.error("Top-up notification error:", error.message);
    await sendText(userId, `✅ Баланс пополнен. Зачислено: ${creditedAmount} ⭐ (оплачено ${paidAmount} ⭐).`).catch(() => {});
  }
}

async function processSuccessfulPayment(message) {
  const payment = message.successful_payment;
  if (!payment || payment.currency !== "XTR") return;
  if (!pool) { console.error("Successful payment received but DATABASE_URL is missing"); return; }
  const client = await pool.connect();
  let creditInfo = null;
  try {
    await client.query("BEGIN");
    // Unique charge id plus row lock makes repeated Telegram updates idempotent.
    const prior = await client.query("SELECT telegram_payment_charge_id FROM star_payments WHERE telegram_payment_charge_id=$1 OR invoice_payload=$2", [payment.telegram_payment_charge_id, payment.invoice_payload]);
    if (prior.rowCount) { await client.query("COMMIT"); return; }
    const pendingResult = await client.query("SELECT * FROM pending_payments WHERE invoice_payload=$1 FOR UPDATE", [payment.invoice_payload]);
    const pending = pendingResult.rows[0];
    if (!pending || String(pending.telegram_id) !== String(message.from.id) || Number(pending.stars_amount) !== Number(payment.total_amount)) {
      await client.query("ROLLBACK");
      console.error("Rejected unmatched Stars payment", { payload: payment.invoice_payload, from: message.from.id, amount: payment.total_amount });
      await sendText(message.chat.id, "Не удалось автоматически подтвердить этот платёж. Напиши администратору и приложи скрин оплаты.").catch(() => {});
      return;
    }
    await client.query("UPDATE users SET balance=balance+$1, updated_at=NOW() WHERE telegram_id=$2", [pending.credit_amount, pending.telegram_id]);
    await client.query("INSERT INTO star_payments(telegram_payment_charge_id,invoice_payload,telegram_id,stars_amount,credit_amount) VALUES($1,$2,$3,$4,$5)", [payment.telegram_payment_charge_id, payment.invoice_payload, pending.telegram_id, pending.stars_amount, pending.credit_amount]);
    await client.query("UPDATE pending_payments SET paid_at=NOW() WHERE invoice_payload=$1", [payment.invoice_payload]);
    await client.query("COMMIT");
    creditInfo = { userId: pending.telegram_id, paid: Number(pending.stars_amount), credited: Number(pending.credit_amount) };
  } catch (error) {
    await client.query("ROLLBACK"); console.error("Payment processing error:", error);
  } finally { client.release(); }
  if (creditInfo) {
    await notifyTopup(creditInfo.userId, creditInfo.credited, creditInfo.paid);
    for (const adminId of ADMIN_IDS) {
      sendText(adminId, `💳 <b>Новое пополнение</b>\nПользователь: <code>${escapeHtml(creditInfo.userId)}</code>\nОплачено: ${creditInfo.paid} ⭐\nЗачислено: ${creditInfo.credited} ⭐`, { parse_mode: "HTML" }).catch(() => {});
    }
  }
}

async function handleAdminText(message) {
  const adminId = String(message.from.id);
  const state = adminState.get(adminId);
  if (!state) return false;
  if (message.text === "/cancel") {
    adminState.delete(adminId); await sendText(message.chat.id, "Действие отменено."); return true;
  }

  if (state.step === "balance_user") {
    state.username = parseUsername(message.text);
    if (!state.username) { await sendText(message.chat.id, "Введи @username пользователя. /cancel — отмена."); return true; }
    state.step = "balance_amount";
    await sendText(message.chat.id, "Введи количество ⭐ для начисления:"); return true;
  }
  if (state.step === "balance_amount") {
    const amount = Number(message.text);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000) { await sendText(message.chat.id, "Введи положительное число. /cancel — отмена."); return true; }
    const user = await findUserByUsername(state.username);
    if (!user) { await sendText(message.chat.id, `Не нашёл @${escapeHtml(state.username)} в базе. Пользователь должен хотя бы раз открыть бота.`, { parse_mode: "HTML" }); adminState.delete(adminId); return true; }
    await pool.query("UPDATE users SET balance=balance+$1,updated_at=NOW() WHERE telegram_id=$2", [amount, user.telegram_id]);
    await sendText(message.chat.id, `Готово: @${escapeHtml(user.username || state.username)} начислено ${amount} ⭐.`, { parse_mode: "HTML" });
    await sendText(user.telegram_id, `💰 Администратор начислил на твой баланс ${amount} ⭐.`).catch(() => {});
    adminState.delete(adminId); return true;
  }
  if (state.step === "broadcast") {
    if (!message.text && !message.photo && !message.animation) { await sendText(message.chat.id, "Отправь текст, фото или GIF для рассылки."); return true; }
    const users = await pool.query("SELECT telegram_id FROM users");
    let sent = 0, failed = 0;
    for (const row of users.rows) {
      try {
        if (message.photo) await telegramApi("sendPhoto", { chat_id: row.telegram_id, photo: message.photo[message.photo.length - 1].file_id, caption: message.caption || "", parse_mode: "HTML" });
        else if (message.animation) await telegramApi("sendAnimation", { chat_id: row.telegram_id, animation: message.animation.file_id, caption: message.caption || "", parse_mode: "HTML" });
        else await sendText(row.telegram_id, message.text, { parse_mode: "HTML" });
        sent++;
      } catch (_) { failed++; }
    }
    adminState.delete(adminId); await sendText(message.chat.id, `Рассылка завершена. Отправлено: ${sent}, ошибок: ${failed}.`); return true;
  }
  if (state.step === "template") {
    if (!message.text && !message.photo && !message.animation) { await sendText(message.chat.id, "Пришли текст, фото с подписью или GIF с подписью. В шаблоне используй (upbal). /cancel — отмена."); return true; }
    const value = {
      text: message.text || message.caption || "Баланс пополнен: <b>(upbal) ⭐</b>",
      mediaType: message.photo ? "photo" : message.animation ? "animation" : null,
      fileId: message.photo ? message.photo[message.photo.length - 1].file_id : message.animation?.file_id || null
    };
    await setSetting("topup_notification", value);
    adminState.delete(adminId);
    await sendText(message.chat.id, "Шаблон уведомления сохранён. HTML-разметка поддерживается; для Premium Emoji можно использовать HTML-тег Telegram <code>&lt;tg-emoji emoji-id=\"ID\"&gt;😀&lt;/tg-emoji&gt;</code>.", { parse_mode: "HTML" }); return true;
  }
  if (state.step === "item_name") {
    if (!message.text?.trim()) { await sendText(message.chat.id, "Введи название предмета."); return true; }
    state.name = message.text.trim(); state.step = "item_image";
    await sendText(message.chat.id, "Отправь URL изображения предмета или напиши - если картинки нет:"); return true;
  }
  if (state.step === "item_image") {
    const image = (message.text || "").trim();
    if (image !== "-" && image && !/^https?:\/\//i.test(image)) { await sendText(message.chat.id, "Нужна ссылка, начинающаяся с http:// или https://, либо -."); return true; }
    state.image = image === "-" ? null : image || null; state.step = "item_price";
    await sendText(message.chat.id, "Введи цену предмета в ⭐ (целое или дробное число):"); return true;
  }
  if (state.step === "item_price") {
    const price = Number(message.text);
    if (!Number.isFinite(price) || price < 0) { await sendText(message.chat.id, "Введи корректную цену."); return true; }
    await pool.query("INSERT INTO rewards(name,image_url,value,active) VALUES($1,$2,$3,TRUE)", [state.name, state.image, price]);
    adminState.delete(adminId); await sendText(message.chat.id, `Предмет «${escapeHtml(state.name)}» добавлен в каталог.`, { parse_mode: "HTML" }); return true;
  }
  if (state.step === "grant_user") {
    state.username = parseUsername(message.text); state.step = "grant_name";
    await sendText(message.chat.id, "Введи название предмета, который выдать пользователю:"); return true;
  }
  if (state.step === "grant_name") {
    if (!message.text?.trim()) { await sendText(message.chat.id, "Введи название предмета."); return true; }
    state.name = message.text.trim(); state.step = "grant_image";
    await sendText(message.chat.id, "Отправь URL изображения или напиши -:"); return true;
  }
  if (state.step === "grant_image") {
    const image = (message.text || "").trim();
    if (image !== "-" && image && !/^https?:\/\//i.test(image)) { await sendText(message.chat.id, "Нужна ссылка http(s) или -."); return true; }
    state.image = image === "-" ? null : image || null; state.step = "grant_value";
    await sendText(message.chat.id, "Введи стоимость предмета в ⭐:"); return true;
  }
  if (state.step === "grant_value") {
    const value = Number(message.text);
    if (!Number.isFinite(value) || value < 0) { await sendText(message.chat.id, "Введи корректное число."); return true; }
    const user = await findUserByUsername(state.username);
    if (!user) { await sendText(message.chat.id, `Пользователь @${escapeHtml(state.username)} не найден. Он должен хотя бы раз открыть бота.`, { parse_mode: "HTML" }); adminState.delete(adminId); return true; }
    await pool.query("INSERT INTO inventory(telegram_id,reward_name,reward_image,reward_value,status) VALUES($1,$2,$3,$4,'Выдан администратором')", [user.telegram_id, state.name, state.image, value]);
    await sendText(message.chat.id, `Предмет «${escapeHtml(state.name)}» выдан пользователю @${escapeHtml(user.username || state.username)}.`, { parse_mode: "HTML" });
    await sendText(user.telegram_id, `🎁 Тебе выдали предмет: ${state.name}`).catch(() => {});
    adminState.delete(adminId); return true;
  }
  return false;
}

async function handleCallback(callback) {
  const fromId = String(callback.from.id);
  if (!callback.data?.startsWith("adm:")) return;
  if (!isAdmin(fromId)) {
    await telegramApi("answerCallbackQuery", { callback_query_id: callback.id, text: "Нет доступа", show_alert: true }).catch(() => {});
    return;
  }
  await telegramApi("answerCallbackQuery", { callback_query_id: callback.id }).catch(() => {});
  const chatId = callback.message.chat.id;
  if (!pool) { await sendText(chatId, "DATABASE_URL не настроен."); return; }
  switch (callback.data) {
    case "adm:balance": adminState.set(fromId, { step: "balance_user" }); return sendText(chatId, "Введи @username пользователя, которому начислить баланс. /cancel — отмена.");
    case "adm:broadcast": adminState.set(fromId, { step: "broadcast" }); return sendText(chatId, "Отправь текст, фото или GIF для рассылки всем пользователям. HTML-разметка поддерживается. /cancel — отмена.");
    case "adm:template": adminState.set(fromId, { step: "template" }); return sendText(chatId, "Пришли новый шаблон уведомления: текст, фото с подписью или GIF с подписью. Плейсхолдер (upbal) заменится на сумму зачисления. Поддерживается HTML и Premium Emoji через tg-emoji. /cancel — отмена.");
    case "adm:additem": adminState.set(fromId, { step: "item_name" }); return sendText(chatId, "Введи название нового предмета для каталога. /cancel — отмена.");
    case "adm:grantitem": adminState.set(fromId, { step: "grant_user" }); return sendText(chatId, "Введи @username пользователя, которому выдать предмет. /cancel — отмена.");
    case "adm:stats": {
      const [users, payments, rewards] = await Promise.all([
        pool.query("SELECT COUNT(*)::int AS count FROM users"),
        pool.query("SELECT COUNT(*)::int AS count, COALESCE(SUM(stars_amount),0)::numeric AS stars FROM star_payments"),
        pool.query("SELECT COUNT(*)::int AS count FROM rewards WHERE active=TRUE")
      ]);
      return sendText(chatId, `📊 <b>Статистика BELIVEIN</b>\nПользователей: ${users.rows[0].count}\nПлатежей: ${payments.rows[0].count}\nОплачено Stars: ${payments.rows[0].stars} ⭐\nПредметов в каталоге: ${rewards.rows[0].count}`, { parse_mode: "HTML" });
    }
    case "adm:close": return sendText(chatId, "Админ-панель закрыта.");
  }
}

async function handleBotUpdate(update) {
  if (update.pre_checkout_query) {
    const query = update.pre_checkout_query;
    try {
      if (!pool || query.currency !== "XTR") {
        await telegramApi("answerPreCheckoutQuery", { pre_checkout_query_id: query.id, ok: false, error_message: "Оплата временно недоступна. Попробуй позже." });
        return;
      }
      const result = await pool.query("SELECT telegram_id, stars_amount, paid_at FROM pending_payments WHERE invoice_payload=$1", [query.invoice_payload]);
      const pending = result.rows[0];
      if (!pending || String(pending.telegram_id) !== String(query.from.id) || Number(pending.stars_amount) !== Number(query.total_amount) || pending.paid_at) {
        await telegramApi("answerPreCheckoutQuery", { pre_checkout_query_id: query.id, ok: false, error_message: "Счёт недействителен или уже использован. Создай новый счёт." });
        return;
      }
      await telegramApi("answerPreCheckoutQuery", { pre_checkout_query_id: query.id, ok: true });
    } catch (error) {
      console.error("Pre-checkout validation error:", error);
      await telegramApi("answerPreCheckoutQuery", { pre_checkout_query_id: query.id, ok: false, error_message: "Не удалось проверить счёт. Попробуй ещё раз." }).catch(() => {});
    }
    return;
  }
  if (update.callback_query) return handleCallback(update.callback_query);
  const message = update.message;
  if (!message) return;
  if (message.successful_payment) return processSuccessfulPayment(message);
  if (!message.text && !message.photo && !message.animation) return;

  const text = message.text || "";
  const fromId = String(message.from?.id || "");
  if (isAdmin(fromId) && adminState.has(fromId) && await handleAdminText(message)) return;

  if (text === "/start" || text.startsWith("/start ")) {
    if (pool) {
      await pool.query(`INSERT INTO users(telegram_id,username,first_name) VALUES($1,$2,$3)
        ON CONFLICT(telegram_id) DO UPDATE SET username=EXCLUDED.username, first_name=EXCLUDED.first_name, updated_at=NOW()`,
        [message.from.id, message.from.username || null, message.from.first_name || null]).catch(err => console.error("Register user error:", err));
    }
    const keyboard = WEBAPP_URL ? { inline_keyboard: [[{ text: "🎮 ОТКРЫТЬ MINI APP", web_app: { url: WEBAPP_URL } }]] } : undefined;
    await sendText(message.chat.id, `Привет, ${message.from?.first_name || "друг"}! 👋\n\nДобро пожаловать в BELIVEIN.\nОткрой Mini App, чтобы продолжить.`, keyboard ? { reply_markup: keyboard } : {});
    return;
  }
  if (text === "/adm") {
    if (!isAdmin(fromId)) return sendText(message.chat.id, "⛔ Нет доступа к админ-панели.");
    return adminPanel(message.chat.id);
  }
  if (text.startsWith("/addbal ")) {
    if (!isAdmin(fromId)) return sendText(message.chat.id, "⛔ Нет доступа.");
    const [, username, rawAmount] = text.trim().split(/\s+/);
    const amount = Number(rawAmount);
    if (!username || !Number.isFinite(amount) || amount <= 0 || !pool) return sendText(message.chat.id, "Формат: /addbal @username количество");
    const user = await findUserByUsername(username);
    if (!user) return sendText(message.chat.id, "Пользователь не найден. Он должен хотя бы раз открыть бота.");
    await pool.query("UPDATE users SET balance=balance+$1,updated_at=NOW() WHERE telegram_id=$2", [amount, user.telegram_id]);
    await sendText(message.chat.id, `Начислено ${amount} ⭐ пользователю @${user.username || username.replace(/^@/, "")}.`);
    await sendText(user.telegram_id, `💰 Администратор начислил на твой баланс ${amount} ⭐.`).catch(() => {});
    return;
  }
}

async function startBotPolling() {
  if (!BOT_TOKEN) { console.warn("BOT_TOKEN is not set. Telegram bot polling is disabled."); return; }
  try {
    await telegramApi("deleteWebhook", { drop_pending_updates: false });
    console.log("Telegram webhook cleared. Bot polling started.");
  } catch (error) { console.error("Could not clear Telegram webhook:", error.message); }
  const poll = async () => {
    try {
      const updates = await telegramApi("getUpdates", { offset: updateOffset, timeout: 25, allowed_updates: ["message", "callback_query", "pre_checkout_query"] });
      for (const update of updates) {
        updateOffset = update.update_id + 1;
        try { await handleBotUpdate(update); }
        catch (error) { console.error("Telegram update error:", error.message); }
      }
    } catch (error) {
      console.error("Telegram polling error:", error.message);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }
    setImmediate(poll);
  };
  poll();
}

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    if (!ADMIN_IDS.size) console.warn("ADMIN_IDS is empty. No Telegram user can use /adm.");
    startBotPolling();
  });
}).catch(error => {
  console.error("Database initialization failed:", error);
  process.exit(1);
});
