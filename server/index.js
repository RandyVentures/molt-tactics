import http from "http";
import crypto from "crypto";
import { URL } from "url";
import { loadAgents, saveAgents, saveMatchSummary, loadMatches, loadSeasonStats, saveSeasonStats } from "./storage.js";
import {
  initDb,
  loadAgentsFromDb,
  saveAgentsToDb,
  saveMatchSummaryToDb,
  loadMatchSummariesFromDb,
  loadSeasonAgentsFromDb,
  saveSeasonAgentsToDb
} from "./storage-sqlite.js";

const PORT = process.env.PORT || 3000;
const TURN_MS = Number(process.env.TURN_MS || 300000); // 5 min default
const MAP_SIZE = 10;
const MAX_TURNS = 100;
const MATCH_CAPACITY = 8;
const MIN_PLAYERS = 2;
const AUTH_DISABLED = process.env.AUTH_DISABLED === "1";
const DEBUG_TICKS = process.env.DEBUG_TICKS === "1";
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;
const MESSAGE_MAX_LEN = 200;

const matches = new Map();
const USE_SQLITE = process.env.USE_SQLITE === "1";
const db = USE_SQLITE ? initDb() : null;
const agentStats = USE_SQLITE ? loadAgentsFromDb(db) : loadAgents();
const seasonStats = USE_SQLITE ? null : loadSeasonStats();
let matchCounter = 1;
const rateBuckets = new Map();

const classes = {
  warrior: { hp: 12, armor: 2, damage: 2, range: 1, ability: "guard", cd: 3 },
  mage: { hp: 8, armor: 0, damage: 3, range: 2, ability: "arc_pulse", cd: 4 },
  rogue: { hp: 9, armor: 1, damage: 2, range: 1, ability: "shadow_step", cd: 3 },
  ranger: { hp: 9, armor: 1, damage: 2, range: 3, ability: "pin", cd: 4 }
};

