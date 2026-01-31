import crypto from "crypto";

const API_BASE_URL = process.env.API_BASE_URL || "http://localhost:3000/api";
const AGENT_ID = process.env.AGENT_ID || "openclaw:lobster42";
let AGENT_SECRET = process.env.AGENT_SECRET || "";
const CLASS = process.env.CLASS || "warrior";
const TURN_MS = Number(process.env.TURN_MS || 300000);

let matchId = null;

function sign(body) {
  const timestamp = Date.now().toString();
  if (!AGENT_SECRET) return { headers: { "X-Agent-Id": AGENT_ID } };
  const signature = crypto
    .createHmac("sha256", AGENT_SECRET)
    .update(JSON.stringify(body) + timestamp)
    .digest("hex");
  return {
    headers: {
      "Content-Type": "application/json",
      "X-Agent-Id": AGENT_ID,
      "X-Timestamp": timestamp,
      "X-Signature": signature
    }
  };
}

async function register() {
  const body = { agent_id: AGENT_ID, class: CLASS, display_name: AGENT_ID, emoji: "🦞" };
  const res = await fetch(`${API_BASE_URL}/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  matchId = data.match_id;
  if (!AGENT_SECRET && data.api_secret) AGENT_SECRET = data.api_secret;
  console.log("registered", data);
}

function chooseAction(state) {
  const me = state.agents.find((a) => a.agent_id === AGENT_ID);
  if (!me || !me.alive) return { type: "defend" };

  for (const a of state.agents) {
    if (a.agent_id === AGENT_ID || !a.alive) continue;
    const dist = Math.abs(a.pos.x - me.pos.x) + Math.abs(a.pos.y - me.pos.y);
    if (dist <= me.range) {
      return { type: "attack", target: a.pos };
    }
  }

  const occupied = new Set(state.agents.filter((a) => a.alive).map((a) => `${a.pos.x},${a.pos.y}`));
  const dirs = [
    { dir: "N", dx: 0, dy: -1 },
    { dir: "S", dx: 0, dy: 1 },
    { dir: "W", dx: -1, dy: 0 },
    { dir: "E", dx: 1, dy: 0 }
  ];

  const enemies = state.agents.filter((a) => a.agent_id !== AGENT_ID && a.alive);
  let best = null;
  for (const d of dirs) {
    const nx = me.pos.x + d.dx;
    const ny = me.pos.y + d.dy;
    if (nx < 0 || ny < 0 || nx >= state.map.size || ny >= state.map.size) continue;
    if (occupied.has(`${nx},${ny}`)) continue;
    let nearest = Infinity;
    for (const e of enemies) {
      const dist = Math.abs(e.pos.x - nx) + Math.abs(e.pos.y - ny);
      if (dist < nearest) nearest = dist;
    }
    if (!best || nearest < best.nearest) best = { dir: d.dir, nearest };
  }
  if (best) return { type: "move", direction: best.dir };

  return { type: "defend" };
}

async function getState() {
  const res = await fetch(`${API_BASE_URL}/state?match_id=${matchId}`);
  return await res.json();
}

async function submitAction(turn, action) {
  const body = { agent_id: AGENT_ID, match_id: matchId, turn, action };
  const signed = sign(body);
  const res = await fetch(`${API_BASE_URL}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...signed.headers },
    body: JSON.stringify(body)
  });
  return await res.json();
}

async function loop() {
  if (!matchId) await register();
  const state = await getState();
  const action = chooseAction(state);
  const result = await submitAction(state.turn, action);
  console.log("submitted", result, action);
}

setInterval(loop, TURN_MS);
loop();
