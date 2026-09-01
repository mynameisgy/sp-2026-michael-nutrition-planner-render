# 部署指南：Render（免费计划）+ Supabase（免费数据库）

改造后系统支持**双模存储**，同一套代码既能本地跑，也能跑在线上：

| 环境 | 触发条件 | 存储 |
|---|---|---|
| 本地 | 没设置 `DATABASE_URL` | SQLite（`data/nutri.db`，零依赖） |
| 线上 | 设置了 `DATABASE_URL` | PostgreSQL（Supabase） |

前端页面、API 地址完全没变，**前端代码一行没动**。

---

## 第 1 步：创建 Supabase 项目（约 3 分钟）

1. 打开 https://supabase.com → 右上角 **Start your project**，**用 GitHub 账号登录**（和 Render 一致，省事）
2. Dashboard 左上角 **New project**
3. 填写：
   - **Name**：`family-nutrition`
   - **Database Password**：自己设一个，**立刻复制保存到备忘录**（后面只显示一次）
   - **Region**：选 **Southeast Asia (Singapore)**（离悉尼最近）
   - Plan：**Free**
4. 点 **Create new project**，等约 2 分钟初始化

## 第 2 步：拿数据库连接串

Supabase Dashboard → 左下角 **Project Settings**（齿轮）→ **Database** → 往下找 **Connection string**

- 切到 **URI** 标签
- 复制 **Session pooler** 那一条（端口是 `6543`，不是 5432）
  - 形如：`postgresql://postgres.abcdefgh:你的密码@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres`
- ⚠️ 里面 `<your-password>` 要替换成你第 1 步设的真实密码

## 第 3 步：本地配置并初始化数据库

在项目目录（`C:\Users\Michael Guo\Documents\SnailAI-Projects\sp-2026-michael-nutrition-planner`）里：

1. 复制 `.env.example` 为 `.env`，把 `DATABASE_URL=` 后面换成上一步的连接串
   （`.env` 已在 `.gitignore` 里，**不会被上传 GitHub**）
2. 安装依赖（只需一次）：
   ```
   npm install
   ```
3. 建表 + 灌入种子数据：
   ```
   npm run init:pg
   ```
   看到 `✓ 初始化完成` 和 4 行数字就对了。

## 第 4 步：本地先用 Postgres 跑一遍（重要）

```
npm start
```

打开 http://localhost:3000/api/health ，必须看到：

```json
{"ok":true,"driver":"postgres","version":"1.1.0"}
```

**`driver` 是 `postgres` 才算成功**。然后打开 http://localhost:3000 随便点几下，确认页面正常、后台能改。

> 想搬已有的本地数据（改过的库存、周计划等）上去：`npm run migrate:pg`
> （会清空 Postgres 端数据，用本地 SQLite 整体覆盖，只在首次切线上用一次）

## 第 5 步：提交代码到 GitHub

本地验证通过后，把改动提交并推送（这一步完成后 Render 才能拉到代码）。

## 第 6 步：Render 部署

### 方式 A：用蓝图（推荐，配置都写好了）

1. 打开 https://dashboard.render.com → **New** → **Blueprint**
2. 连接 GitHub 账号，选中 `snail-ai-academy/sp-2026-michael-nutrition-planner` 仓库
3. Render 会读到仓库里的 `render.yaml`，点 **Apply**
4. 部署前/后，在服务的 **Environment** 里手动添加：
   - `DATABASE_URL` = Supabase 连接串（第 2 步那条）

### 方式 B：手动建 Web Service

| 配置项 | 填什么 |
|---|---|
| Type | **Web Service** |
| Repo | `snail-ai-academy/sp-2026-michael-nutrition-planner` |
| Name | `sp-2026-michael-nutrition-planner`（**服务名即网址前缀，必须以此开头才能拿到 SP 开头的链接**） |
| Region | **Singapore** |
| Branch | `main` |
| Runtime | **Node** |
| Build Command | `npm install --omit=dev` |
| Start Command | `node --experimental-sqlite server/server.js`（本地/线上默认 SQLite，必须带实验标志） |
| Plan | **Free**（不要选付费） |

环境变量加两个：
- `DATABASE_URL` = Supabase 连接串
- `NODE_VERSION` = `22`

## 第 7 步：上线验证 + 保活

部署完成后 Render 会给一个地址：`https://sp-2026-michael-nutrition-planner.onrender.com`（**以 SP 开头**）

1. 打开 `https://你的地址/api/health` → 应返回 `{"ok":true,"driver":"postgres",...}`
2. 打开首页和 `/admin` 各点一遍
3. **首访慢是正常的**（免费计划 15 分钟无访问会休眠，唤醒要 30–60 秒）

### 配置保活（强烈建议）

免费 Web Service 会休眠，家里人打开时可能要等半分钟。加个免费 Cron Job 每 10 分钟 ping 一次：

Render Dashboard → **New** → **Cron Job**
- Name：`keep-warm`
- Command：`curl -s https://sp-2026-michael-nutrition-planner.onrender.com/api/health`
- Schedule：`*/10 * * * *`
- Plan：**Free**

---

## 常见问题

| 现象 | 原因 | 怎么办 |
|---|---|---|
| `/api/health` 返回 `driver":"sqlite"` | 环境变量没生效 | 检查 Render 里 `DATABASE_URL` 是否填了，改完要 **Manual Deploy → Clear build cache & deploy** |
| 页面能开，数据全空 | 没跑 `init:pg` | 本地跑一次 `npm run init:pg` |
| 报 `connection timeout` | 连接串用了直连端口 5432 | 换成 **Session pooler（6543）** 那条 |
| 报 `SSL` 相关错误 | 连接串缺 sslmode | 代码已自动开启 SSL；确认连接串里没写 `sslmode=disable` |
| 隔几天打不开，报数据库错 | Supabase 免费项目 7 天无访问会暂停 | 进 Supabase Dashboard 点 **Restore project**，30 秒恢复（保活 Cron 也能避免） |
| 本地想改回 SQLite | — | 把 `.env` 里的 `DATABASE_URL` 删掉或整行注释即可 |

## 免费额度提醒

| 服务 | 免费额度 |
|---|---|
| Render Web Service | 750 小时/月，15 分钟无访问休眠 |
| Supabase 数据库 | 500 MB，7 天无访问暂停（数据不丢） |
| Supabase 带宽 | 10 GB/月 |

家庭自用这个量级完全够用。
