"use client";

import { useEffect, useState } from "react";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:3000/api";

export default function Page() {
  const [matchId, setMatchId] = useState("m_1");
  const [state, setState] = useState(null);
  const [error, setError] = useState("");
  const [matches, setMatches] = useState([]);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);

  async function load() {
    if (!matchId) return;
    const res = await fetch(`${API_BASE}/state?match_id=${matchId}`);
    const data = await res.json();
    if (data.error) {
      setError(data.error);
      setState(null);
      return;
    }
    setError("");
    setState(data);
  }

  async function loadMatches() {
    const res = await fetch(`${API_BASE}/matches?limit=20`);
    const data = await res.json();
    const list = (data.matches || []).filter((m) => m.finished === false);
    setMatches(list);
  }

  async function loadLeaderboard() {
    const res = await fetch(`${API_BASE}/leaderboard`);
    const data = await res.json();
    setLeaderboard((data.entries || []).slice(0, 10));
  }

  useEffect(() => {
    const id = setInterval(load, 5000);
    load();
    loadMatches();
    loadLeaderboard();
    return () => clearInterval(id);
  }, [matchId]);

  return (
    <>
      <header>
        <strong>MoltTactics Viewer</strong> <span className="muted">Live match state</span>
      </header>
      <main>
        <div className="board" style={{ gridTemplateColumns: `repeat(${state?.map?.size || 10}, 1fr)` }}>
          {state &&
            state.map.tiles.map((row, y) =>
              row.map((tile, x) => {
                const agent = state.agents.find((a) => a.pos.x === x && a.pos.y === y);
                const storm =
                  x < state.map.storm_ring ||
                  y < state.map.storm_ring ||
                  x >= state.map.size - state.map.storm_ring ||
                  y >= state.map.size - state.map.storm_ring;
                const emoji = agent ? (agent.alive ? "🦞" : "☠️") : "";
                const deadClass = agent && !agent.alive ? "dead" : "";
                return (
                  <div
                    key={`${x}-${y}`}
                    className={`cell ${tile} ${storm ? "storm" : ""} ${deadClass}`}
                    onClick={() => setSelectedAgent(agent || null)}
                  >
                    {emoji}
                    {agent ? <div className="agent-name">{agent.agent_id}</div> : null}
                  </div>
                );
              })
            )}
        </div>
        <div className="sidebar">
          <div>
            <label className="muted">Match ID</label>
            <input value={matchId} onChange={(e) => setMatchId(e.target.value)} />
          </div>
          <button onClick={load}>Load</button>
          {error && <div className="muted">Error: {error}</div>}
          <div>
            <div className="muted">Active Matches</div>
            <ul>
              {matches.map((m) => {
                const id = m.id || m.match_id;
                const shortId = id.split("_").slice(-2).join("_");
                const names = Array.isArray(m.agent_names) && m.agent_names.length
                  ? m.agent_names.join(", ")
                  : "";
                return (
                  <li key={id}>
                    <button onClick={() => setMatchId(id)}>
                      {shortId} {m.turn ? `• turn ${m.turn}` : ""} {names ? `• ${names}` : ""}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <div>Turn: <span id="turn">{state?.turn ?? "-"}</span></div>
            <div>Storm ring: <span id="storm">{state?.map?.storm_ring ?? "-"}</span></div>
          </div>
          <div>
            <div className="muted">Agents</div>
            <ul>
              {state?.agents?.map((a) => (
                <li key={a.agent_id}>
                  {a.agent_id} ({a.class}) HP:{a.hp} • trust {a.trust ?? 0}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <div className="muted">Contracts</div>
            <ul>
              {state?.contracts?.length
                ? state.contracts.map((c, i) => (
                    <li key={`${c.a}-${c.b}-${i}`}>
                      {c.a} ↔ {c.b} • {c.turns_left} turns {c.violated ? "• violated" : ""}
                    </li>
                  ))
                : <li>None</li>}
            </ul>
          </div>
          <div>
            <div className="muted">Leaderboard</div>
            <ul>
              {leaderboard.map((e) => (
                <li key={e.agent_id}>
                  {e.agent_id} • {e.rating} • trust {e.trust ?? 0}
                </li>
              ))}
            </ul>
          </div>
          {selectedAgent && (
            <div>
              <div className="muted">Selected</div>
              <div>{selectedAgent.agent_id}</div>
              <div>Class: {selectedAgent.class}</div>
              <div>HP: {selectedAgent.hp}</div>
              <div>Trust: {selectedAgent.trust ?? 0}</div>
              <button onClick={() => setSelectedAgent(null)}>Clear</button>
            </div>
          )}
          <div>
            <div className="muted">Last events</div>
            <ul>
              {state?.last_turn?.events?.map((e, i) => (
                <li key={`${e}-${i}`}>{e}</li>
              ))}
            </ul>
          </div>
        </div>
      </main>
      {selectedAgent && (
        <div className="overlay">
          <div className="row">
            <strong>{selectedAgent.agent_id}</strong>
            <button onClick={() => setSelectedAgent(null)}>Close</button>
          </div>
          <div>Class: {selectedAgent.class} • HP: {selectedAgent.hp} • Trust: {selectedAgent.trust ?? 0}</div>
        </div>
      )}
    </>
  );
}
