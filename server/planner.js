/* 家庭营养规划 — 方案引擎（纯函数，无外部依赖）
 *
 * 职责：
 *   1) 根据成员的年龄 / 性别 / 身体问题，从《中国居民膳食营养素参考摄入量 DRIs 2023》
 *      的分年龄段参考表中推导该成员「每日营养素推荐量」。
 *   2) 身体问题（孕期、贫血、缺钙、高血压、糖尿病、各类过敏…）对推荐量做增量调整，
 *      并给出饮食建议文案。
 *   3) 判断某道食谱对某个成员是否合适（过敏 → 红灯；命中身体问题推荐标签 → 绿灯）。
 *   4) 为某个成员生成一周合适的餐食安排（在共享周菜单的骨架内，只填充该成员自己的餐次）。
 *
 * 注意：本引擎仅作家庭膳食参考，不替代医生 / 临床营养师的诊疗。
 */
"use strict";

/* 营养素键顺序（与前端 NUTRI_KEYS / 标准表一致） */
var NUTRI_KEYS = [
  "kcal", "protein", "calcium", "iron", "zinc",
  "vitA", "vitD", "vitC", "dha", "folate", "fiber"
];

/* ---------- 分年龄段基础参考摄入量（DRIs 2023 简化，安全区间） ----------
 * 单位：kcal / g / mg / μg(DHA mg) / μg(叶酸) / g(膳食纤维)
 * 婴幼儿与学龄前取自原系统已核定数值；青少年 / 成人 / 老人取 DRIs 近似值。 */
var DRI = {
  toddler: { kcal: 900, protein: 25, calcium: 600, iron: 9, zinc: 4, vitA: 310, vitD: 10, vitC: 40, dha: 100, folate: 150, fiber: 8 },
  preschool: { kcal: 1300, protein: 30, calcium: 800, iron: 10, zinc: 5.5, vitA: 360, vitD: 10, vitC: 50, dha: 100, folate: 150, fiber: 12 },
  school: { male: { kcal: 1900, protein: 50, calcium: 1000, iron: 13, zinc: 7, vitA: 600, vitD: 10, vitC: 75, dha: 120, folate: 250, fiber: 20 },
            female: { kcal: 1700, protein: 45, calcium: 1000, iron: 15, zinc: 7, vitA: 600, vitD: 10, vitC: 75, dha: 120, folate: 250, fiber: 18 } },
  adult: { male: { kcal: 2200, protein: 65, calcium: 800, iron: 12, zinc: 12.5, vitA: 800, vitD: 10, vitC: 100, dha: 200, folate: 400, fiber: 28 },
           female: { kcal: 1800, protein: 55, calcium: 800, iron: 20, zinc: 7.5, vitA: 700, vitD: 10, vitC: 100, dha: 200, folate: 400, fiber: 25 } },
  elder: { male: { kcal: 1900, protein: 65, calcium: 1000, iron: 12, zinc: 11, vitA: 800, vitD: 15, vitC: 100, dha: 250, folate: 400, fiber: 25 },
           female: { kcal: 1600, protein: 60, calcium: 1000, iron: 12, zinc: 11, vitA: 800, vitD: 15, vitC: 100, dha: 250, folate: 400, fiber: 22 } }
};

/* 孕期 / 哺乳期（在成人女性基础上叠加） */
var PREGNANCY = { kcal: 300, protein: 30, calcium: 200, iron: 9, zinc: 2, vitA: 70, vitD: 0, vitC: 15, dha: 0, folate: 200, fiber: 3 };
var LACTATION = { kcal: 500, protein: 25, calcium: 200, iron: 4, zinc: 3, vitA: 100, vitD: 0, vitC: 20, dha: 50, folate: 120, fiber: 3 };

/* 活动量对能量 / 蛋白的修正系数 */
var ACTIVITY_KCAL = { low: -0.05, moderate: 0, high: 0.10 };
var ACTIVITY_PROTEIN = { low: -0.05, high: 0.10 };

/* ---------- 身体问题（条件）库 ----------
 * nutrients：在基础推荐量上叠加的增量
 * highlightTags：推荐优先选择带这些标签的食谱
 * exclude：需要规避的食材名（过敏）；命中即红灯
 * advice：给成员的饮食建议
 * group：UI 分组 */
