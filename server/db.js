/* 数据层入口：自动选择底层实现
   - 设置了 DATABASE_URL（如 Supabase 连接串）→ server/db-pg.js（PostgreSQL）
   - 未设置                                  → server/db-sqlite.js（本地 SQLite，零依赖）
   两个实现导出完全一致的 async API，业务层无需关心。 */
"use strict";

var usePg = !!(process.env.DATABASE_URL && process.env.DATABASE_URL.trim());
var impl = require(usePg ? "./db-pg" : "./db-sqlite");

var api = {};
Object.keys(impl).forEach(function (k) { api[k] = impl[k]; });
api.driver = usePg ? "postgres" : "sqlite";

module.exports = api;
