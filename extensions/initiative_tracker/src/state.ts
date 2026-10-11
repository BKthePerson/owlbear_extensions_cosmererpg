// Tracker rules, kept free of any Owlbear or DOM code so they can be tested alone.
//
// Storage layout in scene metadata:
//   <NS>/meta        -> { round: number, band: number | null }
//   <NS>/c/<id>      -> one Combatant per key
// One key per combatant means two people editing different combatants at the
// same moment do not overwrite each other.
//
// A "band" is one of the four phases of a round (Handbook p.317). Players may
// act in any order inside the current band, so the tracker highlights the band
// and the GM marks individual combatants Done as they go.

export const NS = "com.brandonklein.cosmere-initiative";
export const META_KEY = `${NS}/meta`;
const COMBATANT_PREFIX = `${NS}/c/`;

export type Side = "PC" | "NPC";
export type Speed = "fast" | "slow";
export type TurnState = "waiting" | "done";

export interface Lane {
  speed: Speed;
  side: Side;
}

// Handbook p.317: Fast PC, Fast NPC, Slow PC, Slow NPC. Array index = band number.
export const LANES: readonly Lane[] = [
  { speed: "fast", side: "PC" },
  { speed: "fast", side: "NPC" },
  { speed: "slow", side: "PC" },
  { speed: "slow", side: "NPC" },
];

// Actions per turn (Handbook p.317): a fast turn has 2, a slow turn has 3.
export const ACTIONS: Record<Speed, number> = { fast: 2, slow: 3 };

export interface Combatant {
  id: string;
  name: string;
  side: Side;
  boss: boolean; // bosses take both a fast and a slow turn each round
  speed: Speed; // this round's choice; ignored for bosses
  ownerId: string | null; // Owlbear player id allowed to control this PC
  ownerName: string | null; // player's name when assigned; fallback if they are not in the room
  order: number; // creation order, used as the tiebreak inside a lane
  fast: TurnState;
  slow: TurnState;
}

export interface Tracker {
  round: number;
  band: number | null; // index into LANES, or null before the round has started
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
  ownerName: string | null;
}

export const emptyTracker = (): Tracker => ({ round: 1, band: null, combatants: [] });

export const combatantKey = (id: string): string => `${COMBATANT_PREFIX}${id}`;

const isSide = (v: unknown): v is Side => v === "PC" || v === "NPC";
const isSpeed = (v: unknown): v is Speed => v === "fast" || v === "slow";

// Anything other than "done" counts as waiting, which also tolerates data from
// the earlier version that stored an "active" state.
const toTurnState = (v: unknown): TurnState => (v === "done" ? "done" : "waiting");

function parseCombatant(value: unknown): Combatant | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, name, side, boss, speed, ownerId, ownerName, order, fast, slow } = value as Record<
    string,
    unknown
  >;
  if (
    typeof id !== "string" ||
    typeof name !== "string" ||
    !isSide(side) ||
    typeof boss !== "boolean" ||
    !isSpeed(speed) ||
    typeof order !== "number"
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
    ownerName: typeof ownerName === "string" ? ownerName : null,
    order,
    fast: toTurnState(fast),
    slow: toTurnState(slow),
  };
}

export function parseTracker(metadata: Record<string, unknown>): Tracker {
  const raw = metadata[META_KEY];
  const meta = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const round = typeof meta.round === "number" ? meta.round : 1;
  const band =
    typeof meta.band === "number" && Number.isInteger(meta.band) && meta.band >= 0 && meta.band < LANES.length
      ? meta.band
      : null;

  const combatants: Combatant[] = [];
  for (const [key, value] of Object.entries(metadata)) {
    if (!key.startsWith(COMBATANT_PREFIX)) continue;
    const parsed = parseCombatant(value);
    if (parsed) combatants.push(parsed);
  }
  combatants.sort((a, b) => a.order - b.order);
  return { round, band, combatants };
}

