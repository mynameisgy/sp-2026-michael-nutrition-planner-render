/* PostgreSQL 数据层（线上 / Supabase 用）。
   当环境变量 DATABASE_URL 存在时启用，函数签名与 db-sqlite.js 完全一致（全部 async）。
   依赖：npm 包 pg（Render 会在构建阶段自动 npm install）。
   测试：useDriver() 可注入任意实现了 query(text, values) -> {rows:[]} 的驱动（如 PGlite）。 */
"use strict";

var fs = require("fs");
var path = require("path");
var seed = require("./seed");

var SCHEMA_PATH = path.join(__dirname, "..", "sql", "schema.sql");

var pool = null;
var injected = null;

/* 仅供测试注入驱动 */
function useDriver(d) { injected = d; pool = null; }

function isLocal(cs) { return /@(localhost|127\.0\.0\.1)/.test(cs); }

function getPool() {
  if (pool) return pool;
  var cs = process.env.DATABASE_URL || "";
  if (!cs) throw new Error("DATABASE_URL 未设置");
  /* eslint-disable-next-line */
  var Pool = require("pg").Pool;
  pool = new Pool({
    connectionString: cs,
    // Supabase / 云端 Postgres 一律走 SSL；本地 127.0.0.1 不启用
    ssl: isLocal(cs) ? undefined : { rejectUnauthorized: false },
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 20000
  });
  pool.on("error", function (e) { console.error("[db-pg] 连接池错误:", e.message); });
  return pool;
}

function query(text, values) {
  if (injected) {
    return Promise.resolve(injected.query(text, values)).then(function (r) { return r.rows; });
  }
  return getPool().query(text, values).then(function (r) { return r.rows; });
}

/* pg 会自动把 jsonb 解析成对象；sqlite 存的是字符串，这里做兼容 */
function j(v, def) {
  if (v === null || v === undefined) return def;
  if (typeof v === "string") { try { return JSON.parse(v); } catch (e) { return def; } }
  return v;
}

/* 把 schema.sql 拆成单条语句执行（多语句在扩展协议下不被允许，且便于定位错误） */
function splitStatements(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .split(";")
    .map(function (s) { return s.trim(); })
    .filter(Boolean);
}

/* ---------- 初始化 ---------- */
async function init() {
  var stmts = splitStatements(fs.readFileSync(SCHEMA_PATH, "utf8"));
  for (var s of stmts) { await query(s); }
  await seedIfEmpty();
  return "postgres";
}

/* ---------- 种子（仅当为空时） ---------- */
async function seedIfEmpty() {
  var c;
  c = (await query("SELECT COUNT(*)::int AS c FROM standards"))[0].c;
  if (c === 0) {
    for (var role of Object.keys(seed.STANDARDS)) {
      var s = seed.STANDARDS[role];
      var data = {};
      Object.keys(s).forEach(function (k) { if (k !== "label") data[k] = s[k]; });
      await query(
        "INSERT INTO standards (role, label, data) VALUES ($1,$2,$3::jsonb) ON CONFLICT (role) DO NOTHING",
        [role, s.label, JSON.stringify(data)]
      );
    }
  }
  c = (await query("SELECT COUNT(*)::int AS c FROM recipes"))[0].c;
  if (c === 0) {
    for (var r of seed.RECIPES) {
      await query(
        "INSERT INTO recipes (id,name,who,tags,time,ing,steps,split,nutri) VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb) ON CONFLICT (id) DO NOTHING",
        [r.id, r.name, r.who, JSON.stringify(r.tags || []), r.time || 0, JSON.stringify(r.ing || []), JSON.stringify(r.steps || []), r.split || "", JSON.stringify(r.nutri || {})]
      );
    }
  }
  c = (await query("SELECT COUNT(*)::int AS c FROM week"))[0].c;
  if (c === 0) {
    for (var i = 0; i < seed.WEEK.length; i++) {
      var d = seed.WEEK[i];
      await query(
        "INSERT INTO week (idx,label,slots) VALUES ($1,$2,$3::jsonb) ON CONFLICT (idx) DO NOTHING",
        [i, d.label, JSON.stringify(d.slots)]
      );
    }
  }
  c = (await query("SELECT COUNT(*)::int AS c FROM pantry"))[0].c;
  if (c === 0) {
    for (var p of seed.PANTRY) {
      await query(
        "INSERT INTO pantry (name,qty,unit,bought,exp) VALUES ($1,$2,$3,$4,$5)",
        [p.name, p.qty, p.unit, p.bought, p.exp]
      );
    }
  }
  c = (await query("SELECT COUNT(*)::int AS c FROM members"))[0].c;
  if (c === 0) {
    for (var m of seed.MEMBERS) {
      await query(
        "INSERT INTO members (id,name,emoji,color,gender,age_years,age_months,relation,conditions,activity,notes,sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12) ON CONFLICT (id) DO NOTHING",
        [m.id, m.name, m.emoji, m.color, m.gender, m.ageYears, m.ageMonths, m.relation, JSON.stringify(m.conditions || []), m.activity || "moderate", m.notes || "", m.sort || 0]
      );
    }
  }
}

