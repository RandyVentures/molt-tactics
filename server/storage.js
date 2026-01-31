import fs from "fs";
import path from "path";

const DATA_DIR = path.join(process.cwd(), "data");
const AGENTS_FILE = path.join(DATA_DIR, "agents.json");
const MATCHES_FILE = path.join(DATA_DIR, "matches.json");
const SEASONS_FILE = path.join(DATA_DIR, "seasons.json");

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function loadAgents() {
  ensureDir();
  if (!fs.existsSync(AGENTS_FILE)) return new Map();
  const raw = JSON.parse(fs.readFileSync(AGENTS_FILE, "utf-8"));
  const map = new Map();
  for (const [k, v] of Object.entries(raw)) {
    map.set(k, {
      rating: v.rating ?? 1500,
      wins: v.wins ?? 0,
      losses: v.losses ?? 0,
      trust: v.trust ?? 0,
      honors: v.honors ?? 0,
      betrayals: v.betrayals ?? 0
    });
  }
  return map;
}

export function saveAgents(map) {
  ensureDir();
  const obj = Object.fromEntries(map.entries());
  fs.writeFileSync(AGENTS_FILE, JSON.stringify(obj, null, 2));
}

export function loadMatches() {
  ensureDir();
  if (!fs.existsSync(MATCHES_FILE)) return [];
  return JSON.parse(fs.readFileSync(MATCHES_FILE, "utf-8"));
}

export function saveMatchSummary(summary) {
  ensureDir();
  const list = loadMatches();
  list.push(summary);
  fs.writeFileSync(MATCHES_FILE, JSON.stringify(list, null, 2));
}

export function loadSeasonStats() {
  ensureDir();
  if (!fs.existsSync(SEASONS_FILE)) return {};
  return JSON.parse(fs.readFileSync(SEASONS_FILE, "utf-8"));
}

export function saveSeasonStats(obj) {
  ensureDir();
  fs.writeFileSync(SEASONS_FILE, JSON.stringify(obj, null, 2));
}