export const stateOf = (entry: Entry): TurnState =>
  entry.speed === "fast" ? entry.combatant.fast : entry.combatant.slow;

const bandOf = (entry: Entry): number =>
  LANES.findIndex((l) => l.side === entry.combatant.side && l.speed === entry.speed);

// Every turn in the round, in band order.
export function allEntries(tracker: Tracker): Entry[] {
  const entries: Entry[] = tracker.combatants.flatMap((combatant) =>
    combatant.boss
      ? [
          { combatant, speed: "fast" as const },
          { combatant, speed: "slow" as const },
        ]
      : [{ combatant, speed: combatant.speed }],
  );
  return entries.sort((a, b) => bandOf(a) - bandOf(b) || a.combatant.order - b.combatant.order);
}

export function entriesInLane(tracker: Tracker, lane: Lane): Entry[] {
  return allEntries(tracker).filter(
    (e) => e.speed === lane.speed && e.combatant.side === lane.side,
  );
}

// Which bands have at least one turn in them.
function occupiedBands(tracker: Tracker): boolean[] {
  const occupied = LANES.map(() => false);
  for (const entry of allEntries(tracker)) occupied[bandOf(entry)] = true;
  return occupied;
}

function toUpdate(changed: Combatant[]): Update {
  const update: Update = {};
  for (const c of changed) update[combatantKey(c.id)] = c;
  return update;
}

const metaUpdate = (round: number, band: number | null): Update => ({
  [META_KEY]: { round, band },
});

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

// New fight: drop everyone and go back to round 1, before the first band.
export function resetFight(tracker: Tracker): Update {
  const update: Update = metaUpdate(1, null);
  for (const c of tracker.combatants) update[combatantKey(c.id)] = undefined;
  return update;
}

// Switch fast/slow. Only allowed before this turn is marked Done, and never for bosses.
export function setSpeed(tracker: Tracker, id: string, speed: Speed): Update {
  const c = tracker.combatants.find((x) => x.id === id);
  if (!c || c.boss || c.speed === speed) return {};
  if (stateOf({ combatant: c, speed: c.speed }) !== "waiting") return {};
  return toUpdate([{ ...c, speed, fast: "waiting", slow: "waiting" }]);
}

// GM marks one turn Done or puts it back to Waiting.
export function setTurnState(
  tracker: Tracker,
  id: string,
  speed: Speed,
  state: TurnState,
): Update {
  const c = tracker.combatants.find((x) => x.id === id);
  if (!c) return {};
  if (!allEntries(tracker).some((e) => e.combatant.id === id && e.speed === speed)) return {};
  return toUpdate([speed === "fast" ? { ...c, fast: state } : { ...c, slow: state }]);
}

// What pressing Next will do, for labelling the button.
export type NextAction = "start" | "band" | "round" | null;

export function nextAction(tracker: Tracker): NextAction {
  const occupied = occupiedBands(tracker);
  if (!occupied.some(Boolean)) return null;
  if (tracker.band === null) return "start";
  return occupied.slice(tracker.band + 1).some(Boolean) ? "band" : "round";
}

// Move to the next band that has anyone in it. After the last band, start a new
// round: everyone goes back to Waiting and the first occupied band is current.
export function next(tracker: Tracker): Update {
  const occupied = occupiedBands(tracker);
  const first = occupied.indexOf(true);
  if (first === -1) return {};

  if (tracker.band === null) return metaUpdate(tracker.round, first);

  const later = occupied.findIndex((isOccupied, i) => isOccupied && i > (tracker.band ?? -1));
  if (later !== -1) return metaUpdate(tracker.round, later);

  const reset = tracker.combatants
    .filter((c) => c.fast !== "waiting" || c.slow !== "waiting")
    .map((c): Combatant => ({ ...c, fast: "waiting", slow: "waiting" }));
  return { ...toUpdate(reset), ...metaUpdate(tracker.round + 1, first) };
}
