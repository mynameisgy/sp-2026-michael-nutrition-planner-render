/* 家庭营养 · 食材规划 — 前端逻辑（API 驱动，数据为后端 SQLite 单一来源）
   成员模式：每位家庭成员是真实的人（年龄 / 性别 / 身体问题），全家共享周菜单，
   但每位成员看到自己的适配说明、红灯提醒，并可一键生成专属周方案。 */
(function () {
  "use strict";

  /* ---------- 营养追踪用到的营养素顺序（仅展示结构，数值来自后端标准） ---------- */
  var NUTRI_KEYS = [
    { k: "kcal", name: "能量", unit: "kcal" },
    { k: "protein", name: "蛋白质", unit: "g" },
    { k: "calcium", name: "钙", unit: "mg" },
    { k: "iron", name: "铁", unit: "mg" },
    { k: "zinc", name: "锌", unit: "mg" },
    { k: "vitC", name: "维C", unit: "mg" },
    { k: "dha", name: "DHA", unit: "mg" },
    { k: "folate", name: "叶酸", unit: "μg" },
    { k: "fiber", name: "膳食纤维", unit: "g" }
  ];

  /* 过敏食材（条件 → 需规避的食材名）；与 server/planner.js 保持一致 */
  var ALLERGEN = {
    allergy_egg: ["鸡蛋"], allergy_milk: ["牛奶", "酸奶"], allergy_seafood: ["鳕鱼", "三文鱼", "鲈鱼", "虾仁"],
    allergy_nut: ["核桃"], allergy_soy: ["豆腐"], allergy_wheat: ["面条", "全麦面包", "全麦馒头"]
  };
  /* 身体问题 → 推荐优先标签（命中即为绿灯） */
  var COND_HL = {
    pregnancy: ["补叶酸", "补铁", "补钙", "补DHA"], lactation: ["补钙", "补蛋白", "补DHA"],
    anemia: ["补铁", "补叶酸"], low_calcium: ["补钙"],
    hypertension: ["补纤维"], diabetes: ["补纤维"], hyperlipidemia: ["补纤维"]
  };

  /* ---------- 状态（来自后端） ---------- */
  var state = { standards: null, members: [], recipes: [], week: [], pantry: [], shoppingChecked: {}, doneMeals: {} };
  var currentPage = "today";
  var currentMember = null;       // 当前查看的成员 id
  var recipeFilter = { q: "", tag: "全部" };
  var lastShopping = null;
  var planCache = {};             // 成员方案缓存（target/advice/week）

  /* ---------- API ---------- */
  function api(path, opts) {
    opts = opts || {};
    opts.headers = { "Content-Type": "application/json" };
    return fetch(path, opts).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function showBackendError(detail) {
    var box = document.getElementById("view-container");
    if (box) {
      box.innerHTML =
        '<section class="page">' +
        '<div style="margin:24px 16px;padding:20px;border-radius:14px;background:#fff5f6;' +
        'border:1px solid #f3c6cc;color:#7a2b33;line-height:1.75;font-size:15px">' +
        '<div style="font-size:18px;font-weight:700;margin-bottom:10px">⚠️ 连不上后端，数据没拿到</div>' +
        '<div>这个页面所有数据都来自后端接口 <code>/api/state</code>，现在没取到，所以页面是空的（不是浏览器坏了）。</div>' +
        '<div style="margin-top:12px">请在项目目录执行：</div>' +
        '<pre style="margin:8px 0;padding:10px 12px;background:#fff;border:1px solid #f0d5d9;' +
        'border-radius:8px;overflow:auto">node --experimental-sqlite server/server.js</pre>' +
        '<div>然后用浏览器打开 <b>http://localhost:3000</b>（不要直接双击 index.html 打开）。</div>' +
        (detail ? '<div style="margin-top:10px;font-size:13px;color:#a4686f">错误详情：' + esc(String(detail)) + '</div>' : '') +
        "</div></section>";
    }
    toast("无法连接后端，请确认服务已启动 (node --experimental-sqlite server/server.js)");
  }
  function loadState(cb) {
    api("/api/state").then(function (s) {
      state = s;
      if (!currentMember && state.members && state.members.length) currentMember = state.members[0].id;
      cb && cb();
    }).catch(function (e) { showBackendError(e && e.message ? e.message : e); });
  }
  function loadVersion() {
    api("/api/version").then(function (d) {
      var el = document.getElementById("app-version");
      if (el && d && d.version) el.textContent = d.version;
    }).catch(function () {});
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; });
  }
  function daysAgo(n) {
    var d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  function byId(id) {
    for (var i = 0; i < state.recipes.length; i++) if (state.recipes[i].id === id) return state.recipes[i];
    return null;
  }
  function todayIndex() {
    var d = new Date().getDay();
    return d === 0 ? 6 : d - 1;
  }
  function fmtG(g) {
    if (g >= 1000) return (g / 1000).toFixed(g % 1000 === 0 ? 0 : 1) + " kg";
    return Math.round(g) + " g";
  }
  function toast(msg) {
    var t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2400);
  }

  /* ---------- 成员工具 ---------- */
  function members() { return state.members || []; }
  function memberById(id) {
    for (var i = 0; i < members().length; i++) if (members()[i].id === id) return members()[i];
    return null;
  }
  function currentMemberObj() { return memberById(currentMember) || members()[0]; }
  function memberAgeText(m) {
    var y = m.ageYears || 0, mo = m.ageMonths || 0;
    if (y < 1) return mo + "个月";
    if (mo > 0) return y + "岁" + mo + "个月";
    return y + "岁";
  }
  function portionFor(m) {
    var age = (m.ageYears || 0) + (m.ageMonths || 0) / 12;
    if (age < 3) return 0.5;
    if (age < 6) return 0.8;
    if (age < 18) return 0.9;
    if (age >= 65) return 0.9;
    return 1.0;
  }
  function memberBadge(m, extra) {
    var c = m.color || "#888";
    return '<span class="badge member" style="background:' + c + '22;color:' + c + '">' +
      (m.emoji || "👤") + " " + esc(m.name) + (extra ? " · " + esc(extra) : "") + "</span>";
  }
  /* 前端适配性（与 server/planner.js 同源逻辑） */
  function clientSuitability(m, recipe) {
    if (!recipe) return { status: "neutral", reasons: [] };
    var conds = m.conditions || [];
    var exclude = [];
    conds.forEach(function (c) { if (ALLERGEN[c]) exclude = exclude.concat(ALLERGEN[c]); });
    var ings = (recipe.ing || []).map(function (i) { return i.name; });
    var hit = exclude.filter(function (x) { return ings.indexOf(x) >= 0; });
    if (hit.length) return { status: "avoid", reasons: ["含过敏食材：" + hit.join("、")] };
    var hl = [];
    conds.forEach(function (c) {
      (COND_HL[c] || []).forEach(function (t) { if ((recipe.tags || []).indexOf(t) >= 0) hl.push(t); });
    });
    if (hl.length) return { status: "good", reasons: ["契合需求：" + hl.join("、")] };
    return { status: "neutral", reasons: [] };
  }
  function suitBadge(suit) {
    if (suit.status === "avoid") return '<span class="suit avoid">🔴 注意</span>';
    if (suit.status === "good") return '<span class="suit good">🟢 合适</span>';
    return '<span class="suit neutral">⚪ 普通</span>';
  }

  /* ---------- 渲染：成员切换条 ---------- */
  function renderMemberBar() {
    var bar = document.getElementById("member-bar");
    if (!bar) return;
    var html = "";
    members().forEach(function (m) {
      var active = m.id === currentMember ? " active" : "";
      html += '<div class="mchip' + active + '" data-mid="' + esc(m.id) + '" style="' +
        (m.id === currentMember ? "background:" + (m.color || "#888") + "22;border-color:" + (m.color || "#888") + ";" : "") + '">' +
        '<span class="m-emoji" style="background:' + (m.color || "#888") + '22">' + (m.emoji || "👤") + "</span>" +
        '<span class="m-name">' + esc(m.name) + "</span></div>";
    });
    html += '<a class="mchip add" href="/admin" title="添加 / 管理成员">＋</a>';
    bar.innerHTML = html;
    bar.querySelectorAll(".mchip[data-mid]").forEach(function (el) {
      el.addEventListener("click", function () {
        currentMember = el.getAttribute("data-mid");
        renderMemberBar();
        if (currentPage === "today") renderToday();
        else if (currentPage === "week") renderWeek();
        else if (currentPage === "plan") renderPlan();
      });
    });
  }

  /* ---------- 营养计算（按当前成员的份量折算） ---------- */
  function emptyNutri() { var o = {}; NUTRI_KEYS.forEach(function (n) { o[n.k] = 0; }); return o; }
  function addNutri(acc, recipe, factor) {
    if (!recipe) return;
    var nu = recipe.nutri || {};
    NUTRI_KEYS.forEach(function (n) { acc[n.k] += (nu[n.k] || 0) * factor; });
  }
  function dayNutriFor(day, mid) {
    var acc = emptyNutri();
    var m = memberById(mid);
    var factor = m ? portionFor(m) : 1;
    var slots = day.slots;
    Object.keys(slots).forEach(function (sk) {
      var rid = (slots[sk] || {})[mid];
      if (rid) addNutri(acc, byId(rid), factor);
    });
    return acc;
  }
  function weekNutriFor(mid) {
    var acc = emptyNutri();
    state.week.forEach(function (day) {
      var dn = dayNutriFor(day, mid);
      NUTRI_KEYS.forEach(function (n) { acc[n.k] += dn[n.k]; });
    });
    return acc;
  }

  /* ---------- 渲染：今日（当前成员） ---------- */
  function renderToday() {
    if (!members().length) return;
    var m = currentMemberObj();
    var box = document.getElementById("page-today");
    var idx = todayIndex();
    var day = state.week[idx];
    if (!day) return;
    var dateStr = new Date().toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" });
    document.getElementById("app-date").textContent = dateStr;

    var html = "";
    html += '<div class="card member-card" style="border-color:' + (m.color || "#888") + '55">' +
      '<div class="mc-head"><span class="mc-avatar" style="background:' + (m.color || "#888") + '">' + (m.emoji || "👤") + "</span>" +
      '<div><div class="mc-name">' + esc(m.name) + ' 的今日</div>' +
      '<div class="mc-sub">' + esc(m.relation || "") + " · " + memberAgeText(m) + " · " + (m.gender === "male" ? "男" : "女") + "</div></div></div>";
    html += '<p class="card-sub">👨‍👩‍👧‍👦 全家同餐的部分会标注「同餐」，分装时按 ' + esc(m.name) + " 的情况调整质地与调味。</p>";

    var slots = day.slots;
    var order = ["早", "早点", "午", "午点", "晚", "睡前"];
    order.forEach(function (sk) {
      var cell = slots[sk] || {};
      var rid = cell[currentMember];
      var shared = false;
      if (!rid) {
        var others = Object.keys(cell).map(function (k) { return cell[k]; }).filter(Boolean);
        rid = others.length ? others[0] : null;
        shared = true;
      }
      if (!rid) return;
      var r = byId(rid);
      var suit = clientSuitability(m, r);
      var timeLabel = sk === "睡前" ? "睡前" : (sk === "早点" ? "上午加餐" : sk === "午点" ? "下午加餐" : sk);
      html += '<div class="meal-block">';
      html += '<div class="meal-head"><span class="meal-time">' + esc(timeLabel) + "</span>";
      html += doneToggle(day.label, sk);
      html += "</div>";
      html += '<div class="meal-person"><span class="meal-dish">' + esc(r ? r.name : "—") + "</span> " + suitBadge(suit) + (shared ? ' <span class="badge common">🍳 同餐</span>' : "") + "</div>";
      if (suit.reasons.length) html += '<div class="adapt-note ' + suit.status + '">⚠️ ' + esc(suit.reasons.join("；")) + "</div>";
      if (r && r.split && !shared) html += '<div class="adapt-note">🍳 ' + esc(r.split) + "</div>";
      html += "</div>";
    });
    html += "</div>";
    box.innerHTML = html;
    bindDoneToggles(day.label);
  }
  function doneToggle(dayLabel, slot) {
    var key = dayLabel + "|" + slot;
    var done = state.doneMeals[key];
    return '<span class="check ' + (done ? "done" : "") + '" data-done="' + esc(key) + '">' + (done ? "✓" : "") + "</span>";
  }
  function bindDoneToggles(dayLabel) {
    document.querySelectorAll("#page-today .check").forEach(function (el) {
      el.addEventListener("click", function () {
        var key = el.getAttribute("data-done");
        state.doneMeals[key] = !state.doneMeals[key];
        renderToday();
        api("/api/kv/doneMeals", { method: "PUT", body: JSON.stringify({ value: state.doneMeals }) })
          .catch(function () { toast("保存失败，稍后重试"); });
      });
    });
  }

  /* ---------- 渲染：本周（当前成员） ---------- */
  function renderWeek() {
    if (!state.week.length || !members().length) return;
    var m = currentMemberObj();
    var box = document.getElementById("page-week");
    var idx = todayIndex();
    var html = '<div class="week-tabs" id="week-tabs">';
    state.week.forEach(function (day, i) {
      var active = i === idx ? " active" : "";
      html += '<div class="week-days' + active + '" data-day="' + i + '">' + esc(day.label) + '<small>' + (i === idx ? "今天" : "") + "</small></div>";
    });
    html += "</div><div id='week-day'></div>";
    box.innerHTML = html;
    renderWeekDay(idx, m);
    document.querySelectorAll("#week-tabs .week-days").forEach(function (el) {
      el.addEventListener("click", function () {
        var i = parseInt(el.getAttribute("data-day"), 10);
        document.querySelectorAll("#week-tabs .week-days").forEach(function (x) { x.classList.remove("active"); });
        el.classList.add("active");
        renderWeekDay(i, m);
      });
    });
  }
  function renderWeekDay(i, m) {
    var day = state.week[i];
    var html = '<div class="card member-card" style="border-color:' + (m.color || "#888") + '55">' +
      '<div class="mc-head"><span class="mc-avatar" style="background:' + (m.color || "#888") + '">' + (m.emoji || "👤") + "</span>" +
      '<div><div class="mc-name">' + esc(m.name) + " 的本周</div>" +
      '<div class="mc-sub">' + esc(day.label) + " · 红灯表示该餐含需要注意的食材</div></div></div>";
    var order = ["早", "早点", "午", "午点", "晚", "睡前"];
    order.forEach(function (sk) {
      var cell = day.slots[sk] || {};
      var rid = cell[currentMember];
      var shared = false;
      if (!rid) {
        var others = Object.keys(cell).map(function (k) { return cell[k]; }).filter(Boolean);
        rid = others.length ? others[0] : null; shared = true;
      }
      if (!rid) return;
      var r = byId(rid);
      var suit = clientSuitability(m, r);
      html += '<div class="day-meal"><span class="slot">' + esc(sk) + "</span><span class='dishes'>" +
        "<div class='d'><span class='meal-dish'>" + esc(r ? r.name : "—") + "</span> " + suitBadge(suit) +
        (shared ? " <span class='badge common'>🍳 同餐</span>" : "") + "</div>" +
        (suit.reasons.length ? "<div class='adapt-note " + suit.status + "'>⚠️ " + esc(suit.reasons.join("；")) + "</div>" : "") +
        (r && r.split && !shared ? "<div class='adapt-note'>🍳 " + esc(r.split) + "</div>" : "") +
        "</span></div>";
    });
    html += "</div>";
    document.getElementById("week-day").innerHTML = html;
  }

  /* ---------- 渲染：食谱 ---------- */
  function renderRecipes() {
    var box = document.getElementById("page-recipes");
    var tags = ["全部", "补铁", "补钙", "补DHA", "补蛋白", "一锅两吃", "快手"];
    var html = '<input class="search-bar" id="recipe-search" placeholder="搜索食谱名…" value="' + esc(recipeFilter.q) + '">';
    html += '<div class="chips" id="recipe-chips">';
    tags.forEach(function (t) {
      html += '<div class="chip' + (recipeFilter.tag === t ? " active" : "") + '" data-tag="' + esc(t) + '">' + esc(t) + "</div>";
    });
    html += "</div><div id='recipe-list'></div>";
    box.innerHTML = html;
    document.getElementById("recipe-search").addEventListener("input", function (e) { recipeFilter.q = e.target.value; renderRecipeList(); });
    document.querySelectorAll("#recipe-chips .chip").forEach(function (el) {
      el.addEventListener("click", function () {
        recipeFilter.tag = el.getAttribute("data-tag");
        document.querySelectorAll("#recipe-chips .chip").forEach(function (x) { x.classList.remove("active"); });
        el.classList.add("active");
        renderRecipeList();
      });
    });
    renderRecipeList();
  }
  function renderRecipeList() {
    var list = document.getElementById("recipe-list");
    var m = currentMemberObj();
    var q = recipeFilter.q.trim().toLowerCase();
    var filtered = state.recipes.filter(function (r) {
      var okTag = recipeFilter.tag === "全部" || (r.tags || []).indexOf(recipeFilter.tag) >= 0;
      var okQ = !q || r.name.toLowerCase().indexOf(q) >= 0 || (r.tags || []).join("").toLowerCase().indexOf(q) >= 0;
      return okTag && okQ;
    });
    if (!filtered.length) { list.innerHTML = '<div class="empty-hint">没有匹配的食谱</div>'; return; }
    var html = "";
    filtered.forEach(function (r) {
      var suit = m ? clientSuitability(m, r) : { status: "neutral", reasons: [] };
      var whoBadge = r.who === "common" ? '<span class="badge common">🍳 共享</span>'
        : '<span class="badge common">' + esc(r.who) + "</span>";
      var tagsHtml = (r.tags || []).map(function (t) { return '<span class="tag">' + esc(t) + "</span>"; }).join("");
      html += '<div class="recipe">';
      html += '<div class="recipe-top"><div><div class="recipe-name">' + esc(r.name) + "</div>" +
        '<div class="recipe-tags">' + whoBadge + tagsHtml + "</div>" +
        '<div class="recipe-meta">耗时 ' + r.time + " 分钟</div></div>" +
        (m ? "<span class='suit " + suit.status + "' style='cursor:default'>" + (suit.status === "avoid" ? "🔴" : suit.status === "good" ? "🟢" : "⚪") + " 对" + esc(m.name) + "</span>" : "") +
        '<span class="badge common" data-toggle="' + esc(r.id) + '" style="cursor:pointer">📋 详情</span></div>';
      html += '<div class="recipe-detail" id="rd-' + esc(r.id) + '">';
      html += "<h4>食材</h4><ul>" + r.ing.map(function (ing) { return "<li>" + esc(ing.name) + " " + ing.g + "g</li>"; }).join("") + "</ul>";
      html += "<h4>做法</h4><ol>" + r.steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>";
      if (r.split) { html += "<h4>🍳 一锅两吃 · 分餐</h4><p>" + esc(r.split) + "</p>"; }
      html += "<h4>营养（每份）</h4><div class='nutri-grid'>";
      NUTRI_KEYS.forEach(function (n) {
        html += '<div class="nutri-cell"><div class="v">' + Math.round(r.nutri[n.k] || 0) + '</div><div class="l">' + n.name + '</div></div>';
      });
      html += "</div></div>";
      html += "</div>";
    });
    list.innerHTML = html;
    document.querySelectorAll("#recipe-list [data-toggle]").forEach(function (el) {
      el.addEventListener("click", function () {
        var id = el.getAttribute("data-toggle");
        var d = document.getElementById("rd-" + id);
        d.classList.toggle("open");
        el.textContent = d.classList.contains("open") ? "📋 收起" : "📋 详情";
      });
    });
  }

  /* ---------- 渲染：采购 ---------- */
  function renderShopping() {
    if (lastShopping) paintShopping(lastShopping);
    else api("/api/shopping").then(function (g) { lastShopping = g; paintShopping(g); })
      .catch(function () { var box = document.getElementById("page-shopping"); box.innerHTML = '<div class="empty-hint">无法获取采购清单</div>'; });
  }
  function paintShopping(groups) {
    var box = document.getElementById("page-shopping");
    var names = [];
    Object.keys(groups).forEach(function (cat) { groups[cat].forEach(function (it) { names.push(it.name); }); });
    var total = names.length;
    var doneCount = names.filter(function (n) { return state.shoppingChecked[n]; }).length;
    var pct = total ? Math.round(doneCount / total * 100) : 0;

    var html = '<div class="card">';
    html += '<div class="card-title">本周采购清单</div>';
    html += '<div class="shop-progress">已备 ' + doneCount + " / " + total + " 项 · " + pct + "%</div>";
    html += '<div class="bar-bg"><div class="bar-fg" style="width:' + pct + '%"></div></div>';
    html += '<div class="shop-actions"><button class="btn btn-soft" id="shop-uncheck">重置勾选</button></div>';
    html += '<p class="note">清单根据本周 7 天食谱自动汇总，并已扣除库存中已有的食材。勾选表示已购买/已有。</p>';
    html += "</div>";

    var catOrder = ["蛋白", "奶", "蔬菜", "水果", "主食", "其他"];
    var sortedCats = Object.keys(groups).sort(function (a, b) { return catOrder.indexOf(a) - catOrder.indexOf(b); });
    sortedCats.forEach(function (cat) {
      html += '<div class="shop-group"><h3>' + esc(cat) + "</h3>";
      groups[cat].forEach(function (it) {
        var done = state.shoppingChecked[it.name];
        html += '<div class="shop-item' + (done ? " done" : "") + '">' +
          '<span class="box" data-shop="' + esc(it.name) + '">' + (done ? "✓" : "") + "</span>" +
          '<span class="name">' + esc(it.name) + "</span>" +
          '<span class="qty">' + fmtG(it.g) + "</span></div>";
      });
      html += "</div>";
    });
    if (!total) html += '<div class="empty-hint">本周食材已齐，无需额外采购 🎉</div>';
    box.innerHTML = html;

    document.querySelectorAll("#page-shopping [data-shop]").forEach(function (el) {
      el.addEventListener("click", function () {
        var n = el.getAttribute("data-shop");
        state.shoppingChecked[n] = !state.shoppingChecked[n];
        paintShopping(lastShopping);
        api("/api/kv/shoppingChecked", { method: "PUT", body: JSON.stringify({ value: state.shoppingChecked }) })
          .catch(function () { toast("保存失败，稍后重试"); });
      });
    });
    var uncheck = document.getElementById("shop-uncheck");
    if (uncheck) uncheck.addEventListener("click", function () {
      state.shoppingChecked = {}; paintShopping(lastShopping);
      api("/api/kv/shoppingChecked", { method: "PUT", body: JSON.stringify({ value: {} }) })
        .catch(function () { toast("保存失败，稍后重试"); });
    });
  }

  /* ---------- 渲染：库存 ---------- */
  function renderPantry() {
    var box = document.getElementById("page-pantry");
    var html = '<div class="card"><div class="card-title">现有食材 · 库存</div>';
    html += '<div class="add-row">' +
      '<input id="p-name" placeholder="食材名" />' +
      '<input id="p-qty" placeholder="数量" type="number" style="max-width:80px" />' +
      '<select id="p-unit" style="padding:9px;border:1px solid var(--border);border-radius:10px;background:var(--surface)"><option>g</option><option>kg</option><option>个</option><option>块</option><option>L</option></select>' +
      '<button class="btn btn-primary" id="p-add" style="flex:0 0 auto;padding:9px 16px">添加</button>' +
      "</div>";
    html += '<p class="note">临期（≤2天）会标红提醒，优先安排使用。</p></div>';
    html += '<div id="pantry-list"></div>';
    box.innerHTML = html;
    document.getElementById("p-add").addEventListener("click", function () {
      var name = document.getElementById("p-name").value.trim();
      var qty = parseFloat(document.getElementById("p-qty").value);
      var unit = document.getElementById("p-unit").value;
      if (!name || !qty) return;
      var payload = { name: name, qty: qty, unit: unit, bought: daysAgo(0), exp: daysAgo(-6) };
      api("/api/pantry", { method: "POST", body: JSON.stringify(payload) }).then(function (row) {
        state.pantry.push(row);
        document.getElementById("p-name").value = "";
        document.getElementById("p-qty").value = "";
        renderPantryList();
      }).catch(function () { toast("添加失败，稍后重试"); });
    });
    renderPantryList();
  }
  function renderPantryList() {
    var list = document.getElementById("pantry-list");
    if (!state.pantry.length) { list.innerHTML = '<div class="empty-hint">库存为空，添加常用食材</div>'; return; }
    var html = "";
    state.pantry.forEach(function (p, i) {
      var urgent = false;
      try { urgent = (new Date(p.exp) - new Date()) <= 2 * 864e5; } catch (e) {}
      var sub = "购入 " + p.bought + " · 保质期至 " + p.exp;
      html += '<div class="pantry-item' + (urgent ? " urgent" : "") + '">' +
        '<div class="pi-left">' + esc(p.name) + ' <span class="pi-sub">' + p.qty + p.unit + "</span>" +
        (urgent ? '<span class="urgent-tag">临期</span>' : "") + '<div class="pi-sub">' + esc(sub) + "</div></div>" +
        '<button class="pi-del" data-del="' + p.id + '">删除</button></div>';
    });
    list.innerHTML = html;
    document.querySelectorAll("#pantry-list [data-del]").forEach(function (el) {
      el.addEventListener("click", function () {
        var id = el.getAttribute("data-del");
        state.pantry = state.pantry.filter(function (x) { return String(x.id) !== String(id); });
        renderPantryList();
        api("/api/pantry/" + encodeURIComponent(id), { method: "DELETE" })
          .catch(function () { toast("删除失败，稍后重试"); });
      });
    });
  }

  /* ---------- 渲染：方案（目标 + 建议 + 本周达标 + 生成） ---------- */
  function renderPlan() {
    if (!members().length) return;
    var m = currentMemberObj();
    var box = document.getElementById("page-plan");
    var html = '<div class="card member-card" style="border-color:' + (m.color || "#888") + '55">' +
      '<div class="mc-head"><span class="mc-avatar" style="background:' + (m.color || "#888") + '">' + (m.emoji || "👤") + "</span>" +
      '<div><div class="mc-name">' + esc(m.name) + " 的专属方案</div>" +
      '<div class="mc-sub">' + esc(m.relation || "") + " · " + memberAgeText(m) + " · " + (m.gender === "male" ? "男" : "女") +
      (m.conditions && m.conditions.length ? " · 关注：" + m.conditions.map(condLabel).join("、") : "") + "</div></div></div>";
    html += '<button class="btn btn-primary" id="gen-plan" style="margin-top:4px">✨ 生成我的周方案</button>';
    html += '<p class="note" id="plan-note">基于年龄 / 性别 / 身体问题生成，避开过敏食材，优先命中需求标签。</p></div>';
    html += '<div id="plan-body"></div>';
    box.innerHTML = html;
    document.getElementById("gen-plan").addEventListener("click", generateForMember);
    loadPlanBody(m);
  }
  function condLabel(c) {
    var map = { pregnancy: "孕期", lactation: "哺乳期", anemia: "贫血", low_calcium: "缺钙", hypertension: "高血压", diabetes: "糖尿病", hyperlipidemia: "高血脂", picky: "挑食", low_appetite: "胃口小", weak_gut: "肠胃弱", allergy_egg: "鸡蛋过敏", allergy_milk: "乳制品过敏", allergy_seafood: "海鲜过敏", allergy_nut: "坚果过敏", allergy_soy: "豆制品过敏", allergy_wheat: "麸质过敏" };
    return map[c] || c;
  }
  function loadPlanBody(m) {
    var body = document.getElementById("plan-body");
    // 离线快照里有预烘焙的方案
    var off = window.__OFFLINE_PLANS && window.__OFFLINE_PLANS[m.id];
    if (off) { paintPlanBody(m, off.advice || [], off.disclaimer, true); return; }
    api("POST", "/api/members/" + encodeURIComponent(m.id) + "/plan", { week: state.week })
      .then(function (d) { planCache[m.id] = d; paintPlanBody(m, d.advice || [], d.disclaimer, false, d); })
      .catch(function () { paintPlanBody(m, [], "（方案需连接后端服务后查看）", false); });
  }
  function paintPlanBody(m, advice, disclaimer, offline, planData) {
    var body = document.getElementById("plan-body");
    if (!body) return;
    var std = (state.standards && state.standards[m.id]) || {};
    var html = "";
    // 目标卡
    html += '<div class="card"><div class="card-title">每日营养目标</div><div class="target-grid">';
    NUTRI_KEYS.forEach(function (n) {
      html += '<div class="target-cell"><div class="v">' + Math.round(std[n.k] || 0) + '</div><div class="l">' + n.name + "</div><div class='u'>" + n.unit + "</div></div>";
    });
    html += "</div></div>";
    // 建议
    if (advice && advice.length) {
      html += '<div class="card"><div class="card-title">饮食建议</div><ul class="advice-list">';
      advice.forEach(function (a) { html += "<li>" + esc(a) + "</li>"; });
      html += "</ul></div>";
    }
    // 本周达标追踪
    html += '<div class="card"><div class="card-title">本周营养累计（' + esc(m.name) + "）</div>";
    html += '<p class="note">按份量折算估算，与每日目标 ×7 对比。绿达标、黄偏低、橙偏高。</p>';
    var acc = weekNutriFor(m.id);
    NUTRI_KEYS.forEach(function (n) {
      if (n.k === "folate" && (std[n.k] || 0) === 0) return;
      var got = acc[n.k];
      var target = (std[n.k] || 0) * 7;
      var ratio = target > 0 ? got / target : 0;
      var pctW = Math.min(100, Math.round(ratio * 100));
      var cls = ratio >= 0.9 ? "ok" : (ratio > 1.1 ? "over" : "low");
      var statusTxt = ratio >= 0.9 ? "达标" : (ratio > 1.1 ? "偏高" : "偏低");
      html += '<div class="nutri-track"><div class="row"><span class="name">' + n.name + "</span>" +
        '<span class="val">' + Math.round(got) + " / " + Math.round(target) + " " + n.unit + " · " + statusTxt + "</span></div>" +
        '<div class="bar-bg"><div class="track-fg ' + cls + '" style="width:' + pctW + '%"></div></div></div>';
    });
    html += "</div>";
    if (disclaimer) html += '<p class="note" style="text-align:center">' + esc(disclaimer) + "</p>";
    body.innerHTML = html;
    var btn = document.getElementById("gen-plan");
    if (btn) {
      btn.disabled = !!offline;
      if (offline) btn.style.opacity = ".5";
    }
  }
  function generateForMember() {
    var m = currentMemberObj();
    if (!m) return;
    var btn = document.getElementById("gen-plan");
    if (btn) { btn.disabled = true; btn.textContent = "生成中…"; }
    api("POST", "/api/members/" + encodeURIComponent(m.id) + "/plan", { week: state.week })
      .then(function (d) {
        planCache[m.id] = d;
        state.week = d.week;
        return api("/api/week", { method: "PUT", body: JSON.stringify(d.week) });
      })
      .then(function () {
        toast("✅ 已为 " + m.name + " 生成周方案");
        paintPlanBody(m, planCache[m.id].advice || [], planCache[m.id].disclaimer, false, planCache[m.id]);
        if (currentPage === "week") renderWeek();
        if (currentPage === "today") renderToday();
      })
      .catch(function () { toast("生成失败，请确认服务已连接"); if (btn) { btn.disabled = false; btn.textContent = "✨ 生成我的周方案"; } });
  }

  /* ---------- 页面切换 ---------- */
  var PAGE_TITLES = { today: "今日", week: "本周", recipes: "食谱", shopping: "采购", pantry: "库存", plan: "方案" };
  function showPage(page) {
    currentPage = page;
    document.querySelectorAll(".page").forEach(function (p) { p.classList.add("hidden"); });
    document.getElementById("page-" + page).classList.remove("hidden");
    document.querySelectorAll(".tab").forEach(function (t) {
      t.classList.toggle("active", t.getAttribute("data-page") === page);
    });
    document.getElementById("app-title").textContent = PAGE_TITLES[page];
    if (page === "today") renderToday();
    else if (page === "week") renderWeek();
    else if (page === "recipes") renderRecipes();
    else if (page === "shopping") renderShopping();
    else if (page === "pantry") renderPantry();
    else if (page === "plan") renderPlan();
  }

  /* ---------- 重置（仅清空勾选进度） ---------- */
  function resetProgress() {
    if (!confirm("确定清空采购勾选与餐次完成记录？（不影响食谱/周计划/库存/成员）")) return;
    state.shoppingChecked = {}; state.doneMeals = {};
    api("/api/kv/shoppingChecked", { method: "PUT", body: JSON.stringify({ value: {} }) }).catch(function () {});
    api("/api/kv/doneMeals", { method: "PUT", body: JSON.stringify({ value: {} }) }).catch(function () {});
    showPage(currentPage);
    toast("进度已清空");
  }

  /* ---------- 初始化 ---------- */
  document.querySelectorAll(".tab").forEach(function (tab) {
    tab.addEventListener("click", function () { showPage(tab.getAttribute("data-page")); });
  });
  document.getElementById("btn-reset").addEventListener("click", resetProgress);
  loadVersion();
  loadState(function () { renderMemberBar(); showPage("today"); });
})();
