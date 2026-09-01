/* 生成离线预览快照 .snail/offline-preview.html
 *
 * 用途：前端所有数据都来自后端接口，直接双击 index.html（或用静态方式打开）
 *       会因为 fetch 不到 /api/state 而变成空白页。这个脚本把当前数据
 *       「烘焙」进一个单文件 HTML，用一个假的 fetch 顶替后端接口，
 *       于是无需启动服务也能完整浏览 / 演示页面。
 *
 * 用法：node --experimental-sqlite scripts/make-offline-preview.js
 *      （数据直接从 SQLite 读取，不要求服务已启动）
 */
"use strict";

var fs = require("fs");
var path = require("path");
var cp = require("child_process");
var db = require("../server/db");
var planner = require("../server/planner");

var ROOT = path.join(__dirname, "..");
var OUT = path.join(ROOT, ".snail", "offline-preview.html");

function read(f) { return fs.readFileSync(path.join(ROOT, f), "utf8"); }

function getVersion() {
  try {
    var out = cp.execSync("git tag --sort=-v:refname", { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    var lines = out.split(/\r?\n/).filter(Boolean);
    if (lines.length) return lines[0].replace(/^v/, "");
  } catch (e) {}
  try { return JSON.parse(read("version.json")).version.replace(/^v/i, ""); } catch (e) {}
  try { return JSON.parse(read("package.json")).version; } catch (e) {}
  return "1.0.0";
}

/* 离线模式下的 fetch 替身：GET 走内嵌数据，写操作一律返回 ok（不落库） */
function shim(snapshot) {
  return [
    "/* ---- 离线快照模式：以下 fetch 为本地替身，不发起真实网络请求 ---- */",
    "(function () {",
    "  window.__OFFLINE_PLANS = " + JSON.stringify(snapshot.memberPlans || {}) + ";",
    "  var DATA = " + JSON.stringify(snapshot) + ";",
    "  var ROUTES = {",
    "    '/api/state': DATA.state,",
    "    '/api/version': { version: DATA.version },",
    "    '/api/health': { ok: true, driver: DATA.driver, version: DATA.version },",
    "    '/api/standards': DATA.state.standards,",
    "    '/api/members': DATA.state.members,",
    "    '/api/recipes': DATA.state.recipes,",
    "    '/api/week': DATA.state.week,",
    "    '/api/pantry': DATA.state.pantry,",
    "    '/api/shopping': DATA.shopping",
    "  };",
    "  function reply(body, ok) {",
    "    return Promise.resolve({ ok: ok !== false, status: ok === false ? 404 : 200,",
    "      json: function () { return Promise.resolve(body); },",
    "      text: function () { return Promise.resolve(JSON.stringify(body)); } });",
    "  }",
    "  window.fetch = function (p, opts) {",
    "    opts = opts || {};",
    "    var path = String(p).split('?')[0];",
    "    var m = path.match(/^\\/api\\/kv\\/(.+)$/);",
    "    if (m) {",
    "      var key = decodeURIComponent(m[1]);",
    "      if (opts.method === 'PUT') { try { DATA.state[key] = JSON.parse(opts.body || '{}').value; } catch (e) {} return reply({ ok: true }); }",
    "      return reply({ value: DATA.state[key] || {} });",
    "    }",
    "    if (Object.prototype.hasOwnProperty.call(ROUTES, path)) return reply(ROUTES[path]);",
    "    if (opts.method && opts.method !== 'GET') return reply({ ok: true });",
    "    return reply({ error: 'offline: no such route' }, false);",
    "  };",
    "})();"
  ].join("\n");
}

async function main() {
  var driver = await db.init();
  var state = await db.getState();
  var shopping;
  try { shopping = await db.computeShopping(); } catch (e) { shopping = null; }

  var memberPlans = {};
  (state.members || []).forEach(function (m) {
    memberPlans[m.id] = {
      target: planner.deriveTarget(m),
      advice: planner.memberAdvice(m),
      disclaimer: planner.DISCLAIMER
    };
  });

  var snapshot = {
    version: getVersion(),
    driver: driver,
    generated_at: new Date().toISOString(),
    state: state,
    shopping: shopping,
    memberPlans: memberPlans
  };

  var html = read("index.html")
    .replace(/<link rel="stylesheet"[^>]*>/i, "<style>\n" + read("styles.css") + "\n</style>")
    .replace(/<script src="app\.js"><\/script>/i,
      "<script>\n" + shim(snapshot) + "\n</script>\n<script>\n" + read("app.js") + "\n</script>");

  if (html.indexOf("window.fetch") < 0) {
    console.error("❌ 生成失败：没能把离线替身注入 index.html，请检查 index.html 里的 <script src=\"app.js\"> 标签是否变动。");
    process.exit(1);
  }

  fs.mkdirSync(path.join(ROOT, ".snail"), { recursive: true });
  fs.writeFileSync(OUT, html, "utf8");

  console.log("✅ 离线预览快照已生成：" + path.relative(ROOT, OUT));
  console.log("   版本：" + snapshot.version + " | 存储：" + driver +
    " | 食谱 " + (state.recipes || []).length + " 条，库存 " + (state.pantry || []).length + " 条");
  console.log("   提示：这是数据快照（写操作不会保存），日常使用请跑 node --experimental-sqlite server/server.js");
}

main().catch(function (e) {
  console.error("❌ 生成离线预览失败：", e && e.message ? e.message : e);
  process.exit(1);
});