var CONDITION_LIB = {
  pregnancy: { label: "孕期", group: "生理状态", nutrients: PREGNANCY, highlightTags: ["补叶酸", "补铁", "补钙", "补DHA"], advice: "重点补叶酸、铁、钙与 DHA；少食多餐，避免生冷与酒精。" },
  lactation: { label: "哺乳期", group: "生理状态", nutrients: LACTATION, highlightTags: ["补钙", "补蛋白", "补DHA"], advice: "保证优质蛋白与汤水，补钙补 DHA，多汤多水促泌乳。" },
  anemia: { label: "贫血 / 缺铁", group: "营养缺乏", nutrients: { iron: 6, folate: 100 }, highlightTags: ["补铁", "补叶酸"], advice: "多吃红肉、动物血、动物肝脏与深绿色蔬菜；维C 助铁吸收，忌浓茶咖啡送饭。" },
  low_calcium: { label: "缺钙 / 骨质疏松", group: "营养缺乏", nutrients: { calcium: 200, vitD: 5 }, highlightTags: ["补钙"], advice: "保证奶类、豆制品、小鱼小虾；补维D 多晒太阳，少盐少碳酸饮料。" },
  hypertension: { label: "高血压", group: "慢病", nutrients: {}, highlightTags: ["补纤维"], advice: "低盐低脂，少吃腌制 / 加工食品；多选蔬果全谷，控体重。" },
  diabetes: { label: "糖尿病 / 血糖偏高", group: "慢病", nutrients: { fiber: 6 }, highlightTags: ["补纤维"], advice: "控糖、低 GI、高纤维；主食粗细搭配，先菜后肉再饭，少吃精制糖。" },
  hyperlipidemia: { label: "高血脂 / 心血管", group: "慢病", nutrients: { fiber: 5 }, highlightTags: ["补纤维"], advice: "少油炸、少肥肉；多选蔬果全谷与深海鱼，控总油。" },
  picky: { label: "挑食 / 厌食", group: "饮食习惯", nutrients: {}, highlightTags: [], advice: "花样切配、混搭隐藏蔬菜；用造型与颜色提高接受度，不强行哄喂。" },
  low_appetite: { label: "胃口小 / 食量少", group: "饮食习惯", nutrients: {}, highlightTags: [], advice: "少食多餐、浓缩营养（蛋/奶/肉糜），餐间不加太多水占胃。" },
  weak_gut: { label: "肠胃弱 / 消化差", group: "饮食习惯", nutrients: {}, highlightTags: [], advice: "软烂温热、易消化；少食多餐，避开辛辣生冷与油腻。" },
  allergy_egg: { label: "鸡蛋过敏", group: "过敏", nutrients: {}, exclude: ["鸡蛋"], highlightTags: [], advice: "规避鸡蛋及含蛋制品，用肉 / 豆 / 奶替代优质蛋白。" },
  allergy_milk: { label: "牛奶 / 乳制品过敏或不耐受", group: "过敏", nutrients: {}, exclude: ["牛奶", "酸奶"], highlightTags: [], advice: "规避牛奶、酸奶等乳制品，可用豆制品 / 钙强化饮品补钙。" },
  allergy_seafood: { label: "海鲜过敏", group: "过敏", nutrients: {}, exclude: ["鳕鱼", "三文鱼", "鲈鱼", "虾仁"], highlightTags: [], advice: "规避鱼、虾等海鲜，用禽肉 / 瘦肉补蛋白。" },
  allergy_nut: { label: "坚果过敏", group: "过敏", nutrients: {}, exclude: ["核桃"], highlightTags: [], advice: "规避核桃、花生等坚果，注意预包装食品配料表。" },
  allergy_soy: { label: "大豆 / 豆制品过敏", group: "过敏", nutrients: {}, exclude: ["豆腐"], highlightTags: [], advice: "规避豆腐等豆制品，用肉 / 蛋 / 奶补蛋白。" },
  allergy_wheat: { label: "小麦 / 麸质过敏", group: "过敏", nutrients: {}, exclude: ["面条", "全麦面包", "全麦馒头"], highlightTags: [], advice: "规避面条、馒头等小麦制品，可用米、薯类作主食。" }
};

