/* 家庭营养规划系统 — PostgreSQL / Supabase 表结构
   用法：psql "$DATABASE_URL" -f sql/schema.sql
        或 node scripts/init-pg.js（建表 + 灌种子数据，推荐）
   幂等：全部使用 IF NOT EXISTS，可重复执行。 */

CREATE TABLE IF NOT EXISTS standards (
  role  TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  data  JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS recipes (
  id    TEXT PRIMARY KEY,
  name  TEXT NOT NULL DEFAULT '',
  who   TEXT NOT NULL DEFAULT 'common',
  tags  JSONB NOT NULL DEFAULT '[]'::jsonb,
  time  INTEGER NOT NULL DEFAULT 0,
  ing   JSONB NOT NULL DEFAULT '[]'::jsonb,
  steps JSONB NOT NULL DEFAULT '[]'::jsonb,
  split TEXT NOT NULL DEFAULT '',
  nutri JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS week (
  idx   INTEGER PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  slots JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS pantry (
  id     BIGSERIAL PRIMARY KEY,
  name   TEXT NOT NULL DEFAULT '',
  qty    DOUBLE PRECISION NOT NULL DEFAULT 0,
  unit   TEXT NOT NULL DEFAULT 'g',
  bought TEXT NOT NULL DEFAULT '',
  exp    TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS members (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT '',
  emoji      TEXT NOT NULL DEFAULT '👤',
  color      TEXT NOT NULL DEFAULT '#888888',
  gender     TEXT NOT NULL DEFAULT 'female',
  age_years  INTEGER NOT NULL DEFAULT 0,
  age_months INTEGER NOT NULL DEFAULT 0,
  relation   TEXT NOT NULL DEFAULT '',
  conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
  activity   TEXT NOT NULL DEFAULT 'moderate',
  notes      TEXT NOT NULL DEFAULT '',
  sort       INTEGER NOT NULL DEFAULT 99
);

CREATE TABLE IF NOT EXISTS kv (
  key   TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb
);
