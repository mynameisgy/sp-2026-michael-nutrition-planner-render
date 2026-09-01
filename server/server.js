/* 家庭营养 · 食材规划 — Node 后端
   职责：托管静态前端 + 后台管理页，提供 REST API。
   存储：DATABASE_URL 存在时走 PostgreSQL（Supabase），否则走本地 SQLite。 */
"use strict";

var http = require("http");
var fs = require("fs");
var path = require("path");
var url = require("url");
var db = require("./db");
var planner = require("./planner");
var cp = require("child_process");

var ROOT = path.join(__dirname, "..");
var PORT = process.env.PORT || 3000;

var MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".ico": "image/x-icon" };
var STATIC_OK = ["index.html", "styles.css", "app.js", "admin.html", "admin.js"];

function sendJSON(res, code, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(body);
}
function readBody(req) {
  return new Promise(function (resolve, reject) {
    var buf = "";
    req.on("data", function (c) { buf += c; if (buf.length > 5e6) req.destroy(); });
    req.on("end", function () {
      if (!buf) return resolve({});
      try { resolve(JSON.parse(buf)); } catch (e) { reject(e); }
    });
    req.on("error", reject);
  });
}
function serveStatic(res, file) {
  var fp = path.join(ROOT, file);
  if (STATIC_OK.indexOf(file) < 0 || !fs.existsSync(fp)) { res.writeHead(404); res.end("Not found"); return; }
  res.writeHead(200, { "Content-Type": MIME[path.extname(fp)] || "text/plain" });
  fs.createReadStream(fp).pipe(res);
}

function getVersion() {
  // 优先取 git tag；没有 .git 的环境（例如用代码包直接部署）退回到 version.json
  try {
    var out = cp.execSync("git tag --sort=-v:refname", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    var lines = out.split(/\r?\n/).filter(Boolean);
    if (lines.length) return lines[0].replace(/^v/, "");
  } catch (e) {}
  try {
    var v = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).version;
    if (v) return String(v).replace(/^v/i, "");
  } catch (e) {}
  return "1.0.0";
}