/* UI 用的条件选项（分组展示） */
var CONDITION_OPTIONS = (function () {
  var groups = {};
  Object.keys(CONDITION_LIB).forEach(function (k) {
    var g = CONDITION_LIB[k].group;
    if (!groups[g]) groups[g] = [];
    groups[g].push({ key: k, label: CONDITION_LIB[k].label });
  });
  return groups;
})();

/* ---------- 工具 ---------- */
function lifeStage(member) {
  var age = memberAgeYears(member);
  if (age < 1) return "toddler";
  if (age < 3) return "toddler";
  if (age < 6) return "preschool";
  if (age < 18) return "school";
  if (age < 65) return "adult";
  return "elder";
}
function memberAgeYears(member) {
  var y = Number(member.ageYears) || 0;
  var m = Number(member.ageMonths) || 0;
  return y + m / 12;
}
function isFemale(member) { return (member.gender || "female") === "female"; }

/* 进食份量系数（仅用于营养估算展示）：幼儿胃小、老人略少 */
function portionFactor(member) {
  var age = memberAgeYears(member);
  if (age < 3) return 0.5;
  if (age < 6) return 0.8;
  if (age < 18) return 0.9;
  if (age >= 65) return 0.9;
  return 1.0;
}

/* ---------- 推导每日推荐量 ---------- */
function deriveTarget(member) {
  var stage = lifeStage(member);
  var female = isFemale(member);
  var base;
  if (stage === "school" || stage === "adult" || stage === "elder") {
    base = DRI[stage][female ? "female" : "male"];
  } else {
    base = DRI[stage];
  }
  // 孕期 / 哺乳期叠加（仅女性）
  var conditions = member.conditions || [];
  if (female && conditions.indexOf("pregnancy") >= 0) base = addNutrients(base, PREGNANCY);
  else if (female && conditions.indexOf("lactation") >= 0) base = addNutrients(base, LACTATION);
  // 其余身体问题叠加（孕期 / 哺乳期已在上方特殊处理，此处跳过避免重复叠加）
  conditions.forEach(function (c) {
    if (c === "pregnancy" || c === "lactation") return;
    var lib = CONDITION_LIB[c];
    if (lib && lib.nutrients) base = addNutrients(base, lib.nutrients);
  });
  // 活动量修正（能量 + 蛋白）
  var act = member.activity || "moderate";
  var kcalAdj = ACTIVITY_KCAL[act];
  var proAdj = ACTIVITY_PROTEIN[act];
  if (kcalAdj) base = Object.assign({}, base, { kcal: Math.round(base.kcal * (1 + kcalAdj)) });
  if (proAdj) base = Object.assign({}, base, { protein: Math.round(base.protein * (1 + proAdj)) });
  // 取整
  var out = {};
  NUTRI_KEYS.forEach(function (k) { out[k] = Math.round(base[k] != null ? base[k] : 0); });
  return out;
}
function addNutrients(a, b) {
  var out = {};
  NUTRI_KEYS.forEach(function (k) { out[k] = (a[k] || 0) + (b[k] || 0); });
  return out;
}

/* ---------- 成员建议文案 ---------- */
function memberAdvice(member) {
  var out = [];
  var stage = lifeStage(member);
  var stageName = { toddler: "幼儿期", preschool: "学龄前期", school: "学龄 / 青少年期", adult: "成年期", elder: "老年期" }[stage];
  out.push("处于" + stageName + "，每日能量约 " + deriveTarget(member).kcal + " kcal、" +
    "蛋白质约 " + deriveTarget(member).protein + " g（按" + (isFemale(member) ? "女性" : "男性") + "参考量估算）。");
  (member.conditions || []).forEach(function (c) {
    var lib = CONDITION_LIB[c];
    if (lib && lib.advice) out.push(lib.advice);
  });
  if (stage === "toddler" || stage === "preschool") {
    out.push("食物质地要软烂、去骨去刺、防呛；少盐少糖，原味为主。");
  }
  if (stage === "elder") {
    out.push("口味清淡、 soft 易咀嚼；保证优质蛋白与钙，预防肌少与骨折。");
  }
  return out;
}