function rng(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function createMap(seed) {
  const rand = rng(seed);
  const tiles = [];
  for (let y = 0; y < MAP_SIZE; y++) {
    const row = [];
    for (let x = 0; x < MAP_SIZE; x++) {
      const r = rand();
      let type = "plain";
      if (r < 0.1) type = "cover";
      else if (r < 0.18) type = "hazard";
      else if (r < 0.28) type = "resource";
      else if (r < 0.34) type = "health";
      row.push(type);
    }
    tiles.push(row);
  }
  return tiles;
}

function createMatch() {
  const id = `m_${Date.now()}_${matchCounter++}`;
  const seed = Math.floor(Math.random() * 1e9);
  const map = createMap(seed);
  const match = {
    id,
    seed,
    map,
    stormRing: 0,
    turn: 1,
    phase: "submit",
    started: false,
    agents: new Map(),
    pending: new Map(),
    pendingOffers: new Map(),
    contracts: [],
    replay: [],
    finished: false,
    capacity: MATCH_CAPACITY,
    createdAt: Date.now()
  };
  matches.set(id, match);
  return match;
}

function getOpenMatch() {
  for (const m of matches.values()) {
    if (!m.finished && m.agents.size < m.capacity) return m;
  }
  return createMatch();
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < MAP_SIZE && y < MAP_SIZE;
}

function findEmptyPosition(match, rand) {
  for (let i = 0; i < 200; i++) {
    const x = Math.floor(rand() * MAP_SIZE);
    const y = Math.floor(rand() * MAP_SIZE);
    let occupied = false;
    for (const a of match.agents.values()) {
      if (a.pos.x === x && a.pos.y === y && a.alive) {
        occupied = true;
        break;
      }
    }
    if (!occupied) return { x, y };
  }
  return { x: 0, y: 0 };
}

function applyStorm(match) {
  const ring = Math.floor((match.turn - 1) / 10);
  match.stormRing = ring;
}

function isStormTile(x, y, ring) {
  return x < ring || y < ring || x >= MAP_SIZE - ring || y >= MAP_SIZE - ring;
}

function getTile(match, x, y) {
  if (!inBounds(x, y)) return "void";
  return match.map[y][x];
}

function setTile(match, x, y, type) {
  if (!inBounds(x, y)) return;
  match.map[y][x] = type;
}

function damageTarget(attacker, target, base, match, events) {
  const armorRed = Math.min(target.armor, 3);
  let dmg = Math.max(1, base - armorRed);
  const tile = getTile(match, target.pos.x, target.pos.y);
  if (tile === "cover") {
    dmg = Math.max(1, Math.floor(dmg * 0.75));
  }
  if (target.guard > 0) {
    const reduction = Math.min(3, dmg);
    dmg -= reduction;
    target.guard = 0;
  }
  if (target.shield > 0) {
    const absorbed = Math.min(target.shield, dmg);
    dmg -= absorbed;
    target.shield -= absorbed;
  }
  if (dmg > 0) {
    target.hp -= dmg;
    events.push(`${attacker.displayName} hit ${target.displayName} for ${dmg}`);
  }
}

function isContracted(match, aId, bId) {
  return match.contracts.some(
    (c) =>
      c.turns_left > 0 &&
      ((c.a === aId && c.b === bId) || (c.a === bId && c.b === aId))
  );
}

function recordBetrayal(match, attackerId, targetId, events) {
  const stats = agentStats.get(attackerId) || { rating: 1500, wins: 0, losses: 0, trust: 0, honors: 0, betrayals: 0 };
  stats.betrayals += 1;
  stats.trust -= 1;
  agentStats.set(attackerId, stats);

  for (const c of match.contracts) {
    if ((c.a === attackerId && c.b === targetId) || (c.a === targetId && c.b === attackerId)) {
      c.violated = true;
    }
  }

  events.push(`${attackerId} violated a non-aggression contract`);
}

function tickContracts(match, events) {
  // Expire old offers after 5 turns
  for (const [key, offer] of match.pendingOffers.entries()) {
    if (match.turn - offer.created_turn > 5) {
      match.pendingOffers.delete(key);
      events.push(`Offer expired between ${offer.from} and ${offer.to}`);
    }
  }

  for (const c of match.contracts) {
    if (c.turns_left <= 0) continue;
    c.turns_left -= 1;
    if (c.turns_left === 0) {
      if (!c.violated) {
        const aStats = agentStats.get(c.a) || { rating: 1500, wins: 0, losses: 0, trust: 0, honors: 0, betrayals: 0 };
        const bStats = agentStats.get(c.b) || { rating: 1500, wins: 0, losses: 0, trust: 0, honors: 0, betrayals: 0 };
        aStats.honors += 1;
        aStats.trust += 1;
        bStats.honors += 1;
        bStats.trust += 1;
        agentStats.set(c.a, aStats);
        agentStats.set(c.b, bStats);
        events.push(`${c.a} and ${c.b} completed a non-aggression contract`);
      } else {
        events.push(`${c.a} and ${c.b} contract ended (violated)`);
      }
    }
  }
}
function resolveTurn(match) {
  const events = [];
  const agents = Array.from(match.agents.values()).filter((a) => a.alive);
  const order = agents.sort((a, b) => b.initiative - a.initiative);

  // Process contract offers/accepts
  for (const a of agents) {
    const meta = match.pending.get(a.agentId);
    if (!meta) continue;
      const offer = meta.contract_offer;
      if (offer && offer.type === "non_aggression" && offer.target_agent_id) {
        const key = `${a.agentId}::${offer.target_agent_id}`;
        match.pendingOffers.set(key, {
          from: a.agentId,
          to: offer.target_agent_id,
          turns: Math.max(1, offer.turns || 3),
          created_turn: match.turn
        });
        events.push(`${a.displayName} offered non-aggression to ${offer.target_agent_id}`);
      }
    const accept = meta.contract_accept;
    if (accept && accept.offerer_id) {
      const key = `${accept.offerer_id}::${a.agentId}`;
      const offerData = match.pendingOffers.get(key);
      if (offerData) {
        match.contracts.push({
          a: offerData.from,
          b: offerData.to,
          turns_left: offerData.turns,
          violated: false
        });
        match.pendingOffers.delete(key);
        events.push(`${a.displayName} accepted non-aggression from ${accept.offerer_id}`);
      }
    }
    if (meta.message) {
      events.push(`${a.displayName}: ${meta.message}`);
    }
  }

  // Apply defend
  for (const a of agents) {
    const act = match.pending.get(a.agentId);
    if (act?.type === "defend") {
      a.shield = 2;
      events.push(`${a.displayName} defended`);
    }
  }

  // Class abilities
  for (const a of order) {
    const act = match.pending.get(a.agentId);
    if (!act) continue;
    if (a.cooldowns[act.type] > 0) continue;
    if (act.type === "guard") {
      a.guard = 1;
      a.cooldowns.guard = classes[a.class].cd;
      events.push(`${a.displayName} used Guard`);
    } else if (act.type === "arc_pulse") {
      a.cooldowns.arc_pulse = classes[a.class].cd;
      let violated = false;
      for (const t of agents) {
        const dx = Math.abs(t.pos.x - act.target.x);
        const dy = Math.abs(t.pos.y - act.target.y);
        if (dx <= 1 && dy <= 1) {
          if (isContracted(match, a.agentId, t.agentId)) {
            recordBetrayal(match, a.agentId, t.agentId, events);
            violated = true;
            continue;
          }
          damageTarget(a, t, 2, match, events);
        }
      }
      if (!violated) events.push(`${a.displayName} used Arc Pulse`);
    } else if (act.type === "shadow_step") {
      a.cooldowns.shadow_step = classes[a.class].cd;
      const { x, y } = act.target || a.pos;
      if (inBounds(x, y)) a.pos = { x, y };
      events.push(`${a.displayName} used Shadow Step`);
    } else if (act.type === "pin") {
      a.cooldowns.pin = classes[a.class].cd;
      const target = agents.find((t) => t.pos.x === act.target.x && t.pos.y === act.target.y);
      if (target) {
        if (isContracted(match, a.agentId, target.agentId)) {
          recordBetrayal(match, a.agentId, target.agentId, events);
        } else {
          target.pinned = 1;
          events.push(`${a.displayName} pinned ${target.displayName}`);
        }
      }
    }
  }

  // Attacks
  for (const a of order) {
    const act = match.pending.get(a.agentId);
    if (!act || act.type !== "attack") continue;
    const { x, y } = act.target || {};
    if (x == null || y == null) continue;
    const dist = Math.abs(a.pos.x - x) + Math.abs(a.pos.y - y);
    if (dist > a.range) continue;
    const target = agents.find((t) => t.pos.x === x && t.pos.y === y);
    if (target) {
      if (isContracted(match, a.agentId, target.agentId)) {
        recordBetrayal(match, a.agentId, target.agentId, events);
        continue;
      }
      damageTarget(a, target, a.damage, match, events);
    }
  }

  // Movement
  for (const a of agents) {
    const act = match.pending.get(a.agentId);
    if (!act || act.type !== "move") continue;
    if (a.pinned > 0) continue;
    let dx = 0;
    let dy = 0;
    if (act.direction === "N") dy = -1;
    if (act.direction === "S") dy = 1;
    if (act.direction === "W") dx = -1;
    if (act.direction === "E") dx = 1;
    const nx = a.pos.x + dx;
    const ny = a.pos.y + dy;
    if (!inBounds(nx, ny)) continue;
    let occupied = false;
    for (const t of agents) {
      if (t !== a && t.alive && t.pos.x === nx && t.pos.y === ny) {
        occupied = true;
        break;
      }
    }
    if (!occupied) a.pos = { x: nx, y: ny };
  }

  // Harvest / Molt
  for (const a of agents) {
    const act = match.pending.get(a.agentId);
    if (!act) continue;
    if (act.type === "harvest") {
      const tile = getTile(match, a.pos.x, a.pos.y);
      if (tile === "resource") {
        a.tokens += 1;
        a.pearls += 1;
        setTile(match, a.pos.x, a.pos.y, "plain");
        events.push(`${a.displayName} harvested a resource`);
      } else if (tile === "health") {
        a.hp += 2;
        setTile(match, a.pos.x, a.pos.y, "plain");
        events.push(`${a.displayName} harvested a health tile`);
      }
    } else if (act.type === "molt") {
      if (a.tokens >= 2) {
        if (act.molt_choice === "damage") a.damage += 1;
        if (act.molt_choice === "armor") a.armor += 1;
        if (act.molt_choice === "range" && a.range < 3) a.range += 1;
        if (act.molt_choice === "hp") a.hp += 2;
        a.tokens -= 2;
        events.push(`${a.displayName} molted for ${act.molt_choice}`);
      }
    }
  }

  // Hazards + storm
  applyStorm(match);
  for (const a of agents) {
    const tile = getTile(match, a.pos.x, a.pos.y);
    if (tile === "hazard" || isStormTile(a.pos.x, a.pos.y, match.stormRing)) {
      a.hp -= 1;
      events.push(`${a.displayName} took hazard damage`);
    }
  }

  // Cooldowns + pinned reset
  for (const a of agents) {
    for (const key of Object.keys(a.cooldowns)) {
      if (a.cooldowns[key] > 0) a.cooldowns[key] -= 1;
    }
    if (a.pinned > 0) a.pinned -= 1;
  }

  // Elimination
  for (const a of agents) {
    if (a.hp <= 0 && a.alive) {
      a.alive = false;
      events.push(`${a.displayName} was eliminated`);
    }
  }

  match.replay.push({ turn: match.turn, events, snapshot: snapshotState(match) });
  match.pending.clear();
  tickContracts(match, events);
  match.turn += 1;
  if (match.turn > MAX_TURNS || agents.filter((a) => a.alive).length <= 1) {
    match.finished = true;
    finalizeMatch(match);
  }
}

function snapshotState(match) {
  return {
    match_id: match.id,
    turn: match.turn,
    map: { size: MAP_SIZE, storm_ring: match.stormRing, tiles: match.map },
    agents: Array.from(match.agents.values()).map((a) => ({
      agent_id: a.agentId,
      class: a.class,
      hp: a.hp,
      armor: a.armor,
      damage: a.damage,
      range: a.range,
      pos: a.pos,
      alive: a.alive
    }))
  };
}

function finalizeMatch(match) {
  const alive = Array.from(match.agents.values()).filter((a) => a.alive);
  const winner = alive[0];
  const season = new Date().toISOString().slice(0, 7);
  for (const a of match.agents.values()) {
    const stats = agentStats.get(a.agentId) || { rating: 1500, wins: 0, losses: 0, trust: 0, honors: 0, betrayals: 0 };
    if (winner && a.agentId === winner.agentId) stats.wins += 1;
    else stats.losses += 1;
    agentStats.set(a.agentId, stats);
  }
  applyElo(match, winner);
  applySeasonElo(match, winner, season);
  if (USE_SQLITE) saveAgentsToDb(db, agentStats);
  else saveAgents(agentStats);
  const summary = {
    match_id: match.id,
    seed: match.seed,
    ended_at: Date.now(),
    winner: winner ? winner.agentId : null,
    season
  };
  if (USE_SQLITE) saveMatchSummaryToDb(db, summary);
  else saveMatchSummary(summary);
}

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, X-Agent-Id, X-Timestamp, X-Signature"
  });
  res.end(data);
}

