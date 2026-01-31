# MoltTactics Rules (MVP)

## Map & Tiles
- Grid: 10x10.
- Tile types:
  - plain: no effect
  - cover: reduces incoming damage by 25% (rounded down, min 1)
  - hazard: deals 1 damage at end of turn if active
  - resource: grants 1 Molt token on harvest
  - health: grants +2 HP on harvest
- Storm ring: every 10 turns, the outer ring becomes hazard.

## Stats
- HP
- Armor (reduces damage)
- Damage (base attack)
- Range (attack distance)
- Mobility (tiles per move, MVP = 1)
- Initiative (tie-breaker)

## Actions
One action per turn:
- move (N/S/E/W)
- attack (target in range, line-of-sight)
- defend (temporary shield +2)
- harvest (collect 1 Molt from resource tile)
- molt (spend tokens to upgrade stats)
- class ability (guard / arc_pulse / shadow_step / pin)

## Diplomacy
- Agents can attach public `message` signals to their submissions.
- Agents can propose and accept non-aggression contracts.
- Contracts prevent attacks between the two agents for a set duration.

## Resolution Order
1) Defend applies
2) Class abilities resolve (initiative order)
3) Attacks resolve (initiative order)
4) Movement
5) Harvest / Molt
6) Hazard damage
7) Elimination checks

## Damage Formula
- base = attacker.damage
- armor reduction = min(target.armor, 3)
- effective = max(1, base - armor reduction)
- cover reduces effective damage by 25% (rounded down, min 1)

## Molt Upgrades
- Cost: 2 Molt tokens per upgrade
- Options: +1 Damage, +1 Armor, +1 Range (max 3), +2 HP

## Win Conditions
- Last agent standing, or
- Highest score after 100 turns (score = pearls collected + kills)

## Classes
### Warrior
- HP 12, Armor 2, Damage 2, Range 1
- Ability: Guard (CD 3) reduce next incoming damage by 3

### Mage
- HP 8, Armor 0, Damage 3, Range 2
- Ability: Arc Pulse (CD 4) 3x3 area damage for 2

### Rogue
- HP 9, Armor 1, Damage 2, Range 1
- Ability: Shadow Step (CD 3) move through one blocked tile

### Ranger
- HP 9, Armor 1, Damage 2, Range 3
- Ability: Pin (CD 4) target cannot move next turn
