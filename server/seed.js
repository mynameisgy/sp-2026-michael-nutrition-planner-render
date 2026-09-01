/* 初始种子数据：营养标准 / 食谱库 / 周计划 / 库存
   依据中国 DRIs 2023。后端以此初始化 SQLite，之后所有修改都写库。 */
"use strict";

function daysAgo(n) {
  var d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/* 家庭成员（真实的人）。id 复用原角色键，便于周计划 / 标准无缝迁移。
   前端「成员」即本表；用户在后台新增成员会得到 m + 时间戳 的 id。 */
var planner = require("./planner");

function memberAgeText(m) {
  var y = m.ageYears || 0, mo = m.ageMonths || 0;
  if (y < 1) return mo + "个月";
  if (mo > 0) return y + "岁" + mo + "个月";
  return y + "岁";
}

var MEMBERS = [
  { id: "toddler", name: "女儿", emoji: "👶", color: "#3FB89C", gender: "female", ageYears: 1, ageMonths: 6, relation: "女儿", conditions: [], activity: "moderate", notes: "幼儿期，食物质地软烂、去骨去刺、防呛", sort: 1 },
  { id: "mom", name: "老婆", emoji: "🤰", color: "#EE8FA0", gender: "female", ageYears: 31, ageMonths: 0, relation: "老婆", conditions: ["pregnancy"], activity: "moderate", notes: "孕晚期", sort: 2 },
  { id: "child", name: "学龄小孩", emoji: "🧒", color: "#6F9BE8", gender: "male", ageYears: 5, ageMonths: 0, relation: "孩子", conditions: [], activity: "moderate", notes: "学龄期", sort: 3 },
  { id: "adult", name: "本人", emoji: "🧑", color: "#F2A65A", gender: "male", ageYears: 35, ageMonths: 0, relation: "本人", conditions: [], activity: "moderate", notes: "中年", sort: 4 },
  { id: "elder", name: "祖辈", emoji: "👵", color: "#B58BD6", gender: "female", ageYears: 68, ageMonths: 0, relation: "外婆", conditions: [], activity: "moderate", notes: "老年期，清淡软烂", sort: 5 }
];

/* 各成员每日营养素推荐量：由 planner 依据年龄 / 性别 / 身体问题推导（DRIs 2023） */
var STANDARDS = {};
MEMBERS.forEach(function (m) {
  var t = planner.deriveTarget(m);
  t.label = m.name + "（" + memberAgeText(m) + "）";
  STANDARDS[m.id] = t;
});

/* 家庭成员角色顺序（周计划与展示按此顺序） */
var FAMILY = ["toddler", "mom", "child", "adult", "elder"];

var RECIPES = [
  { id: "r1", name: "番茄炖牛腩", who: "common", tags: ["补铁", "高蛋白", "一锅两吃"], time: 60,
    ing: [{ name: "牛腩", g: 300, cat: "蛋白" }, { name: "番茄", g: 300, cat: "蔬菜" }, { name: "洋葱", g: 80, cat: "蔬菜" }, { name: "胡萝卜", g: 100, cat: "蔬菜" }],
    steps: ["牛腩切块焯水", "番茄去皮切块，洋葱切丁", "少油炒香洋葱，下番茄炒出汁", "加牛腩与水炖1小时", "最后20分钟下胡萝卜"],
    split: "幼儿：牛腩胡萝卜捞出剁碎、去番茄皮，配软饭浇汁。孕妇：原锅食用，配杂粮饭+一把焯菠菜（补叶酸）。",
    nutri: { kcal: 420, protein: 32, calcium: 60, iron: 6, zinc: 4, vitA: 300, vitD: 0.5, vitC: 25, dha: 0.2, folate: 180, fiber: 4 } },
  { id: "r2", name: "清蒸鳕鱼", who: "common", tags: ["补蛋白", "低汞"], time: 20,
    ing: [{ name: "鳕鱼", g: 150, cat: "蛋白" }, { name: "姜", g: 5, cat: "蔬菜" }],
    steps: ["鱼块铺姜丝", "水开后蒸8-10分钟", "淋少许婴儿酱油（幼儿）/生抽（孕妇）"],
    split: "两人同锅，幼儿去刺拆肉碾碎，孕妇直接食用。",
    nutri: { kcal: 180, protein: 28, calcium: 30, iron: 0.5, zinc: 0.4, vitA: 20, vitD: 2, vitC: 0, dha: 0.3, folate: 10, fiber: 0 } },
  { id: "r3", name: "番茄牛肉末", who: "common", tags: ["补铁", "高蛋白", "一锅两吃"], time: 25,
    ing: [{ name: "牛肉末", g: 150, cat: "蛋白" }, { name: "番茄", g: 200, cat: "蔬菜" }],
    steps: ["牛肉末炒散", "下番茄炒出汁", "少水略炖收汁"],
    split: "幼儿：肉末更细，配软饭。孕妇：可加彩椒同炒，配杂粮饭。",
    nutri: { kcal: 260, protein: 22, calcium: 20, iron: 3, zinc: 3, vitA: 150, vitD: 0, vitC: 15, dha: 0, folate: 30, fiber: 2 } },
  { id: "r4", name: "虾仁豆腐", who: "common", tags: ["补钙", "高蛋白"], time: 20,
    ing: [{ name: "虾仁", g: 100, cat: "蛋白" }, { name: "豆腐", g: 200, cat: "蛋白" }],
    steps: ["虾仁去壳开背", "豆腐切块轻推", "少油同焖，勾薄芡"],
    split: "两人同锅，幼儿虾仁切小丁防呛。",
    nutri: { kcal: 200, protein: 20, calcium: 180, iron: 2, zinc: 1.5, vitA: 40, vitD: 0.3, vitC: 2, dha: 0.2, folate: 25, fiber: 1 } },
  { id: "r5", name: "香菇炖鸡", who: "common", tags: ["补蛋白", "一锅两吃"], time: 40,
    ing: [{ name: "鸡腿", g: 200, cat: "蛋白" }, { name: "香菇", g: 80, cat: "蔬菜" }],
    steps: ["鸡腿剁块焯水", "香菇泡发切片", "同炖至软烂"],
    split: "幼儿：鸡肉撕丝剁碎，香菇切碎。孕妇：整块食用，配饭。",
    nutri: { kcal: 240, protein: 26, calcium: 15, iron: 1.5, zinc: 2, vitA: 50, vitD: 0.2, vitC: 3, dha: 0.1, folate: 12, fiber: 1 } },
  { id: "r6", name: "猪肝（补铁）", who: "common", tags: ["补铁", "补叶酸"], time: 15,
    ing: [{ name: "猪肝", g: 100, cat: "蛋白" }, { name: "菠菜", g: 100, cat: "蔬菜" }],
    steps: ["猪肝切薄片泡水去血水", "快炒至变色", "下菠菜同炒"],
    split: "幼儿：肝泥/极细碎（30g）。孕妇：爆炒猪肝（50g）+菠菜。每周1次。",
    nutri: { kcal: 160, protein: 20, calcium: 8, iron: 22, zinc: 4, vitA: 4500, vitD: 0.1, vitC: 20, dha: 0.1, folate: 300, fiber: 0 } },
  { id: "r7", name: "香煎三文鱼", who: "common", tags: ["补DHA", "补蛋白"], time: 20,
    ing: [{ name: "三文鱼", g: 150, cat: "蛋白" }],
    steps: ["鱼块厨房纸吸干", "少油中小火每面3分钟", "撒黑胡椒（孕妇）"],
    split: "幼儿：去骨碾碎（30-50g）。孕妇：100-150g整块。",
    nutri: { kcal: 280, protein: 25, calcium: 15, iron: 0.8, zinc: 0.5, vitA: 30, vitD: 8, vitC: 0, dha: 1.5, folate: 10, fiber: 0 } },
  { id: "r8", name: "水蒸蛋", who: "common", tags: ["高蛋白", "快手"], time: 12,
    ing: [{ name: "鸡蛋", g: 100, cat: "蛋白" }],
    steps: ["蛋打散加1.5倍温水", "过筛去泡", "中火蒸8分钟焖2分钟"],
    split: "两人同食，幼儿可更嫩。",
    nutri: { kcal: 130, protein: 11, calcium: 50, iron: 1.5, zinc: 1, vitA: 160, vitD: 1, vitC: 0, dha: 0.1, folate: 40, fiber: 0 } },
  { id: "r9", name: "麻婆豆腐（少辣）", who: "common", tags: ["补钙", "补蛋白"], time: 18,
    ing: [{ name: "豆腐", g: 250, cat: "蛋白" }, { name: "牛肉末", g: 50, cat: "蛋白" }],
    steps: ["豆腐切块焯水", "少油炒肉末", "加豆瓣酱（极少）与豆腐同烧", "勾芡撒葱"],
    split: "幼儿：免辣、肉末细。孕妇：微辣版。",
    nutri: { kcal: 220, protein: 14, calcium: 180, iron: 3, zinc: 1.5, vitA: 30, vitD: 0, vitC: 2, dha: 0, folate: 50, fiber: 2 } },
  { id: "r10", name: "清蒸鲈鱼", who: "common", tags: ["补蛋白", "补DHA"], time: 20,
    ing: [{ name: "鲈鱼", g: 200, cat: "蛋白" }],
    steps: ["鱼洗净两面划刀", "铺姜葱蒸9分钟", "淋热油与生抽"],
    split: "刺少适合幼儿，去刺拆肉；孕妇整块。",
    nutri: { kcal: 170, protein: 28, calcium: 30, iron: 0.4, zinc: 0.4, vitA: 20, vitD: 2, vitC: 0, dha: 0.4, folate: 10, fiber: 0 } },
  { id: "r11", name: "杂蔬炒饭", who: "common", tags: ["快手"], time: 15,
    ing: [{ name: "米饭", g: 200, cat: "主食" }, { name: "鸡蛋", g: 50, cat: "蛋白" }, { name: "胡萝卜", g: 50, cat: "蔬菜" }, { name: "豌豆", g: 50, cat: "蔬菜" }],
    steps: ["蛋炒散", "下米饭与蔬菜粒翻炒", "少盐调味"],
    split: "幼儿：饭粒压软、蔬菜切细。孕妇：加玉米粒更丰富。",
    nutri: { kcal: 320, protein: 9, calcium: 30, iron: 1.5, zinc: 1.2, vitA: 80, vitD: 0.2, vitC: 12, dha: 0, folate: 30, fiber: 3 } },
  { id: "r12", name: "什锦汤面", who: "common", tags: ["快手"], time: 15,
    ing: [{ name: "面条", g: 120, cat: "主食" }, { name: "鸡蛋", g: 50, cat: "蛋白" }, { name: "青菜", g: 80, cat: "蔬菜" }, { name: "番茄", g: 80, cat: "蔬菜" }],
    steps: ["番茄炒出汁加水煮开", "下面与青菜", "卧蛋或蛋花"],
    split: "幼儿：面煮更软、剪短。孕妇：正常。",
    nutri: { kcal: 300, protein: 12, calcium: 40, iron: 2, zinc: 1.5, vitA: 60, vitD: 0.3, vitC: 10, dha: 0, folate: 35, fiber: 3 } },
  { id: "r13", name: "小米粥蛋", who: "common", tags: ["快手"], time: 30,
    ing: [{ name: "小米", g: 40, cat: "主食" }, { name: "鸡蛋", g: 50, cat: "蛋白" }],
    steps: ["小米煮成粥", "淋蛋花或卧蛋"],
    split: "幼儿主食补充，孕妇亦可。",
    nutri: { kcal: 150, protein: 7, calcium: 20, iron: 1.2, zinc: 1, vitA: 120, vitD: 0.8, vitC: 0, dha: 0, folate: 30, fiber: 2 } },
  { id: "r14", name: "燕麦牛奶", who: "mom", tags: ["补钙", "补纤维"], time: 8,
    ing: [{ name: "燕麦", g: 40, cat: "主食" }, { name: "牛奶", g: 250, cat: "奶" }],
    steps: ["燕麦加牛奶微波或煮", "可加坚果"],
    split: "孕妇专属加餐/早餐，补钙补纤维。",
    nutri: { kcal: 260, protein: 11, calcium: 300, iron: 1.5, zinc: 1.5, vitA: 60, vitD: 1.5, vitC: 2, dha: 0, folate: 20, fiber: 4 } },
  { id: "r15", name: "杂粮饭", who: "mom", tags: ["补纤维"], time: 35,
    ing: [{ name: "糙米", g: 60, cat: "主食" }, { name: "大米", g: 60, cat: "主食" }],
    steps: ["白米糙米1:1洗净", "正常焖煮"],
    split: "孕妇主食，控糖优选。",
    nutri: { kcal: 220, protein: 5, calcium: 15, iron: 1.5, zinc: 1.5, vitA: 0, vitD: 0, vitC: 0, dha: 0, folate: 20, fiber: 3 } },
  { id: "r16", name: "南瓜粥", who: "common", tags: ["补维A", "快手"], time: 25,
    ing: [{ name: "南瓜", g: 120, cat: "蔬菜" }, { name: "大米", g: 30, cat: "主食" }],
    steps: ["南瓜切块与米同煮成粥", "可压泥"],
    split: "幼儿爱吃，孕妇亦可。",
    nutri: { kcal: 120, protein: 3, calcium: 25, iron: 0.8, zinc: 0.6, vitA: 400, vitD: 0, vitC: 8, dha: 0, folate: 15, fiber: 2 } },
  { id: "r17", name: "红烧排骨", who: "common", tags: ["补钙", "补蛋白"], time: 50,
    ing: [{ name: "排骨", g: 250, cat: "蛋白" }],
    steps: ["排骨焯水", "少油炒糖色（孕妇少糖）", "加酱油炖软", "收汁"],
    split: "幼儿：肉剔骨剁碎、汤拌饭。孕妇：整块。",
    nutri: { kcal: 350, protein: 26, calcium: 200, iron: 2, zinc: 3, vitA: 30, vitD: 0.1, vitC: 2, dha: 0, folate: 8, fiber: 0 } },
  { id: "r18", name: "鸡肉时蔬", who: "common", tags: ["补蛋白", "一锅两吃"], time: 25,
    ing: [{ name: "鸡胸", g: 150, cat: "蛋白" }, { name: "西兰花", g: 100, cat: "蔬菜" }, { name: "胡萝卜", g: 50, cat: "蔬菜" }],
    steps: ["鸡胸切片", "蔬菜切小朵", "少油快炒"],
    split: "幼儿：鸡肉蔬菜切碎。孕妇：正常块。",
    nutri: { kcal: 200, protein: 22, calcium: 30, iron: 1.2, zinc: 1.8, vitA: 100, vitD: 0.2, vitC: 15, dha: 0.1, folate: 30, fiber: 3 } },
  { id: "r19", name: "全麦三明治", who: "mom", tags: ["补钙", "补纤维"], time: 8,
    ing: [{ name: "全麦面包", g: 80, cat: "主食" }, { name: "鸡蛋", g: 50, cat: "蛋白" }, { name: "牛油果", g: 50, cat: "水果" }],
    steps: ["水煮蛋切片", "牛油果压泥", "夹入全麦面包"],
    split: "孕妇早餐，补好脂肪与钙。",
    nutri: { kcal: 300, protein: 14, calcium: 150, iron: 2.5, zinc: 2, vitA: 80, vitD: 0.5, vitC: 8, dha: 0, folate: 40, fiber: 4 } },
  { id: "r20", name: "软饭", who: "toddler", tags: ["主食"], time: 30,
    ing: [{ name: "大米", g: 60, cat: "主食" }],
    steps: ["米多加水煮更软烂"],
    split: "幼儿主食基底。",
    nutri: { kcal: 200, protein: 4, calcium: 10, iron: 0.5, zinc: 0.6, vitA: 0, vitD: 0, vitC: 0, dha: 0, folate: 10, fiber: 1 } },
  { id: "r21", name: "酸奶坚果", who: "mom", tags: ["补钙", "补DHA"], time: 3,
    ing: [{ name: "酸奶", g: 200, cat: "奶" }, { name: "核桃", g: 20, cat: "其他" }],
    steps: ["酸奶加碾碎核桃"],
    split: "孕妇加餐，补好脂肪。",
    nutri: { kcal: 200, protein: 8, calcium: 200, iron: 0.8, zinc: 1.2, vitA: 40, vitD: 0.2, vitC: 2, dha: 0, folate: 15, fiber: 2 } },
  { id: "r22", name: "水果酸奶", who: "common", tags: ["补钙", "补维C"], time: 3,
    ing: [{ name: "酸奶", g: 150, cat: "奶" }, { name: "蓝莓", g: 50, cat: "水果" }],
    steps: ["酸奶拌水果"],
    split: "两人加餐，幼儿减半。",
    nutri: { kcal: 150, protein: 5, calcium: 150, iron: 0.4, zinc: 0.5, vitA: 30, vitD: 0.2, vitC: 15, dha: 0, folate: 20, fiber: 2 } },
  { id: "r23", name: "全麦馒头", who: "common", tags: ["主食"], time: 5,
    ing: [{ name: "全麦馒头", g: 60, cat: "主食" }],
    steps: ["蒸熟即可"],
    split: "加餐主食。",
    nutri: { kcal: 160, protein: 5, calcium: 30, iron: 1.2, zinc: 0.8, vitA: 0, vitD: 0, vitC: 0, dha: 0, folate: 15, fiber: 2 } },
  { id: "r24", name: "蓝莓", who: "toddler", tags: ["补维C", "抗氧化"], time: 1,
    ing: [{ name: "蓝莓", g: 50, cat: "水果" }],
    steps: ["洗净即可"],
    split: "幼儿加餐，防呛切半。",
    nutri: { kcal: 60, protein: 1, calcium: 10, iron: 0.3, zinc: 0.2, vitA: 30, vitD: 0, vitC: 10, dha: 0, folate: 8, fiber: 2 } }
];

/* 周计划模板：每天 6 个餐次，每个餐次一道「全家共享」主菜（recipe id）。
   生成时展开为每位家庭成员（FAMILY）都映射到同一道菜，体现「一锅全家吃、按需分装」。 */
var WEEK_TPL = [
  ["r8", "r22", "r1", "r23", "r4", "r14"],
  ["r13", "r22", "r2", "r23", "r18", "r14"],
  ["r8", "r22", "r6", "r23", "r7", "r14"],
  ["r13", "r22", "r9", "r23", "r8", "r14"],
  ["r8", "r22", "r5", "r23", "r1", "r14"],
  ["r16", "r22", "r10", "r23", "r17", "r14"],
  ["r13", "r22", "r11", "r23", "r12", "r14"]
];
var WEEK_SLOTS = ["早", "早点", "午", "午点", "晚", "睡前"];
var WEEK_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
var WEEK = WEEK_TPL.map(function (day, i) {
  var slots = {};
  WEEK_SLOTS.forEach(function (sk, j) {
    var rid = day[j];
    var m = {};
    FAMILY.forEach(function (f) { m[f] = rid; });
    slots[sk] = m;
  });
  return { label: WEEK_LABELS[i], slots: slots };
});

var PANTRY = [
  { name: "鸡蛋", qty: 12, unit: "个", bought: daysAgo(2), exp: daysAgo(-12) },
  { name: "牛奶", qty: 2, unit: "L", bought: daysAgo(1), exp: daysAgo(-5) },
  { name: "豆腐", qty: 2, unit: "块", bought: daysAgo(1), exp: daysAgo(-2) },
  { name: "三文鱼", qty: 300, unit: "g", bought: daysAgo(1), exp: daysAgo(-1) }
];

module.exports = { STANDARDS: STANDARDS, MEMBERS: MEMBERS, RECIPES: RECIPES, WEEK: WEEK, PANTRY: PANTRY };