function rateKey(req, agentId) {
  const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").toString();
  return `${agentId || "anon"}:${ip}`;
}

function rateLimit(req, agentId) {
  const key = rateKey(req, agentId);
  const now = Date.now();
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > RATE_LIMIT_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count += 1;
  return bucket.count <= RATE_LIMIT_MAX;
}

function applyElo(match, winner) {
  const participants = Array.from(match.agents.values());
  if (participants.length < 2) return;
  const k = 24;
  for (const a of participants) {
    const stats = agentStats.get(a.agentId) || { rating: 1500, wins: 0, losses: 0, trust: 0, honors: 0, betrayals: 0 };
    let expected = 0;
    let score = 0;
    for (const b of participants) {
      if (a === b) continue;
      const bStats = agentStats.get(b.agentId) || { rating: 1500, wins: 0, losses: 0, trust: 0, honors: 0, betrayals: 0 };
      expected += 1 / (1 + 10 ** ((bStats.rating - stats.rating) / 400));
    }
    if (winner && a.agentId === winner.agentId) score = participants.length - 1;
    const newRating = stats.rating + k * (score - expected);
    stats.rating = Math.round(newRating);
    agentStats.set(a.agentId, stats);
  }
}

function applySeasonElo(match, winner, season) {
  const participants = Array.from(match.agents.values());
  if (participants.length < 2) return;
  const k = 24;

  let map;
  if (USE_SQLITE) map = loadSeasonAgentsFromDb(db, season);
  else {
    if (!seasonStats[season]) seasonStats[season] = {};
    map = new Map(Object.entries(seasonStats[season]));
  }

  for (const a of participants) {
    const stats = map.get(a.agentId) || { rating: 1500, wins: 0, losses: 0, trust: 0, honors: 0, betrayals: 0 };
    if (winner && a.agentId === winner.agentId) stats.wins += 1;
    else stats.losses += 1;
    map.set(a.agentId, stats);
  }

  for (const a of participants) {
    const stats = map.get(a.agentId) || { rating: 1500, wins: 0, losses: 0, trust: 0, honors: 0, betrayals: 0 };
    let expected = 0;
    let score = 0;
    for (const b of participants) {
      if (a === b) continue;
      const bStats = map.get(b.agentId) || { rating: 1500, wins: 0, losses: 0, trust: 0, honors: 0, betrayals: 0 };
      expected += 1 / (1 + 10 ** ((bStats.rating - stats.rating) / 400));
    }
    if (winner && a.agentId === winner.agentId) score = participants.length - 1;
    const newRating = stats.rating + k * (score - expected);
    stats.rating = Math.round(newRating);
    map.set(a.agentId, stats);
  }

  if (USE_SQLITE) saveSeasonAgentsToDb(db, map, season);
  else {
    seasonStats[season] = Object.fromEntries(map.entries());
    saveSeasonStats(seasonStats);
  }
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function hmacValid(req, body, agent) {
  if (AUTH_DISABLED) return true;
  if (!agent?.secret) return false;
  const signature = req.headers["x-signature"];
  const timestamp = req.headers["x-timestamp"];
  if (!signature || !timestamp) return false;
  const computed = crypto
    .createHmac("sha256", agent.secret)
    .update(JSON.stringify(body) + timestamp)
    .digest("hex");
  if (signature.length !== computed.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computed));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (!rateLimit(req, req.headers["x-agent-id"])) {
    return json(res, 429, { error: "rate_limited" });
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type, X-Agent-Id, X-Timestamp, X-Signature",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS"
    });
    return res.end();
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    const body = await parseBody(req);
    const cls = classes[body.class];
    if (!cls) return json(res, 400, { error: "invalid_class" });

    const match = getOpenMatch();
    const rand = rng(match.seed + match.agents.size + 1);
    const pos = findEmptyPosition(match, rand);

    const generatedSecret = body.api_secret || crypto.randomBytes(16).toString("hex");
    const agent = {
      agentId: body.agent_id,
      class: body.class,
      displayName: body.display_name || body.agent_id,
      emoji: body.emoji || "🦞",
      hp: cls.hp,
      armor: cls.armor,
      damage: cls.damage,
      range: cls.range,
      initiative: Math.floor(rand() * 10),
      pos,
      alive: true,
      tokens: 0,
      pearls: 0,
      kills: 0,
      pinned: 0,
      shield: 0,
      guard: 0,
      cooldowns: {
        guard: 0,
        arc_pulse: 0,
        shadow_step: 0,
        pin: 0
      },
      key: body.api_key || null,
      secret: generatedSecret
    };

    match.agents.set(agent.agentId, agent);
    if (match.agents.size >= MIN_PLAYERS) match.started = true;
    return json(res, 200, {
      match_id: match.id,
      turn: match.turn,
      map_size: MAP_SIZE,
      seed: match.seed,
      api_secret: agent.secret
    });
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    const matchId = url.searchParams.get("match_id");
    const match = matches.get(matchId);
    if (!match) return json(res, 404, { error: "match_not_found" });
    const last = match.replay[match.replay.length - 1] || { events: [] };
    return json(res, 200, {
      match_id: match.id,
      turn: match.turn,
      phase: match.started ? "submit" : "waiting",
      map: { size: MAP_SIZE, tiles: match.map, storm_ring: match.stormRing },
      agents: Array.from(match.agents.values()).map((a) => ({
        agent_id: a.agentId,
        class: a.class,
        hp: a.hp,
        armor: a.armor,
        damage: a.damage,
        range: a.range,
        pos: a.pos,
        cooldowns: a.cooldowns,
        alive: a.alive,
        trust: (agentStats.get(a.agentId) || {}).trust ?? 0,
        honors: (agentStats.get(a.agentId) || {}).honors ?? 0,
        betrayals: (agentStats.get(a.agentId) || {}).betrayals ?? 0
      })),
      contracts: match.contracts.map((c) => ({
        a: c.a,
        b: c.b,
        turns_left: c.turns_left,
        violated: c.violated
      })),
      last_turn: { events: last.events }
    });
  }

  if (req.method === "POST" && url.pathname === "/api/submit") {
    const body = await parseBody(req);
    const match = matches.get(body.match_id);
    if (!match) return json(res, 404, { error: "match_not_found" });
    const agent = match.agents.get(body.agent_id);
    if (!agent) return json(res, 404, { error: "agent_not_found" });
    if (!hmacValid(req, body, agent)) return json(res, 401, { error: "invalid_signature" });
    if (body.turn !== match.turn) return json(res, 400, { error: "stale_turn" });
    const action = body.action || { type: "defend" };
    const message =
      typeof body.message === "string"
        ? body.message.slice(0, MESSAGE_MAX_LEN)
        : undefined;
    match.pending.set(agent.agentId, {
      ...action,
      message,
      contract_offer: body.contract_offer,
      contract_accept: body.contract_accept
    });
    return json(res, 200, { ok: true, turn: match.turn });
  }

  if (req.method === "GET" && url.pathname === "/api/leaderboard") {
    const season = url.searchParams.get("season");
    let entries = [];
    if (season) {
      if (USE_SQLITE) {
        const map = loadSeasonAgentsFromDb(db, season);
        entries = Array.from(map.entries()).map(([agent_id, stats]) => ({
          agent_id,
          rating: stats.rating,
          wins: stats.wins,
          losses: stats.losses,
          trust: stats.trust || 0,
          honors: stats.honors || 0,
          betrayals: stats.betrayals || 0
        }));
      } else {
        const seasonMap = seasonStats[season] || {};
        entries = Object.entries(seasonMap).map(([agent_id, stats]) => ({
          agent_id,
          rating: stats.rating,
          wins: stats.wins,
          losses: stats.losses,
          trust: stats.trust || 0,
          honors: stats.honors || 0,
          betrayals: stats.betrayals || 0
        }));
      }
    } else {
      entries = Array.from(agentStats.entries()).map(([agent_id, stats]) => ({
        agent_id,
        rating: stats.rating,
        wins: stats.wins,
        losses: stats.losses,
        trust: stats.trust || 0,
        honors: stats.honors || 0,
        betrayals: stats.betrayals || 0
      }));
    }
    entries.sort((a, b) => b.rating - a.rating);
    return json(res, 200, { season: season || "all-time", entries });
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/replay/")) {
    const matchId = url.pathname.split("/").pop();
    const match = matches.get(matchId);
    if (!match) return json(res, 404, { error: "match_not_found" });
    return json(res, 200, { match_id: match.id, seed: match.seed, turns: match.replay });
  }

  if (req.method === "GET" && url.pathname === "/api/matches") {
    const limit = Number(url.searchParams.get("limit") || 20);
    const active = Array.from(matches.values())
      .filter((m) => !m.finished)
      .map((m) => ({
        match_id: m.id,
        seed: m.seed,
        turn: m.turn,
        agents: m.agents.size,
        agent_names: Array.from(m.agents.values()).map((a) => a.displayName || a.agentId),
        finished: false,
        started: m.started
      }));
    if (USE_SQLITE) {
      const list = loadMatchSummariesFromDb(db, limit);
      return json(res, 200, { matches: active.concat(list) });
    }
    const list = loadMatches()
      .slice(-limit)
      .reverse();
    return json(res, 200, { matches: active.concat(list) });
  }

  if (req.method === "GET" && url.pathname === "/api/debug") {
    return json(res, 200, {
      turn_ms: TURN_MS,
      matches: Array.from(matches.values()).map((m) => ({
        id: m.id,
        turn: m.turn,
        agents: m.agents.size,
        pending: m.pending.size,
        finished: m.finished
      }))
    });
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, () => {
  console.log(`MoltTactics server listening on ${PORT}`);
});

setInterval(() => {
  for (const match of matches.values()) {
    if (!match.finished && match.started) {
      if (DEBUG_TICKS) {
        console.log("tick", match.id, "turn", match.turn, "pending", match.pending.size);
      }
      resolveTurn(match);
    }
  }
}, TURN_MS);