/* ---------- API ---------- */
async function handleApi(api, method, req, res) {
  // 健康检查（Render health check / 保活 cron 用）
  if (api === "health" && method === "GET") {
    return sendJSON(res, 200, { ok: true, driver: db.driver, version: getVersion() });
  }

  // 状态聚合
  if (api === "state" && method === "GET") {
    return sendJSON(res, 200, await db.getState());
  }

  // 版本号（取自 git tag，去掉前缀 v；无 tag 时回退 1.0.0）
  if (api === "version" && method === "GET") {
    return sendJSON(res, 200, { version: getVersion() });
  }

  // 营养标准
  if (api === "standards" && method === "GET") {
    return sendJSON(res, 200, await db.getStandards());
  }
  if (api === "standards" && method === "PUT") {
    var st;
    try { st = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: "bad json" }); }
    return sendJSON(res, 200, await db.putStandards(st));
  }

  // 购物清单（计算）
  if (api === "shopping" && method === "GET") {
    return sendJSON(res, 200, await db.computeShopping());
  }

  // 家庭成员
  if (api === "members" && method === "GET") {
    return sendJSON(res, 200, await db.listMembers());
  }
  if (api === "members" && method === "POST") {
    var nm;
    try { nm = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: "bad json" }); }
    return sendJSON(res, 201, await db.createMember(nm));
  }
  var mm = api.match(/^members\/(.+)$/);
  if (mm) {
    var raw = decodeURIComponent(mm[1]);
    var planMatch = raw.match(/^(.+)\/plan$/);
    if (planMatch) {
      var pid = planMatch[1];
      if (method === "POST") {
        var member = await db.getMember(pid);
        if (!member) return sendJSON(res, 404, { error: "member not found" });
        var pb;
        try { pb = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: "bad json" }); }
        var recipes = await db.listRecipes();
        var curWeek = pb.week || (await db.getWeek());
        var gen = planner.generateMemberWeek(member, recipes);
        var merged = curWeek.map(function (d, i) {
          var slots = {};
          Object.keys(d.slots || {}).forEach(function (sk) { slots[sk] = Object.assign({}, d.slots[sk]); });
          if (gen[i] && gen[i].slots) {
            Object.keys(gen[i].slots).forEach(function (sk) { slots[sk][pid] = gen[i].slots[sk]; });
          }
          return { label: d.label, slots: slots };
        });
        // 同时补全该成员在「共享」餐次里缺失的分配（保证每餐都有菜）
        merged.forEach(function (d) {
          Object.keys(d.slots || {}).forEach(function (sk) {
            var cell = d.slots[sk];
            if (!cell[pid]) {
              // 取同餐其他成员的第一道菜作为兜底（家庭同餐）
              var others = Object.keys(cell).map(function (k) { return cell[k]; }).filter(Boolean);
              cell[pid] = others.length ? others[0] : null;
            }
          });
        });
        return sendJSON(res, 200, {
          week: merged,
          target: planner.deriveTarget(member),
          advice: planner.memberAdvice(member),
          disclaimer: planner.DISCLAIMER
        });
      }
    }
    if (method === "PUT") {
      var um;
      try { um = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: "bad json" }); }
      return sendJSON(res, 200, await db.updateMember(raw, um));
    }
    if (method === "DELETE") {
      await db.deleteMember(raw);
      return sendJSON(res, 200, { ok: true });
    }
  }

  // 食谱 CRUD
  if (api === "recipes" && method === "GET") {
    return sendJSON(res, 200, await db.listRecipes());
  }
  if (api === "recipes" && method === "POST") {
    var nr;
    try { nr = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: "bad json" }); }
    return sendJSON(res, 201, await db.createRecipe(nr));
  }
  var rm = api.match(/^recipes\/(.+)$/);
  if (rm) {
    var rid = decodeURIComponent(rm[1]);
    if (method === "PUT") {
      var ur;
      try { ur = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: "bad json" }); }
      return sendJSON(res, 200, await db.updateRecipe(rid, ur));
    }
    if (method === "DELETE") {
      await db.deleteRecipe(rid);
      return sendJSON(res, 200, { ok: true });
    }
  }

  // 周计划
  if (api === "week" && method === "GET") {
    return sendJSON(res, 200, await db.getWeek());
  }
  if (api === "week" && method === "PUT") {
    var nw;
    try { nw = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: "bad json" }); }
    return sendJSON(res, 200, await db.putWeek(nw));
  }

  // 库存 CRUD
  if (api === "pantry" && method === "GET") {
    return sendJSON(res, 200, await db.listPantry());
  }
  if (api === "pantry" && method === "POST") {
    var np;
    try { np = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: "bad json" }); }
    return sendJSON(res, 201, await db.addPantry(np));
  }
  var pm = api.match(/^pantry\/(.+)$/);
  if (pm) {
    if (method === "DELETE") {
      await db.deletePantry(decodeURIComponent(pm[1]));
      return sendJSON(res, 200, { ok: true });
    }
  }

  // 通用 KV（采购勾选 / 餐次完成）
  var km = api.match(/^kv\/(.+)$/);
  if (km) {
    var key = decodeURIComponent(km[1]);
    if (method === "GET") {
      return sendJSON(res, 200, { value: await db.getKv(key, {}) });
    }
    if (method === "PUT") {
      var kv;
      try { kv = await readBody(req); } catch (e) { return sendJSON(res, 400, { error: "bad json" }); }
      await db.setKv(key, kv.value);
      return sendJSON(res, 200, { ok: true });
    }
  }

  return sendJSON(res, 404, { error: "api not found" });
}

/* ---------- 请求分发 ---------- */
async function handle(req, res) {
  var u = url.parse(req.url, true);
  var pathname = u.pathname;
  var method = req.method;

  if (pathname.indexOf("/api/") === 0) {
    return handleApi(pathname.slice(5), method, req, res); // 去掉 /api/
  }

  if (method !== "GET") { res.writeHead(405); res.end("Method Not Allowed"); return; }
  if (pathname === "/" || pathname === "/index.html") return serveStatic(res, "index.html");
  if (pathname === "/admin" || pathname === "/admin.html") return serveStatic(res, "admin.html");
  var base = path.basename(pathname);
  if (STATIC_OK.indexOf(base) >= 0) return serveStatic(res, base);
  res.writeHead(404); res.end("Not found");
}

var server = http.createServer(function (req, res) {
  Promise.resolve()
    .then(function () { return handle(req, res); })
    .catch(function (e) {
      console.error("[server] 请求处理失败:", e);
      if (!res.headersSent) sendJSON(res, 500, { error: "server error", detail: e && e.message });
      else res.end();
    });
});

db.init().then(function (driver) {
  server.listen(PORT, function () {
    console.log("家庭营养规划服务已启动: http://localhost:" + PORT);
    console.log("前台: /   后台管理: /admin");
    console.log("数据存储: " + driver);
  });
}).catch(function (e) {
  console.error("数据库初始化失败，服务未启动:", e);
  process.exit(1);
});

module.exports = server;
