// Tracker rules, kept free of any Owlbear or DOM code so they can be tested alone.
//
// Storage layout in scene metadata:
//   <NS>/meta        -> { v: 1, round: number, band: number | null }
//   <NS>/c/<id>      -> one flat combatant record per key: the Combatant fields,
//                       with fastDone / slowDone as the round number that turn
//                       was marked Done in (or null), plus any fields this
//                       version does not know, carried through untouched
// One key per combatant means two people editing different combatants at the
// same moment do not overwrite each other. A turn is Done only while its stamp
// equals the current round, so starting a new round is a single meta write and
// never rewrites combatants. Records from the earlier version (fast / slow set
// to "done") read as Waiting and lose those two keys on their next write.
//
// A "band" is one of the four phases of a round (Handbook p.317). Players may
// act in any order inside the current band, so the tracker highlights the band
// and the GM marks individual combatants Done as they go.

export const NS = "com.brandonklein.cosmere-initiative";
export const META_KEY = `${NS}/meta`;
const NS_PREFIX = `${NS}/`;
const COMBATANT_PREFIX = `${NS}/c/`;

export type Side = "PC" | "NPC";
export type Speed = "fast" | "slow";
export type TurnState = "waiting" | "done";
// Down: unconscious or incapacitated, may come back. Dead: out of the fight.
export type Status = "active" | "down" | "dead";

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
  fastDone: number | null; // round in which the fast turn was marked Done
  slowDone: number | null; // round in which the slow turn was marked Done
  status: Status;
  extra: Record<string, unknown>; // stored fields this version does not know, written back as they were
}

export interface Tracker {
  round: number;
  band: number | null; // index into LANES, or null before the round has started
  combatants: Combatant[];
  keys: string[]; // every metadata key in our namespace, so Clear fight can delete junk too
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

export const emptyTracker = (): Tracker => ({ round: 1, band: null, combatants: [], keys: [] });

export const combatantKey = (id: string): string => `${COMBATANT_PREFIX}${id}`;

const isSide = (v: unknown): v is Side => v === "PC" || v === "NPC";
const isSpeed = (v: unknown): v is Speed => v === "fast" || v === "slow";

const toStamp = (v: unknown): number | null => (typeof v === "number" ? v : null);
const toStatus = (v: unknown): Status => (v === "down" || v === "dead" ? v : "active");

// Stored fields we read ourselves. fast and slow are the retired Done flags:
// dropped here so they never end up in extra and get written back.
const KNOWN_FIELDS = new Set([
  "id", "name", "side", "boss", "speed", "ownerId", "ownerName", "order",
  "fastDone", "slowDone", "status", "fast", "slow",
]);

function parseCombatant(value: unknown): Combatant | null {
  if (typeof value !== "object" || value === null) return null;
  const { id, name, side, boss, speed, ownerId, ownerName, order, fastDone, slowDone, status } = value as Record<
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
    fastDone: toStamp(fastDone),
    slowDone: toStamp(slowDone),
    status: toStatus(status),
    extra: Object.fromEntries(Object.entries(value).filter(([key]) => !KNOWN_FIELDS.has(key))),
  };
}

// Plain code-unit order, not localeCompare, so every browser sorts ids the same way.
const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

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
  combatants.sort((a, b) => a.order - b.order || compareIds(a.id, b.id));
  const keys = Object.keys(metadata).filter((key) => key.startsWith(NS_PREFIX));
  return { round, band, combatants, keys };
}

// Done only while the stamp is this round's number; older stamps mean Waiting.
export const stateOf = (entry: Entry, round: number): TurnState =>
  (entry.speed === "fast" ? entry.combatant.fastDone : entry.combatant.slowDone) === round
    ? "done"
    : "waiting";

const bandOf = (entry: Entry): number =>
  LANES.findIndex((l) => l.side === entry.combatant.side && l.speed === entry.speed);

// Every turn in the round, in band order. Dead combatants take no turns.
export function allEntries(tracker: Tracker): Entry[] {
  const entries: Entry[] = tracker.combatants
    .filter((combatant) => combatant.status !== "dead")
    .flatMap((combatant) =>
      combatant.boss
        ? [
            { combatant, speed: "fast" as const },
            { combatant, speed: "slow" as const },
          ]
        : [{ combatant, speed: combatant.speed }],
    );
  return entries.sort(
    (a, b) =>
      bandOf(a) - bandOf(b) ||
      a.combatant.order - b.combatant.order ||
      compareIds(a.combatant.id, b.combatant.id),
  );
}

export const deadCombatants = (tracker: Tracker): Combatant[] =>
  tracker.combatants.filter((c) => c.status === "dead");

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

// The stored form of a combatant: one flat object, unknown fields first so the
// fields we know always win.
export function combatantRecord(c: Combatant): Record<string, unknown> {
  const { extra, ...known } = c;
  return { ...extra, ...known };
}

function toUpdate(changed: Combatant[]): Update {
  const update: Update = {};
  for (const c of changed) update[combatantKey(c.id)] = combatantRecord(c);
  return update;
}

