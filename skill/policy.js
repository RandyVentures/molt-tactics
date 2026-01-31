export function chooseAction(state, self, memory) {
  if (!self || !self.alive) return { type: "defend" };

  // Heal if standing on a health tile
  if (state.map.tiles[self.pos.y][self.pos.x] === "health") {
    return { type: "harvest" };
  }

  // Harvest resources if standing on them
  if (state.map.tiles[self.pos.y][self.pos.x] === "resource") {
    return { type: "harvest" };
  }

  // Attack any enemy in range
  for (const a of state.agents) {
    if (a.agent_id === self.agent_id || !a.alive) continue;
    const dist = Math.abs(a.pos.x - self.pos.x) + Math.abs(a.pos.y - self.pos.y);
    if (dist <= self.range) {
      return { type: "attack", target: a.pos };
    }
  }

  // Wander randomly
  const dirs = ["N", "S", "E", "W"];
  const dir = dirs[Math.floor(Math.random() * dirs.length)];
  return { type: "move", direction: dir };
}