/* ---------- 营养标准 ---------- */
async function getStandards() {
  var rows = await query("SELECT role, label, data FROM standards");
  var out = {};
  rows.forEach(function (r) {
    var data = j(r.data, {});
    data.label = r.label;
    out[r.role] = data;
  });
  return out;
}
async function putStandards(obj) {
  for (var role of Object.keys(obj)) {
    var v = obj[role];
    var label = v.label || role;
    var data = {};
    Object.keys(v).forEach(function (k) { if (k !== "label") data[k] = v[k]; });
    await query(
      "INSERT INTO standards (role,label,data) VALUES ($1,$2,$3::jsonb) ON CONFLICT (role) DO UPDATE SET label=EXCLUDED.label, data=EXCLUDED.data",
      [role, label, JSON.stringify(data)]
    );
  }
  return getStandards();
}

/* ---------- 食谱 ---------- */
function rowToRecipe(r) {
  return {
    id: r.id, name: r.name, who: r.who, tags: j(r.tags, []),
    time: r.time, ing: j(r.ing, []), steps: j(r.steps, []),
    split: r.split, nutri: j(r.nutri, {})
  };
}
async function listRecipes() {
  return (await query("SELECT * FROM recipes ORDER BY id")).map(rowToRecipe);
}
async function getRecipe(id) {
  var rows = await query("SELECT * FROM recipes WHERE id=$1", [id]);
  return rows.length ? rowToRecipe(rows[0]) : null;
}
async function createRecipe(r) {
  var id = r.id || ("r" + Date.now());
  await query(
    "INSERT INTO recipes (id,name,who,tags,time,ing,steps,split,nutri) VALUES ($1,$2,$3,$4::jsonb,$5,$6::jsonb,$7::jsonb,$8,$9::jsonb)",
    [id, r.name, r.who, JSON.stringify(r.tags || []), r.time || 0, JSON.stringify(r.ing || []), JSON.stringify(r.steps || []), r.split || "", JSON.stringify(r.nutri || {})]
  );
  return getRecipe(id);
}
async function updateRecipe(id, r) {
  await query(
    "UPDATE recipes SET name=$1, who=$2, tags=$3::jsonb, time=$4, ing=$5::jsonb, steps=$6::jsonb, split=$7, nutri=$8::jsonb WHERE id=$9",
    [r.name, r.who, JSON.stringify(r.tags || []), r.time || 0, JSON.stringify(r.ing || []), JSON.stringify(r.steps || []), r.split || "", JSON.stringify(r.nutri || {}), id]
  );
  return getRecipe(id);
}
async function deleteRecipe(id) {
  await query("DELETE FROM recipes WHERE id=$1", [id]);
}

/* ---------- 周计划（单条语句批量 upsert，天然原子） ---------- */
async function getWeek() {
  var rows = await query("SELECT idx, label, slots FROM week ORDER BY idx");
  return rows.map(function (r) { return { label: r.label, slots: j(r.slots, {}) }; });
}
async function putWeek(arr) {
  if (!arr || !arr.length) return [];
  var cols = [], vals = [];
  arr.forEach(function (d, i) {
    cols.push("($" + (i * 3 + 1) + ",$" + (i * 3 + 2) + ",$" + (i * 3 + 3) + "::jsonb)");
    vals.push(i, d.label, JSON.stringify(d.slots || {}));
  });
  await query(
    "INSERT INTO week (idx,label,slots) VALUES " + cols.join(",") +
    " ON CONFLICT (idx) DO UPDATE SET label=EXCLUDED.label, slots=EXCLUDED.slots",
    vals
  );
  return getWeek();
}

/* ---------- 库存 ---------- */
async function listPantry() {
  return await query("SELECT id, name, qty, unit, bought, exp FROM pantry ORDER BY id");
}
async function addPantry(p) {
  var rows = await query(
    "INSERT INTO pantry (name,qty,unit,bought,exp) VALUES ($1,$2,$3,$4,$5) RETURNING id,name,qty,unit,bought,exp",
    [p.name, p.qty, p.unit, p.bought, p.exp]
  );
  return rows[0];
}
async function deletePantry(id) {
  await query("DELETE FROM pantry WHERE id=$1", [id]);
}

