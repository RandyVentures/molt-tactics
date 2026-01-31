import crypto from "crypto";
import fs from "fs";
import path from "path";

const CONFIG_PATH = process.env.CONFIG_PATH || "./config.json";

const DEFAULTS = {
  apiBaseUrl: "http://localhost:3000/api",
  agentId: "",
  class: "warrior",
  turnMs: 15000,
  policyPath: "./policy.js",
  memoryPath: "./memory.json"
};

function loadConfig() {
  let cfg = {};
  try {
    cfg = JSON.parse(fs.readFileSync(path.resolve(CONFIG_PATH), "utf-8"));
  } catch {
    cfg = {};
  }

  const repaired = { ...DEFAULTS, ...cfg };
  if (!["warrior", "mage", "rogue", "ranger"].includes(repaired.class)) repaired.class = DEFAULTS.class;
  if (typeof repaired.turnMs !== "number" || repaired.turnMs < 1000) repaired.turnMs = DEFAULTS.turnMs;
  if (typeof repaired.apiBaseUrl !== "string" || !repaired.apiBaseUrl) repaired.apiBaseUrl = DEFAULTS.apiBaseUrl;
  if (typeof repaired.policyPath !== "string" || !repaired.policyPath) repaired.policyPath = DEFAULTS.policyPath;
  if (typeof repaired.memoryPath !== "string" || !repaired.memoryPath) repaired.memoryPath = DEFAULTS.memoryPath;
  if (typeof repaired.agentId !== "string") repaired.agentId = DEFAULTS.agentId;

  // Self-repair the config file if missing/invalid
  try {
    fs.writeFileSync(path.resolve(CONFIG_PATH), JSON.stringify(repaired, null, 2));
  } catch {
    // ignore
  }

  return repaired;
}

const rawConfig = loadConfig();

const API_BASE_URL = process.env.API_BASE_URL || rawConfig.apiBaseUrl;
const CLASS = process.env.CLASS || rawConfig.class;
const TURN_MS = Number(process.env.TURN_MS || rawConfig.turnMs);
const POLICY_PATH = process.env.POLICY_PATH || rawConfig.policyPath;
const MEMORY_PATH = process.env.MEMORY_PATH || rawConfig.memoryPath;

const AGENT_ID = process.env.AGENT_ID || rawConfig.agentId || `openclaw:auto_${crypto.randomUUID()}`;
let AGENT_SECRET = process.env.AGENT_SECRET || "";

let matchId = null;
let memory = {};

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

function loadMemory() {
  try {
    memory = JSON.parse(fs.readFileSync(path.resolve(MEMORY_PATH), "utf-8"));
  } catch {
    memory = {};
  }
}

function saveMemory() {
  try {
    fs.writeFileSync(path.resolve(MEMORY_PATH), JSON.stringify(memory, null, 2));
  } catch {
    // ignore
  }
}

let policy = null;
async function loadPolicy() {
  if (policy) return policy;
  const mod = await import(POLICY_PATH);
  policy = mod.chooseAction;
  return policy;
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
  const me = state.agents.find((a) => a.agent_id === AGENT_ID);
  const choose = await loadPolicy();
  const action = choose ? choose(state, me, memory) : { type: "defend" };
  const result = await submitAction(state.turn, action);
  console.log("submitted", result, action);
  saveMemory();
}

loadMemory();
setInterval(loop, TURN_MS);
loop();
