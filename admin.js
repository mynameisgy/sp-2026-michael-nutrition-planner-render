/* 家庭营养 · 食材规划 — 后台管理逻辑（调系统参数，写入 SQLite） */
(function () {
  "use strict";

  /* ---------- 配置 ---------- */
  var NUTRI = [
    { k: "kcal", name: "能量", unit: "kcal" },
    { k: "protein", name: "蛋白质", unit: "g" },
    { k: "calcium", name: "钙", unit: "mg" },
    { k: "iron", name: "铁", unit: "mg" },
    { k: "zinc", name: "锌", unit: "mg" },
    { k: "vitA", name: "维A", unit: "μg" },
    { k: "vitD", name: "维D", unit: "μg" },
    { k: "vitC", name: "维C", unit: "mg" },
    { k: "dha", name: "DHA", unit: "mg" },
    { k: "folate", name: "叶酸", unit: "μg" },
    { k: "fiber", name: "膳食纤维", unit: "g" }
  ];
  var SLOTS = ["早", "早点", "午", "午点", "晚", "睡前"];
  var ROLE_EMOJI = { toddler: "👶", mom: "🤰", child: "🧒", adult: "🧑", elder: "👴" };
  var CONDITION_OPTIONS = {
    "生理状态": [{ key: "pregnancy", label: "孕期" }, { key: "lactation", label: "哺乳期" }],
    "营养缺乏": [{ key: "anemia", label: "贫血/缺铁" }, { key: "low_calcium", label: "缺钙/骨质疏松" }],
    "慢病": [{ key: "hypertension", label: "高血压" }, { key: "diabetes", label: "糖尿病/血糖" }, { key: "hyperlipidemia", label: "高血脂/心血管" }],
    "饮食习惯": [{ key: "picky", label: "挑食" }, { key: "low_appetite", label: "胃口小" }, { key: "weak_gut", label: "肠胃弱" }],
    "过敏": [{ key: "allergy_egg", label: "鸡蛋过敏" }, { key: "allergy_milk", label: "乳制品过敏" }, { key: "allergy_seafood", label: "海鲜过敏" }, { key: "allergy_nut", label: "坚果过敏" }, { key: "allergy_soy", label: "豆制品过敏" }, { key: "allergy_wheat", label: "麸质过敏" }]
  };
  var WHO_OPTS = [
    { v: "toddler", t: "👶 幼儿" },
    { v: "mom", t: "🤰 孕产妇" },
    { v: "child", t: "🧒 小孩" },
    { v: "adult", t: "🧑 中年人" },
    { v: "elder", t: "👴 老人" },
    { v: "common", t: "🍳 全家共享" }
  ];

  /* ---------- 状态缓存 ---------- */
  var cache = { standards: null, members: [], recipes: [], week: [], pantry: [] };

  /* ---------- 工具 ---------- */
  function api(path, opts) {
    opts = opts || {};
    opts.headers = { "Content-Type": "application/json" };
    return fetch(path, opts).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  }
  function daysAgo(n) {
    var d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }
  var msgTimer;
  function msg(t) {
    var el = document.getElementById("msg");
    el.textContent = t;
    el.classList.add("show");
    clearTimeout(msgTimer);
    msgTimer = setTimeout(function () { el.classList.remove("show"); }, 2200);
  }

  /* ---------- 初始化 ---------- */
  function init() {
    // tab 切换
    document.querySelectorAll(".atab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        var sec = tab.getAttribute("data-asec");
        document.querySelectorAll(".atab").forEach(function (x) { x.classList.remove("active"); });
        document.querySelectorAll(".asection").forEach(function (x) { x.classList.remove("active"); });
        tab.classList.add("active");
        document.getElementById("asec-" + sec).classList.add("active");
      });
    });

    api("/api/state").then(function (s) {
      cache.standards = s.standards;
      cache.members = s.members || [];
      cache.recipes = s.recipes;
      cache.week = s.week;
      cache.pantry = s.pantry;
      renderMembers();
      renderStandards();
      renderRecipes();
      renderWeek();
      renderPantry();
    }).catch(function () { msg("无法连接后端，请确认 node server/server.js 已启动"); });
  }

  /* ---------- 营养标准 ---------- */
  function renderStandards() {
    var box = document.getElementById("standards-body");
    if (!cache.standards) { box.innerHTML = '<p class="hint">加载中…</p>'; return; }
    var html = "";
    Object.keys(cache.standards).forEach(function (role) {
      var st = cache.standards[role];
      html += '<div class="rows-title">' + esc(st.label) + '</div>';
      html += '<div class="grid3">';
      NUTRI.forEach(function (n) {
        var val = st[n.k] != null ? st[n.k] : 0;
        html += '<div class="field"><label>' + n.name + ' (' + n.unit + ')</label>' +
          '<input type="number" step="any" data-role="' + role + '" data-k="' + n.k + '" value="' + val + '"></div>';
      });
      html += '</div>';
    });
    box.innerHTML = html;

    var btn = document.getElementById("save-standards");
    btn.onclick = function () {
      Object.keys(cache.standards).forEach(function (role) {
        NUTRI.forEach(function (n) {
          var inp = document.querySelector('input[data-role="' + role + '"][data-k="' + n.k + '"]');
          var v = parseFloat(inp.value);
          cache.standards[role][n.k] = isNaN(v) ? 0 : v;
        });
      });
      api("/api/standards", { method: "PUT", body: JSON.stringify(cache.standards) })
        .then(function () { msg("✅ 营养标准已保存"); })
        .catch(function () { msg("❌ 保存失败"); });
    };
  }

  /* ---------- 成员管理 ---------- */
  function condChecks(m) {
    var conds = m.conditions || [];
    var html = "";
    Object.keys(CONDITION_OPTIONS).forEach(function (g) {
      html += '<div class="cond-group"><div class="cond-g-title">' + esc(g) + '</div><div class="cond-row">';
      CONDITION_OPTIONS[g].forEach(function (o) {
        var on = conds.indexOf(o.key) >= 0;
        html += '<label class="cond"><input type="checkbox" data-c="' + o.key + '"' + (on ? " checked" : "") + ">" + esc(o.label) + "</label>";
      });
      html += "</div></div>";
    });
    return html;
  }
  function memberForm(m, isNew) {
    m = m || { name: "", emoji: "👤", color: "#888888", gender: "female", ageYears: 1, ageMonths: 0, relation: "", activity: "moderate", conditions: [], notes: "" };
    return '<div class="member-card' + (isNew ? " open" : "") + '" ' + (isNew ? 'data-new="1"' : 'data-id="' + esc(m.id) + '"') + '>' +
      '<div class="mc-top"><span class="mc-avatar" style="background:' + esc(m.color || "#888") + '">' + esc(m.emoji || "👤") + '</span>' +
      '<span class="mc-name">' + (isNew ? "＋ 新成员" : esc(m.name)) + '</span>' +
      '<span style="margin-left:auto"><button class="btn btn-danger mc-del" style="padding:5px 10px;font-size:12px">' + (isNew ? "取消" : "删除") + '</button></span></div>' +
      '<div class="mc-edit"' + (isNew ? "" : ' style="display:none"') + '>' +
      '<div class="grid2" style="margin-bottom:8px">' +
      '<div class="field"><label>称呼</label><input data-f="name" value="' + esc(m.name) + '"></div>' +
      '<div class="field"><label>关系</label><input data-f="relation" value="' + esc(m.relation) + '" placeholder="如 女儿/本人"></div></div>' +
      '<div class="grid2" style="margin-bottom:8px">' +
      '<div class="field"><label>头像 emoji</label><input data-f="emoji" value="' + esc(m.emoji || "👤") + '"></div>' +
      '<div class="field"><label>主题色</label><input type="color" data-f="color" value="' + esc(m.color || "#888888") + '"></div></div>' +
      '<div class="grid3" style="margin-bottom:8px">' +
      '<div class="field"><label>性别</label><select data-f="gender"><option value="female"' + (m.gender === "female" ? " selected" : "") + '>女</option><option value="male"' + (m.gender === "male" ? " selected" : "") + '>男</option><option value="other"' + (m.gender === "other" ? " selected" : "") + '>其他</option></select></div>' +
      '<div class="field"><label>年龄（岁）</label><input type="number" data-f="ageYears" value="' + (m.ageYears || 0) + '"></div>' +
      '<div class="field"><label>月龄（不足岁填）</label><input type="number" data-f="ageMonths" value="' + (m.ageMonths || 0) + '"></div></div>' +
      '<div class="grid2" style="margin-bottom:8px">' +
      '<div class="field"><label>活动量</label><select data-f="activity"><option value="low"' + (m.activity === "low" ? " selected" : "") + '>久坐</option><option value="moderate"' + (m.activity === "moderate" ? " selected" : "") + '>中等</option><option value="high"' + (m.activity === "high" ? " selected" : "") + '>活跃</option></select></div>' +
      '<div class="field"><label>备注</label><input data-f="notes" value="' + esc(m.notes || "") + '"></div></div>' +
      '<div class="field" style="margin-bottom:8px"><label>身体问题（可多选）</label>' + condChecks(m) + '</div>' +
      '<div class="btn-row"><button class="btn btn-primary mc-save">保存</button></div>' +
      '</div></div>';
  }
  function renderMembers() {
    var box = document.getElementById("members-body");
    if (!box) return;
    document.getElementById("member-count").textContent = cache.members.length;
    var html = "";
    cache.members.forEach(function (m) { html += memberForm(m, false); });
    box.innerHTML = html;
    bindMemberCards();
  }
  function bindMemberCards() {
    document.querySelectorAll("#members-body .member-card").forEach(function (card) {
      var edit = card.querySelector(".mc-edit");
      card.querySelector(".mc-top").addEventListener("click", function (e) {
        if (e.target.closest(".mc-del")) return;
        if (card.getAttribute("data-new") === "1") return;
        edit.style.display = edit.style.display === "none" ? "block" : "none";
        card.classList.toggle("open");
      });
      var del = card.querySelector(".mc-del");
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        if (card.getAttribute("data-new") === "1") { card.remove(); return; }
        if (!confirm("确定删除该成员？其餐次分配会一并清理。")) return;
        var id = card.getAttribute("data-id");
        api("/api/members/" + encodeURIComponent(id), { method: "DELETE" })
          .then(function () {
            cache.members = cache.members.filter(function (x) { return x.id !== id; });
            card.remove(); document.getElementById("member-count").textContent = cache.members.length; msg("✅ 已删除");
          }).catch(function () { msg("❌ 删除失败"); });
      });
      card.querySelector(".mc-save").addEventListener("click", function (e) {
        e.stopPropagation();
        saveMember(card);
      });
    });
  }
  function readMemberForm(card) {
    var get = function (f) { return card.querySelector('[data-f="' + f + '"]'); };
    var conds = [];
    card.querySelectorAll("input[data-c]:checked").forEach(function (c) { conds.push(c.getAttribute("data-c")); });
    return {
      name: get("name").value.trim() || "新成员",
      emoji: get("emoji").value.trim() || "👤",
      color: get("color").value,
      gender: get("gender").value,
      ageYears: parseInt(get("ageYears").value, 10) || 0,
      ageMonths: parseInt(get("ageMonths").value, 10) || 0,
      relation: get("relation").value.trim(),
      activity: get("activity").value,
      conditions: conds,
      notes: get("notes").value.trim()
    };
  }
  function saveMember(card) {
    var obj = readMemberForm(card);
    var isNew = card.getAttribute("data-new") === "1";
    var p;
    if (isNew) p = api("/api/members", { method: "POST", body: JSON.stringify(obj) });
    else p = api("/api/members/" + encodeURIComponent(card.getAttribute("data-id")), { method: "PUT", body: JSON.stringify(obj) });
    p.then(function (saved) {
      if (isNew) { cache.members.push(saved); }
      else { var i = cache.members.findIndex(function (x) { return x.id === saved.id; }); if (i >= 0) cache.members[i] = saved; }
      renderMembers();
      msg("✅ 成员已保存");
    }).catch(function () { msg("❌ 保存失败"); });
  }

  /* ---------- 食谱库 ---------- */
  function recipeForm(r, isNew) {
    r = r || { name: "", who: "common", tags: [], time: 15, ing: [], steps: [], split: "", nutri: {} };
    return '<div class="recipe-card' + (isNew ? " open" : "") + '" ' + (isNew ? 'data-new="1"' : 'data-id="' + esc(r.id) + '"') + '>' +
      '<div class="rc-top"><span class="rc-name">' + (isNew ? "＋ 新食谱" : esc(r.name)) + '</span>' +
      '<span><button class="btn btn-danger rc-del" style="padding:5px 10px;font-size:12px">' + (isNew ? "取消" : "删除") + '</button></span></div>' +
      '<div class="rc-edit"' + (isNew ? "" : ' style="display:none"') + '>' +
      '<div class="grid2" style="margin-bottom:8px">' +
      '<div class="field"><label>名称</label><input data-f="name" value="' + esc(r.name) + '"></div>' +
      '<div class="field"><label>对象</label><select data-f="who">' +
      WHO_OPTS.map(function (o) { return '<option value="' + o.v + '"' + (o.v === r.who ? " selected" : "") + '>' + o.t + '</option>'; }).join("") +
      '</select></div></div>' +
      '<div class="grid2" style="margin-bottom:8px">' +
      '<div class="field"><label>标签（逗号分隔）</label><input data-f="tags" value="' + esc((r.tags || []).join(",")) + '"></div>' +
      '<div class="field"><label>耗时（分钟）</label><input type="number" data-f="time" value="' + (r.time || 0) + '"></div></div>' +
      '<div class="field" style="margin-bottom:8px"><label>食材 ing（JSON: [{name,g,cat}]）</label>' +
      '<textarea data-f="ing">' + esc(JSON.stringify(r.ing, null, 0)) + '</textarea></div>' +
      '<div class="field" style="margin-bottom:8px"><label>步骤 steps（JSON 数组）</label>' +
      '<textarea data-f="steps">' + esc(JSON.stringify(r.steps, null, 0)) + '</textarea></div>' +
      '<div class="field" style="margin-bottom:8px"><label>一锅两吃分餐说明 split</label>' +
      '<textarea data-f="split">' + esc(r.split || "") + '</textarea></div>' +
      '<div class="field" style="margin-bottom:8px"><label>营养 nutri（JSON: {kcal,protein,...}）</label>' +
      '<textarea data-f="nutri">' + esc(JSON.stringify(r.nutri || {}, null, 0)) + '</textarea></div>' +
      '<div class="btn-row"><button class="btn btn-primary rc-save">保存</button></div>' +
      '</div></div>';
  }
  function renderRecipes() {
    var box = document.getElementById("recipes-body");
    document.getElementById("recipe-count").textContent = cache.recipes.length;
    var html = "";
    cache.recipes.forEach(function (r) { html += recipeForm(r, false); });
    box.innerHTML = html;
    bindRecipeCards();
  }
  function bindRecipeCards() {
    document.querySelectorAll("#recipes-body .recipe-card").forEach(function (card) {
      var edit = card.querySelector(".rc-edit");
      card.querySelector(".rc-top").addEventListener("click", function () {
        if (card.getAttribute("data-new") === "1") return; // 新卡片默认展开
        edit.style.display = edit.style.display === "none" ? "block" : "none";
        card.classList.toggle("open");
      });
      var del = card.querySelector(".rc-del");
      del.addEventListener("click", function (e) {
        e.stopPropagation();
        if (card.getAttribute("data-new") === "1") { card.remove(); return; }
        if (!confirm("确定删除该食谱？")) return;
        var id = card.getAttribute("data-id");
        api("/api/recipes/" + encodeURIComponent(id), { method: "DELETE" })
          .then(function () {
            cache.recipes = cache.recipes.filter(function (x) { return x.id !== id; });
            card.remove();
            document.getElementById("recipe-count").textContent = cache.recipes.length;
            msg("✅ 已删除");
          }).catch(function () { msg("❌ 删除失败"); });
      });
      card.querySelector(".rc-save").addEventListener("click", function (e) {
        e.stopPropagation();
        saveRecipe(card);
      });
    });
  }
  function readRecipeForm(card) {
    var get = function (f) { return card.querySelector('[data-f="' + f + '"]'); };
    var obj = {
      name: get("name").value.trim(),
      who: get("who").value,
      tags: get("tags").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
      time: parseInt(get("time").value, 10) || 0,
      split: get("split").value
    };
    try { obj.ing = JSON.parse(get("ing").value); } catch (e) { throw new Error("食材 JSON 格式错误"); }
    try { obj.steps = JSON.parse(get("steps").value); } catch (e) { throw new Error("步骤 JSON 格式错误"); }
    try { obj.nutri = JSON.parse(get("nutri").value); } catch (e) { throw new Error("营养 JSON 格式错误"); }
    if (!obj.name) throw new Error("名称不能为空");
    return obj;
  }
  function saveRecipe(card) {
    var obj;
    try { obj = readRecipeForm(card); } catch (e) { msg("❌ " + e.message); return; }
    var isNew = card.getAttribute("data-new") === "1";
    var p;
    if (isNew) p = api("/api/recipes", { method: "POST", body: JSON.stringify(obj) });
    else p = api("/api/recipes/" + encodeURIComponent(card.getAttribute("data-id")), { method: "PUT", body: JSON.stringify(obj) });
    p.then(function (saved) {
      if (isNew) { cache.recipes.push(saved); }
      else { var i = cache.recipes.findIndex(function (x) { return x.id === saved.id; }); if (i >= 0) cache.recipes[i] = saved; }
      renderRecipes();
      msg("✅ 食谱已保存");
    }).catch(function () { msg("❌ 保存失败"); });
  }

  /* ---------- 周计划 ---------- */
  function recipeOptions(who, selectedId) {
    var opts = '<option value="">—</option>';
    // 全家同餐：每位成员都可选用任意食谱，不再按 t/m 过滤
    cache.recipes.forEach(function (r) {
      opts += '<option value="' + esc(r.id) + '"' + (r.id === selectedId ? " selected" : "") + '>' + esc(r.name) + '</option>';
    });
    return opts;
  }
  function renderWeek() {
    var box = document.getElementById("week-body");
    if (!cache.week.length) { box.innerHTML = '<p class="hint">加载中…</p>'; return; }
    var memberList = cache.members || [];
    var members = memberList.map(function (m) { return m.id; });
    var headCells = SLOTS.map(function (s) {
      return '<div>' + s + '<br><span style="font-size:9px;opacity:.7">' +
        memberList.map(function (m) { return m.emoji || "👤"; }).join("") + '</span></div>';
    }).join("");
    var html = '<div class="week-row head"><div>天</div>' + headCells + '</div>';
    cache.week.forEach(function (day, i) {
      html += '<div class="week-row" data-day="' + i + '"><div class="day">' + esc(day.label) + '</div>';
      SLOTS.forEach(function (sk) {
        var slot = day.slots[sk] || {};
        html += '<div class="slot-cell">';
        members.forEach(function (r) {
          html += '<select data-d="' + i + '" data-slot="' + esc(sk) + '" data-who="' + esc(r) + '">' + recipeOptions(r, slot[r]) + '</select>';
        });
        html += '</div>';
      });
      html += '</div>';
    });
    box.innerHTML = html;

    document.getElementById("save-week").onclick = function () {
      var week = cache.week.map(function (day, i) {
        var slots = {};
        SLOTS.forEach(function (sk) {
          var cell = {};
          members.forEach(function (r) {
            var sel = document.querySelector('select[data-d="' + i + '"][data-slot="' + sk + '"][data-who="' + r + '"]');
            cell[r] = sel && sel.value ? sel.value : null;
          });
          slots[sk] = cell;
        });
        return { label: day.label, slots: slots };
      });
      api("/api/week", { method: "PUT", body: JSON.stringify(week) })
        .then(function (saved) { cache.week = saved; renderWeek(); msg("✅ 周计划已保存"); })
        .catch(function () { msg("❌ 保存失败"); });
    };
  }

  /* ---------- 库存 ---------- */
  function renderPantry() {
    var box = document.getElementById("pantry-body");
    if (!cache.pantry.length) { box.innerHTML = '<p class="hint">库存为空</p>'; return; }
    var html = "";
    cache.pantry.forEach(function (p) {
      html += '<div class="pantry-row"><span>' + esc(p.name) + ' <span class="pill">' + p.qty + p.unit + '</span>' +
        '<br><span class="pill">购入 ' + esc(p.bought) + ' · 至 ' + esc(p.exp) + '</span></span>' +
        '<button class="btn btn-danger" data-del="' + p.id + '" style="padding:6px 12px;font-size:12px">删除</button></div>';
    });
    box.innerHTML = html;
    document.querySelectorAll("#pantry-body [data-del]").forEach(function (el) {
      el.addEventListener("click", function () {
        var id = el.getAttribute("data-del");
        api("/api/pantry/" + encodeURIComponent(id), { method: "DELETE" })
          .then(function () {
            cache.pantry = cache.pantry.filter(function (x) { return String(x.id) !== String(id); });
            renderPantry();
            msg("✅ 已删除");
          }).catch(function () { msg("❌ 删除失败"); });
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    init();
    document.getElementById("add-member").addEventListener("click", function () {
      var box = document.getElementById("members-body");
      box.insertAdjacentHTML("afterbegin", memberForm(null, true));
      bindMemberCards();
    });
    document.getElementById("add-recipe").addEventListener("click", function () {
      var box = document.getElementById("recipes-body");
      box.insertAdjacentHTML("afterbegin", recipeForm(null, true));
      bindRecipeCards();
    });
    document.getElementById("p-add").addEventListener("click", function () {
      var name = document.getElementById("p-name").value.trim();
      var qty = parseFloat(document.getElementById("p-qty").value);
      var unit = document.getElementById("p-unit").value;
      if (!name || isNaN(qty)) { msg("❌ 请填写名称和数量"); return; }
      api("/api/pantry", { method: "POST", body: JSON.stringify({ name: name, qty: qty, unit: unit, bought: daysAgo(0), exp: daysAgo(-6) }) })
        .then(function (row) {
          cache.pantry.push(row);
          document.getElementById("p-name").value = "";
          document.getElementById("p-qty").value = "";
          renderPantry();
          msg("✅ 已入库");
        }).catch(function () { msg("❌ 添加失败"); });
    });
  });
})();
