// Tracker rules, kept free of any Owlbear or DOM code so they can be tested alone.
//
// Storage layout in scene metadata:
//   <NS>/meta        -> { round: number }
//   <NS>/c/<id>      -> one Combatant per key
// One key per combatant means two people editing different combatants at the
// same moment do not overwrite each other.

export const NS = "com.brandonklein.cosmere-initiative";
export const META_KEY = `${NS}/meta`;
const COMBATANT_PREFIX = `${NS}/c/`;

export type Side = "PC" | "NPC";
export type Speed = "fast" | "slow";
export type TurnState = "waiting" | "active" | "done";

export interface Lane {
  speed: Speed;
  side: Side;
}

// Handbook p.317: Fast PC, Fast NPC, Slow PC, Slow NPC.
export const LANES: readonly Lane[] = [
  { speed: "fast", side: "PC" },
  { speed: "fast", side: "NPC" },
  { speed: "slow", side: "PC" },
  { speed: "slow", side: "NPC" },
];

export interface Combatant {
  id: string;
  name: string;
  side: Side;
  boss: boolean; // bosses take both a fast and a slow turn each round
  speed: Speed; // this round's choice; ignored for bosses
  ownerId: string | null; // Owlbear player id allowed to act for this PC
  order: number; // creation order, used as the tiebreak inside a lane
  fast: TurnState;
  slow: TurnState;
}

export interface Tracker {
  round: number;
  combatants: Combatant[];
}

// One turn a combatant takes this round. Bosses have two, everyone else one.
export interface Entry {
  combatant: Combatant;
  speed: Speed;
}

// A partial metadata write. An undefined value deletes that key.
export type Update = Record<string, unknown>;

export interface NewCombatant {
  id: string;
  name: string;
  side: Side;
  boss: boolean;
  ownerId: string | null;
}

export const combatantKey = (id: string): string => `${COMBATANT_PREFIX}${id}`;

const isSide = (v: unknown): v is Side => v === "PC" || v === "NPC";
const isSpeed = (v: unknown): v is Speed => v === "fast" || v === "slow";
const isTurnState = (v: unknown): v is TurnState =>
  v === "waiting" || v === "active" || v === "done";

function parseCombatant(value: unknown): Combatant | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, name, side, boss, speed, ownerId, order, fast, slow } = value as Record<
    string,
    unknown
  >;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    !isSide(side) ||
    typeof boss !== "boolean" ||
    !isSpeed(speed) ||
    typeof order !== "number" ||
    !isTurnState(fast) ||
    !isTurnState(slow)
  ) {
    return null;
  }
  return {
    id,
    name,
    side,
    boss,
    speed,
    ownerId: typeof ownerId === "string" ? ownerId : null,
    order,
    fast,
    slow,
  };
}

export function parseTracker(metadata: Record<string, unknown>): Tracker {
  const meta = metadata[META_KEY];
  const round =
    typeof meta === "object" &&
    meta !== null &&
    typeof (meta as Record<string, unknown>).round === "number"
      ? ((meta as Record<string, unknown>).round as number)
      : 1;

  const combatants: Combatant[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (!key.startsWith(COMBATANT_PREFIX)) continue;
    const parsed = parseCombatant(value);
    if (parsed) combatants.push(parsed);
  }
  combatants.sort((a, b) => a.order - b.order);
  return { round, combatants };
}

export const stateOf = (entry: Entry): TurnState =>
  entry.speed === "fast" ? entry.combatant.fast : entry.combatant.slow;

const laneIndex = (entry: Entry): number =>
  LANES.findIndex((l) => l.side === entry.combatant.side && l.speed === entry.speed);

// Every turn still to be taken this round, in phase order.
export function allEntries(tracker: Tracker): Entry[] {
  const entries: Entry[] = tracker.combatants.flatMap((combatant) =>
    combatant.boss
      ? [
          { combatant, speed: "fast" as const },
          { combatant, speed: "slow" as const },
        ]
      : [{ combatant, speed: combatant.speed }],
  );
  return entries.sort(
    (a, b) => laneIndex(a) - laneIndex(b) || a.combatant.order - b.combatant.order,
  );
}