/* ---------- 家庭成员 ---------- */
function rowToMember(r) {
  return {
    id: r.id, name: r.name, emoji: r.emoji, color: r.color,
    gender: r.gender, ageYears: r.age_years, ageMonths: r.age_months,
    relation: r.relation, conditions: j(r.conditions, []),
    activity: r.activity, notes: r.notes, sort: r.sort
  };
}
async function listMembers() {
  return (await query("SELECT * FROM members ORDER BY sort, id")).map(rowToMember);
}
async function getMember(id) {
  var rows = await query("SELECT * FROM members WHERE id=$1", [id]);
  return rows.length ? rowToMember(rows[0]) : null;
}
async function createMember(m) {
  var id = m.id || ("m" + Date.now());
  await query(
    "INSERT INTO members (id,name,emoji,color,gender,age_years,age_months,relation,conditions,activity,notes,sort) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12)",
    [id, m.name || "新成员", m.emoji || "👤", m.color || "#888888", m.gender || "female",
      m.ageYears || 0, m.ageMonths || 0, m.relation || "", JSON.stringify(m.conditions || []),
      m.activity || "moderate", m.notes || "", m.sort != null ? m.sort : 99]
  );
  return getMember(id);
}
async function updateMember(id, m) {
  await query(
    "UPDATE members SET name=$1, emoji=$2, color=$3, gender=$4, age_years=$5, age_months=$6, relation=$7, conditions=$8::jsonb, activity=$9, notes=$10, sort=$11 WHERE id=$12",
    [m.name, m.emoji, m.color, m.gender, m.ageYears || 0, m.ageMonths || 0, m.relation,
      JSON.stringify(m.conditions || []), m.activity || "moderate", m.notes || "", m.sort != null ? m.sort : 99, id]
  );
  return getMember(id);
}
async function deleteMember(id) {
  await query("DELETE FROM members WHERE id=$1", [id]);
  var week = await getWeek();
  var changed = false;
  week.forEach(function (day) {
    Object.keys(day.slots).forEach(function (sk) {
      if (day.slots[sk] && day.slots[sk][id] != null) { delete day.slots[sk][id]; changed = true; }
    });
  });
  if (changed) await putWeek(week);
}

/* ---------- 通用 KV ---------- */
async function getKv(key, def) {
  var rows = await query("SELECT value FROM kv WHERE key=$1", [key]);
  if (!rows.length) return def;
  return j(rows[0].value, def);
}
async function setKv(key, val) {
  await query(
    "INSERT INTO kv (key,value) VALUES ($1,$2::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value",
    [key, JSON.stringify(val === undefined ? null : val)]
  );
}

/* ---------- 购物清单计算（计划用量 − 库存） ---------- */
function toG(item) {
  var u = item.unit;
  if (u === "kg") return item.qty * 1000;
  if (u === "g") return item.qty;
  if (u === "L" || u === "l") return item.qty * 1000;
  if (u === "个") return item.qty * 60;
  return item.qty;
}
function fmtG(g) {
  if (g >= 1000) return (g / 1000).toFixed(g % 1000 === 0 ? 0 : 1) + " kg";
  return Math.round(g) + " g";
}
async function computeShopping() {
  var recipes = {};
  (await listRecipes()).forEach(function (r) { recipes[r.id] = r; });
  var need = {};
  (await getWeek()).forEach(function (day) {
    var slots = day.slots;
    Object.keys(slots).forEach(function (sk) {
      var meal = slots[sk] || {};
      Object.keys(meal).forEach(function (who) {
        var rid = meal[who];
        if (!rid || !recipes[rid]) return;
        (recipes[rid].ing || []).forEach(function (ing) {
          if (!need[ing.name]) need[ing.name] = { g: 0, cat: ing.cat || "其他" };
          need[ing.name].g += ing.g;
        });
      });
    });
  });
  (await listPantry()).forEach(function (p) {
    if (need[p.name]) {
      var have = toG(p);
      if (have >= need[p.name].g) delete need[p.name];
      else need[p.name].g -= have;
    }
  });
  var groups = {};
  Object.keys(need).forEach(function (name) {
    var cat = need[name].cat;
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push({ name: name, g: need[name].g, qty: fmtG(need[name].g) });
  });
  return groups;
}

async function getState() {
  return {
    standards: await getStandards(),
    members: await listMembers(),
    recipes: await listRecipes(),
    week: await getWeek(),
    pantry: await listPantry(),
    shoppingChecked: await getKv("shoppingChecked", {}),
    doneMeals: await getKv("doneMeals", {})
  };
}

module.exports = {
  driver: "postgres",
  useDriver: useDriver,
  init: init,
  getState: getState,
  getStandards: getStandards, putStandards: putStandards,
  listMembers: listMembers, getMember: getMember, createMember: createMember, updateMember: updateMember, deleteMember: deleteMember,
  listRecipes: listRecipes, getRecipe: getRecipe, createRecipe: createRecipe, updateRecipe: updateRecipe, deleteRecipe: deleteRecipe,
  getWeek: getWeek, putWeek: putWeek,
  listPantry: listPantry, addPantry: addPantry, deletePantry: deletePantry,
  getKv: getKv, setKv: setKv,
  computeShopping: computeShopping
};
