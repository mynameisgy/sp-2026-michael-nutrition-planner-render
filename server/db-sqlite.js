/* SQLite 数据层（本地开发用）：建表、种子、查询与计算。
   使用 Node 内置 node:sqlite，零 npm 依赖。
   对外统一为 async API，与 db-pg.js 保持完全一致，便于线上切换到 Postgres。 */
"use strict";

var path = require("path");
var fs = require("fs");
var DatabaseSync = require("node:sqlite").DatabaseSync;
var seed = require("./seed");

var DATA_DIR = path.join(__dirname, "..", "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
var DB_PATH = process.env.NUTRI_DB || path.join(DATA_DIR, "nutri.db");

var db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");

/* ---------- 初始化 ---------- */
async function init() {
  db.exec([
    "CREATE TABLE IF NOT EXISTS standards (role TEXT PRIMARY KEY, label TEXT, data TEXT);",
    "CREATE TABLE IF NOT EXISTS recipes (id TEXT PRIMARY KEY, name TEXT, who TEXT, tags TEXT, time INTEGER DEFAULT 0, ing TEXT, steps TEXT, split TEXT, nutri TEXT);",
    "CREATE TABLE IF NOT EXISTS week (idx INTEGER PRIMARY KEY, label TEXT, slots TEXT);",
    "CREATE TABLE IF NOT EXISTS pantry (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, qty REAL, unit TEXT, bought TEXT, exp TEXT);",
    "CREATE TABLE IF NOT EXISTS members (id TEXT PRIMARY KEY, name TEXT, emoji TEXT, color TEXT, gender TEXT, age_years INTEGER, age_months INTEGER, relation TEXT, conditions TEXT, activity TEXT, notes TEXT, sort INTEGER);",
    "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT);"
  ].join(""));
  await seedIfEmpty();
  return "sqlite";
}

/* ---------- 种子（仅当为空时） ---------- */
async function seedIfEmpty() {
  if (db.prepare("SELECT COUNT(*) AS c FROM standards").get().c === 0) {
    Object.keys(seed.STANDARDS).forEach(function (role) {
      var s = seed.STANDARDS[role];
      var data = {};
      Object.keys(s).forEach(function (k) { if (k !== "label") data[k] = s[k]; });
      db.prepare("INSERT INTO standards (role, label, data) VALUES (?, ?, ?)").run(role, s.label, JSON.stringify(data));
    });
  }
  if (db.prepare("SELECT COUNT(*) AS c FROM recipes").get().c === 0) {
    seed.RECIPES.forEach(function (r) {
      db.prepare("INSERT INTO recipes (id,name,who,tags,time,ing,steps,split,nutri) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(r.id, r.name, r.who, JSON.stringify(r.tags || []), r.time, JSON.stringify(r.ing), JSON.stringify(r.steps), r.split || "", JSON.stringify(r.nutri));
    });
  }
  if (db.prepare("SELECT COUNT(*) AS c FROM week").get().c === 0) {
    seed.WEEK.forEach(function (d, i) {
      db.prepare("INSERT INTO week (idx, label, slots) VALUES (?, ?, ?)").run(i, d.label, JSON.stringify(d.slots));
    });
  }
  if (db.prepare("SELECT COUNT(*) AS c FROM pantry").get().c === 0) {
    seed.PANTRY.forEach(function (p) {
      db.prepare("INSERT INTO pantry (name, qty, unit, bought, exp) VALUES (?, ?, ?, ?, ?)")
        .run(p.name, p.qty, p.unit, p.bought, p.exp);
    });
  }
  if (db.prepare("SELECT COUNT(*) AS c FROM members").get().c === 0) {
    seed.MEMBERS.forEach(function (m) {
      db.prepare("INSERT INTO members (id,name,emoji,color,gender,age_years,age_months,relation,conditions,activity,notes,sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .run(m.id, m.name, m.emoji, m.color, m.gender, m.ageYears, m.ageMonths, m.relation, JSON.stringify(m.conditions || []), m.activity || "moderate", m.notes || "", m.sort || 0);
    });
  }
}

/* ---------- helpers ---------- */
async function getStandards() {
  var rows = db.prepare("SELECT role, label, data FROM standards").all();
  var out = {};
  rows.forEach(function (r) {
    var data = JSON.parse(r.data);
    data.label = r.label;
    out[r.role] = data;
  });
  return out;
}
async function putStandards(obj) {
  Object.keys(obj).forEach(function (role) {
    var v = obj[role];
    var label = v.label || role;
    var data = {};
    Object.keys(v).forEach(function (k) { if (k !== "label") data[k] = v[k]; });
    db.prepare("INSERT INTO standards (role, label, data) VALUES (?, ?, ?) ON CONFLICT(role) DO UPDATE SET label=excluded.label, data=excluded.data")
      .run(role, label, JSON.stringify(data));
  });
  return getStandards();
}

function rowToRecipe(r) {
  return {
    id: r.id, name: r.name, who: r.who, tags: JSON.parse(r.tags || "[]"),
    time: r.time, ing: JSON.parse(r.ing || "[]"), steps: JSON.parse(r.steps || "[]"),
    split: r.split, nutri: JSON.parse(r.nutri || "{}")
  };
}
async function listRecipes() { return db.prepare("SELECT * FROM recipes ORDER BY id").all().map(rowToRecipe); }
async function getRecipe(id) { var r = db.prepare("SELECT * FROM recipes WHERE id=?").get(id); return r ? rowToRecipe(r) : null; }
async function createRecipe(r) {
  var id = r.id || ("r" + Date.now());
  db.prepare("INSERT INTO recipes (id,name,who,tags,time,ing,steps,split,nutri) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(id, r.name, r.who, JSON.stringify(r.tags || []), r.time || 0, JSON.stringify(r.ing || []), JSON.stringify(r.steps || []), r.split || "", JSON.stringify(r.nutri || {}));
  return getRecipe(id);
}
async function updateRecipe(id, r) {
  db.prepare("UPDATE recipes SET name=?, who=?, tags=?, time=?, ing=?, steps=?, split=?, nutri=? WHERE id=?")
    .run(r.name, r.who, JSON.stringify(r.tags || []), r.time || 0, JSON.stringify(r.ing || []), JSON.stringify(r.steps || []), r.split || "", JSON.stringify(r.nutri || {}), id);
  return getRecipe(id);
}
async function deleteRecipe(id) { db.prepare("DELETE FROM recipes WHERE id=?").run(id); }

async function getWeek() {
  var rows = db.prepare("SELECT idx, label, slots FROM week ORDER BY idx").all();
  return rows.map(function (r) { return { label: r.label, slots: JSON.parse(r.slots) }; });
}
async function putWeek(arr) {
  var tx = db.prepare("INSERT INTO week (idx, label, slots) VALUES (?, ?, ?) ON CONFLICT(idx) DO UPDATE SET label=excluded.label, slots=excluded.slots");
  db.exec("BEGIN");
  arr.forEach(function (d, i) { tx.run(i, d.label, JSON.stringify(d.slots)); });
  db.exec("COMMIT");
  return getWeek();
}

async function listPantry() {
  return db.prepare("SELECT id, name, qty, unit, bought, exp FROM pantry ORDER BY id").all();
}
async function addPantry(p) {
  var info = db.prepare("INSERT INTO pantry (name, qty, unit, bought, exp) VALUES (?, ?, ?, ?, ?)")
    .run(p.name, p.qty, p.unit, p.bought, p.exp);
  return db.prepare("SELECT * FROM pantry WHERE id=?").get(info.lastInsertRowid);
}
async function deletePantry(id) { db.prepare("DELETE FROM pantry WHERE id=?").run(id); }

async function getKv(key, def) {
  var r = db.prepare("SELECT value FROM kv WHERE key=?").get(key);
  if (!r) return def;
  try { return JSON.parse(r.value); } catch (e) { return def; }
}
async function setKv(key, val) {
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value")
    .run(key, JSON.stringify(val));
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

/* ---------- 家庭成员 ---------- */
function rowToMember(r) {
  return {
    id: r.id, name: r.name, emoji: r.emoji, color: r.color,
    gender: r.gender, ageYears: r.age_years, ageMonths: r.age_months,
    relation: r.relation, conditions: JSON.parse(r.conditions || "[]"),
    activity: r.activity, notes: r.notes, sort: r.sort
  };
}
async function listMembers() {
  return db.prepare("SELECT * FROM members ORDER BY sort, id").all().map(rowToMember);
}
async function getMember(id) {
  var r = db.prepare("SELECT * FROM members WHERE id=?").get(id);
  return r ? rowToMember(r) : null;
}
async function createMember(m) {
  var id = m.id || ("m" + Date.now());
  db.prepare("INSERT INTO members (id,name,emoji,color,gender,age_years,age_months,relation,conditions,activity,notes,sort) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, m.name || "新成员", m.emoji || "👤", m.color || "#888", m.gender || "female",
      m.ageYears || 0, m.ageMonths || 0, m.relation || "", JSON.stringify(m.conditions || []),
      m.activity || "moderate", m.notes || "", m.sort != null ? m.sort : 99);
  return getMember(id);
}
async function updateMember(id, m) {
  db.prepare("UPDATE members SET name=?, emoji=?, color=?, gender=?, age_years=?, age_months=?, relation=?, conditions=?, activity=?, notes=?, sort=? WHERE id=?")
    .run(m.name, m.emoji, m.color, m.gender, m.ageYears || 0, m.ageMonths || 0, m.relation,
      JSON.stringify(m.conditions || []), m.activity || "moderate", m.notes || "", m.sort != null ? m.sort : 99, id);
  return getMember(id);
}
async function deleteMember(id) {
  db.prepare("DELETE FROM members WHERE id=?").run(id);
  // 同步清理周计划中该成员的餐次分配
  var week = await getWeek();
  var changed = false;
  week.forEach(function (day) {
    Object.keys(day.slots).forEach(function (sk) {
      if (day.slots[sk] && day.slots[sk][id] != null) { delete day.slots[sk][id]; changed = true; }
    });
  });
  if (changed) await putWeek(week);
}

module.exports = {
  driver: "sqlite",
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
