import Database from "better-sqlite3";
import path from "path";

const DB_PATH = process.env.DB_PATH || path.join(process.cwd(), "data", "molt.db");

export function initDb() {
  const db = new Database(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      agent_id TEXT PRIMARY KEY,
      rating INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      losses INTEGER NOT NULL,
      trust INTEGER NOT NULL DEFAULT 0,
      honors INTEGER NOT NULL DEFAULT 0,
      betrayals INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS matches (
      id TEXT PRIMARY KEY,
      seed INTEGER NOT NULL,
      ended_at INTEGER NOT NULL,
      winner TEXT,
      season TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_season (
      agent_id TEXT NOT NULL,
      season TEXT NOT NULL,
      rating INTEGER NOT NULL,
      wins INTEGER NOT NULL,
      losses INTEGER NOT NULL,
      trust INTEGER NOT NULL DEFAULT 0,
      honors INTEGER NOT NULL DEFAULT 0,
      betrayals INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (agent_id, season)
    );
  `);
  try { db.exec("ALTER TABLE agents ADD COLUMN trust INTEGER NOT NULL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN honors INTEGER NOT NULL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE agents ADD COLUMN betrayals INTEGER NOT NULL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE agent_season ADD COLUMN trust INTEGER NOT NULL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE agent_season ADD COLUMN honors INTEGER NOT NULL DEFAULT 0"); } catch {}
  try { db.exec("ALTER TABLE agent_season ADD COLUMN betrayals INTEGER NOT NULL DEFAULT 0"); } catch {}
  return db;
}

export function loadAgentsFromDb(db) {
  const rows = db.prepare("SELECT agent_id, rating, wins, losses, trust, honors, betrayals FROM agents").all();
  const map = new Map();
  for (const r of rows) {
    map.set(r.agent_id, {
      rating: r.rating,
      wins: r.wins,
      losses: r.losses,
      trust: r.trust ?? 0,
      honors: r.honors ?? 0,
      betrayals: r.betrayals ?? 0
    });
  }
  return map;
}

export function saveAgentsToDb(db, map) {
  const stmt = db.prepare(
    "INSERT INTO agents (agent_id, rating, wins, losses, trust, honors, betrayals) VALUES (?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(agent_id) DO UPDATE SET rating=excluded.rating, wins=excluded.wins, losses=excluded.losses, trust=excluded.trust, honors=excluded.honors, betrayals=excluded.betrayals"
  );
  const tx = db.transaction(() => {
    for (const [agent_id, stats] of map.entries()) {
      stmt.run(agent_id, stats.rating, stats.wins, stats.losses, stats.trust || 0, stats.honors || 0, stats.betrayals || 0);
    }
  });
  tx();
}

export function loadSeasonAgentsFromDb(db, season) {
  const rows = db
    .prepare("SELECT agent_id, rating, wins, losses, trust, honors, betrayals FROM agent_season WHERE season = ?")
    .all(season);
  const map = new Map();
  for (const r of rows) {
    map.set(r.agent_id, {
      rating: r.rating,
      wins: r.wins,
      losses: r.losses,
      trust: r.trust ?? 0,
      honors: r.honors ?? 0,
      betrayals: r.betrayals ?? 0
    });
  }
  return map;
}

export function saveSeasonAgentsToDb(db, seasonMap, season) {
  const stmt = db.prepare(
    "INSERT INTO agent_season (agent_id, season, rating, wins, losses, trust, honors, betrayals) VALUES (?, ?, ?, ?, ?, ?, ?, ?) " +
      "ON CONFLICT(agent_id, season) DO UPDATE SET rating=excluded.rating, wins=excluded.wins, losses=excluded.losses, trust=excluded.trust, honors=excluded.honors, betrayals=excluded.betrayals"
  );
  const tx = db.transaction(() => {
    for (const [agent_id, stats] of seasonMap.entries()) {
      stmt.run(agent_id, season, stats.rating, stats.wins, stats.losses, stats.trust || 0, stats.honors || 0, stats.betrayals || 0);
    }
  });
  tx();
}

export function saveMatchSummaryToDb(db, summary) {
  const stmt = db.prepare(
    "INSERT OR REPLACE INTO matches (id, seed, ended_at, winner, season) VALUES (?, ?, ?, ?, ?)"
  );
  stmt.run(summary.match_id, summary.seed, summary.ended_at, summary.winner, summary.season);
}

export function loadMatchSummariesFromDb(db, limit = 20) {
  return db
    .prepare("SELECT id, seed, ended_at, winner, season FROM matches ORDER BY ended_at DESC LIMIT ?")
    .all(limit);
}