/* ---------- 食谱对成员的适配性 ---------- */
function recipeSuitability(member, recipe) {
  if (!recipe) return { status: "neutral", reasons: [] };
  var conditions = member.conditions || [];
  var reasons = [];
  // 过敏红绿灯
  var exclude = [];
  conditions.forEach(function (c) {
    var lib = CONDITION_LIB[c];
    if (lib && lib.exclude) exclude = exclude.concat(lib.exclude);
  });
  var ings = (recipe.ing || []).map(function (i) { return i.name; });
  var hit = exclude.filter(function (x) { return ings.indexOf(x) >= 0; });
  if (hit.length) {
    return { status: "avoid", reasons: ["含过敏食材：" + hit.join("、")] };
  }
  // 命中身体问题推荐标签 → 绿灯
  var highlights = [];
  conditions.forEach(function (c) {
    var lib = CONDITION_LIB[c];
    if (lib && lib.highlightTags) {
      lib.highlightTags.forEach(function (t) { if ((recipe.tags || []).indexOf(t) >= 0) highlights.push(t); });
    }
  });
  if (highlights.length) {
    return { status: "good", reasons: ["契合需求：" + highlights.join("、")] };
  }
  return { status: "neutral", reasons: [] };
}

/* ---------- 为某成员生成一周餐次分配 ---------- */
var SLOT_PREFS = {
  "早": { tags: ["主食", "快手", "补蛋白"], names: ["粥", "蛋", "奶", "面", "馒头", "饭"] },
  "早点": { tags: ["补钙", "补维C", "补DHA", "补纤维"], names: ["酸奶", "水果", "奶", "坚果", "蓝莓"] },
  "午": { tags: ["补蛋白", "一锅两吃", "补铁", "补钙"], names: [] },
  "午点": { tags: ["补钙", "补维C", "补DHA", "补纤维", "抗氧化"], names: ["酸奶", "水果", "蓝莓"] },
  "晚": { tags: ["补蛋白", "一锅两吃", "补铁", "补钙"], names: [] },
  "睡前": { tags: ["补钙"], names: ["奶", "酸奶", "牛奶"] }
};
var SLOTS = ["早", "早点", "午", "午点", "晚", "睡前"];

function eligibleRecipes(member, recipes) {
  return recipes.filter(function (r) { return recipeSuitability(member, r).status !== "avoid"; });
}
function scoreRecipe(r, slot, recent) {
  var pref = SLOT_PREFS[slot] || { tags: [], names: [] };
  var s = 1;
  (r.tags || []).forEach(function (t) { if (pref.tags.indexOf(t) >= 0) s += 2; });
  pref.names.forEach(function (n) { if (r.name.indexOf(n) >= 0) s += 2; });
  if (recent.indexOf(r.id) >= 0) s -= 3; // 避免短期内重复
  return s;
}
/* 返回：[{ slots: { 早: rid, ... } }, ...]（7 天，仅该成员自己的分配） */
function generateMemberWeek(member, recipes) {
  var pool = eligibleRecipes(member, recipes);
  if (!pool.length) pool = recipes.slice(); // 兜底，绝不空
  var days = [];
  var recent = [];
  for (var d = 0; d < 7; d++) {
    var slots = {};
    SLOTS.forEach(function (sk) {
      var best = null, bestScore = -1e9;
      pool.forEach(function (r) {
        var sc = scoreRecipe(r, sk, recent);
        if (sc > bestScore) { bestScore = sc; best = r; }
      });
      slots[sk] = best ? best.id : null;
      recent.unshift(best ? best.id : null);
      if (recent.length > 3) recent.pop();
    });
    days.push({ slots: slots });
  }
  return days;
}

module.exports = {
  NUTRI_KEYS: NUTRI_KEYS,
  CONDITION_LIB: CONDITION_LIB,
  CONDITION_OPTIONS: CONDITION_OPTIONS,
  lifeStage: lifeStage,
  memberAgeYears: memberAgeYears,
  isFemale: isFemale,
  portionFactor: portionFactor,
  deriveTarget: deriveTarget,
  memberAdvice: memberAdvice,
  recipeSuitability: recipeSuitability,
  generateMemberWeek: generateMemberWeek,
  eligibleRecipes: eligibleRecipes,
  DISCLAIMER: "本方案为家庭膳食参考，不替代医生或临床营养师的诊疗建议。"
};