export function entriesInLane(tracker: Tracker, lane: Lane): Entry[] {
  return allEntries(tracker).filter(
    (e) => e.speed === lane.speed && e.combatant.side === lane.side,
  );
}

function toUpdate(changed: Combatant[], round?: number): Update {
  const update: Update = {};
  for (const c of changed) update[combatantKey(c.id)] = c;
  if (round !== undefined) update[META_KEY] = { round };
  return update;
}

// A scratch copy of the tracker that records which combatants were touched.
class Draft {
  round: number;
  private working: Map<string, Combatant>;
  private changed = new Set<string>();

  constructor(tracker: Tracker) {
    this.round = tracker.round;
    this.working = new Map(tracker.combatants.map((c) => [c.id, { ...c }]));
  }

  get size(): number {
    return this.working.size;
  }

  view(): Tracker {
    return { round: this.round, combatants: [...this.working.values()] };
  }

  entries(): Entry[] {
    return allEntries(this.view());
  }

  set(id: string, speed: Speed, state: TurnState): void {
    const c = this.working.get(id);
    if (!c) return;
    if (speed === "fast") c.fast = state;
    else c.slow = state;
    this.changed.add(id);
  }

  resetAll(): void {
    for (const c of this.working.values()) {
      c.fast = "waiting";
      c.slow = "waiting";
      this.changed.add(c.id);
    }
  }

  update(): Update {
    const changed = [...this.working.values()].filter((c) => this.changed.has(c.id));
    return toUpdate(changed, this.round);
  }
}

export function addCombatant(tracker: Tracker, input: NewCombatant): Update {
  const order = tracker.combatants.reduce((max, c) => Math.max(max, c.order), 0) + 1;
  const combatant: Combatant = {
    ...input,
    speed: "fast",
    order,
    fast: "waiting",
    slow: "waiting",
  };
  return toUpdate([combatant]);
}

export const removeCombatant = (id: string): Update => ({ [combatantKey(id)]: undefined });

// New fight: drop everyone and go back to round 1.
export function resetFight(tracker: Tracker): Update {
  const update: Update = { [META_KEY]: { round: 1 } };
  for (const c of tracker.combatants) update[combatantKey(c.id)] = undefined;
  return update;
}

// Switch fast/slow. Only allowed before this turn is taken, and never for bosses.
export function setSpeed(tracker: Tracker, id: string, speed: Speed): Update {
  const c = tracker.combatants.find((x) => x.id === id);
  if (!c || c.boss || c.speed === speed) return {};
  if (stateOf({ combatant: c, speed: c.speed }) !== "waiting") return {};
  return toUpdate([{ ...c, speed, fast: "waiting", slow: "waiting" }]);
}

// Set one turn's state directly (GM override, or a player marking their own turn).
// Only one turn can be active at a time, so setting a new active turn marks the
// previous active one Done.
export function setTurnState(
  tracker: Tracker,
  id: string,
  speed: Speed,
  state: TurnState,
): Update {
  const draft = new Draft(tracker);
  const target = draft.entries().find((e) => e.combatant.id === id && e.speed === speed);
  if (!target) return {};
  if (state === "active") {
    for (const e of draft.entries()) {
      if (stateOf(e) === "active" && !(e.combatant.id === id && e.speed === speed)) {
        draft.set(e.combatant.id, e.speed, "done");
      }
    }
  }
  draft.set(id, speed, state);
  return draft.update();
}

// Finish the active turn and start the next waiting one in phase order. When
// nobody is left waiting, start a new round.
export function next(tracker: Tracker): Update {
  const draft = new Draft(tracker);
  if (draft.size === 0) return {};

  for (const e of draft.entries()) {
    if (stateOf(e) === "active") draft.set(e.combatant.id, e.speed, "done");
  }

  let target = draft.entries().find((e) => stateOf(e) === "waiting");
  if (!target) {
    draft.round += 1;
    draft.resetAll();
    target = draft.entries().find((e) => stateOf(e) === "waiting");
  }
  if (target) draft.set(target.combatant.id, target.speed, "active");
  return draft.update();
}