const metaUpdate = (round: number, band: number | null): Update => ({
  [META_KEY]: { v: 1, round, band },
});

export function addCombatant(tracker: Tracker, input: NewCombatant): Update {
  const order = tracker.combatants.reduce((max, c) => Math.max(max, c.order), 0) + 1;
  const combatant: Combatant = {
    ...input,
    speed: "fast",
    order,
    fastDone: null,
    slowDone: null,
    status: "active",
    extra: {},
  };
  return toUpdate([combatant]);
}

export interface PlayerToAdd {
  playerId: string; // Owlbear player id, saved as the owner
  playerName: string; // used as the character name
}

// Quick-add: one PC per player who does not already own a combatant (a Dead PC
// still counts, so nobody is added twice). The player's name is the label. The id
// is derived from the player, so adding the same player twice writes the same key.
export function addPlayerCombatants(tracker: Tracker, players: PlayerToAdd[]): Update {
  const owners = new Set(tracker.combatants.map((c) => c.ownerId));
  let order = tracker.combatants.reduce((max, c) => Math.max(max, c.order), 0);
  const added: Combatant[] = [];
  for (const player of players) {
    if (owners.has(player.playerId)) continue;
    owners.add(player.playerId);
    order += 1;
    added.push({
      id: `pc-${player.playerId}`,
      name: player.playerName || "Player",
      side: "PC",
      boss: false,
      speed: "fast",
      ownerId: player.playerId,
      ownerName: player.playerName || null,
      order,
      fastDone: null,
      slowDone: null,
      status: "active",
      extra: {},
    });
  }
  return toUpdate(added);
}

export const removeCombatant = (id: string): Update => ({ [combatantKey(id)]: undefined });

// New fight: go back to round 1, before the first band, and delete every key in
// our namespace, including malformed ones and ones from a newer version.
export function resetFight(tracker: Tracker): Update {
  const update: Update = metaUpdate(1, null);
  for (const key of tracker.keys) if (key !== META_KEY) update[key] = undefined;
  return update;
}

// Whether a combatant may switch fast/slow: only before this turn is marked Done,
// never for bosses, and never into a band that is already over.
export function canSetSpeed(tracker: Tracker, id: string, speed: Speed): boolean {
  const c = tracker.combatants.find((x) => x.id === id);
  if (!c || c.boss || c.status !== "active" || c.speed === speed) return false;
  if (stateOf({ combatant: c, speed: c.speed }, tracker.round) !== "waiting") return false;
  const target = LANES.findIndex((l) => l.side === c.side && l.speed === speed);
  return tracker.band === null || target >= tracker.band;
}

export function setSpeed(tracker: Tracker, id: string, speed: Speed): Update {
  const c = tracker.combatants.find((x) => x.id === id);
  if (!c || !canSetSpeed(tracker, id, speed)) return {};
  return toUpdate([{ ...c, speed, fastDone: null, slowDone: null }]);
}

// GM marks one turn Done or puts it back to Waiting.
export function setTurnState(
  tracker: Tracker,
  id: string,
  speed: Speed,
  state: TurnState,
): Update {
  const c = tracker.combatants.find((x) => x.id === id);
  if (!c || c.status !== "active") return {};
  if (!allEntries(tracker).some((e) => e.combatant.id === id && e.speed === speed)) return {};
  const stamp = state === "done" ? tracker.round : null;
  return toUpdate([speed === "fast" ? { ...c, fastDone: stamp } : { ...c, slowDone: stamp }]);
}

// GM sets a combatant Active, Down or Dead. Done stamps and fast/slow are kept.
export function setStatus(tracker: Tracker, id: string, status: Status): Update {
  const c = tracker.combatants.find((x) => x.id === id);
  if (!c || c.status === status) return {};
  return toUpdate([{ ...c, status }]);
}

// Back goes to the previous occupied band. It never touches Done stamps and never
// crosses into the previous round.
export function canGoBack(tracker: Tracker): boolean {
  if (tracker.band === null) return false;
  return occupiedBands(tracker).slice(0, tracker.band).some(Boolean);
}

export function previous(tracker: Tracker): Update {
  if (tracker.band === null) return {};
  const occupied = occupiedBands(tracker);
  for (let i = tracker.band - 1; i >= 0; i--) {
    if (occupied[i]) return metaUpdate(tracker.round, i);
  }
  return {};
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
// round: only the meta is written, and every Done stamp from the old round stops
// counting, so everyone is Waiting again and the first occupied band is current.
export function next(tracker: Tracker): Update {
  const occupied = occupiedBands(tracker);
  const first = occupied.indexOf(true);
  if (first === -1) return {};

  if (tracker.band === null) return metaUpdate(tracker.round, first);

  const later = occupied.findIndex((isOccupied, i) => isOccupied && i > (tracker.band ?? -1));
  if (later !== -1) return metaUpdate(tracker.round, later);

  return metaUpdate(tracker.round + 1, first);
}
