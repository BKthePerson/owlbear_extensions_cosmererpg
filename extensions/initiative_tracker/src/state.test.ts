import { test } from "node:test";
import assert from "node:assert/strict";
import {
  META_KEY,
  addCombatant,
  allEntries,
  combatantKey,
  emptyTracker,
  next,
  nextAction,
  parseTracker,
  removeCombatant,
  resetFight,
  setSpeed,
  setTurnState,
  stateOf,
  type NewCombatant,
  type Tracker,
  type Update,
} from "./state.ts";

// Apply an Update to a metadata object the way Owlbear would, then re-parse.
function apply(tracker: Tracker, update: Update): Tracker {
  const metadata: Record<string, unknown> = {
    [META_KEY]: { round: tracker.round, band: tracker.band },
  };
  for (const c of tracker.combatants) metadata[combatantKey(c.id)] = c;
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) delete metadata[key];
    else metadata[key] = value;
  }
  return parseTracker(metadata);
}

function build(...inputs: NewCombatant[]): Tracker {
  let t = emptyTracker();
  for (const input of inputs) t = apply(t, addCombatant(t, input));
  return t;
}

const pc = (id: string): NewCombatant => ({ id, name: id, side: "PC", boss: false, ownerId: null, ownerName: null });
const npc = (id: string, boss = false): NewCombatant => ({ id, name: id, side: "NPC", boss, ownerId: null, ownerName: null });

const stateById = (t: Tracker, id: string, speed: "fast" | "slow") => {
  const entry = allEntries(t).find((e) => e.combatant.id === id && e.speed === speed);
  return entry ? stateOf(entry) : undefined;
};

test("Next starts at the first occupied band, then walks the bands in order", () => {
  let t = build(pc("a"), pc("b"), npc("goon"), npc("thug"));
  t = apply(t, setSpeed(t, "b", "slow"));
  t = apply(t, setSpeed(t, "thug", "slow"));
  assert.equal(t.band, null);

  const seen: (number | null)[] = [];
  for (let i = 0; i < 4; i++) {
    t = apply(t, next(t));
    seen.push(t.band);
  }
  assert.deepEqual(seen, [0, 1, 2, 3]);
});

test("empty bands are skipped", () => {
  let t = build(pc("a"), npc("thug"));
  t = apply(t, setSpeed(t, "thug", "slow"));
  t = apply(t, next(t));
  assert.equal(t.band, 0);
  t = apply(t, next(t));
  assert.equal(t.band, 3);
});

test("a boss is in a fast band and a slow band", () => {
  let t = build(npc("boss", true));
  const bands: (number | null)[] = [];
  for (let i = 0; i < 3; i++) {
    t = apply(t, next(t));
    bands.push(t.band);
  }
  assert.deepEqual(bands, [1, 3, 1]);
  assert.equal(t.round, 2);
});

test("after the last band, Next starts a new round and resets Done marks", () => {
  let t = build(pc("a"), npc("goon"));
  t = apply(t, next(t));
  t = apply(t, setTurnState(t, "a", "fast", "done"));
  t = apply(t, next(t));
  t = apply(t, setTurnState(t, "goon", "fast", "done"));
  assert.equal(t.band, 1);

  t = apply(t, next(t));
  assert.equal(t.round, 2);
  assert.equal(t.band, 0);
  assert.equal(stateById(t, "a", "fast"), "waiting");
  assert.equal(stateById(t, "goon", "fast"), "waiting");
});

test("nextAction describes what Next will do", () => {
  let t = build(pc("a"), npc("goon"));
  assert.equal(nextAction(emptyTracker()), null);
  assert.equal(nextAction(t), "start");
  t = apply(t, next(t));
  assert.equal(nextAction(t), "band");
  t = apply(t, next(t));
  assert.equal(nextAction(t), "round");
});

test("the GM can mark a turn Done and undo it", () => {
  let t = build(pc("a"));
  t = apply(t, setTurnState(t, "a", "fast", "done"));
  assert.equal(stateById(t, "a", "fast"), "done");
  t = apply(t, setTurnState(t, "a", "fast", "waiting"));
  assert.equal(stateById(t, "a", "fast"), "waiting");
});

test("a non-boss has no turn in the other speed", () => {
  const t = build(pc("a"));
  assert.deepEqual(setTurnState(t, "a", "slow", "done"), {});
});

test("speed cannot change after the turn is Done, or for bosses", () => {
  let t = build(pc("a"), npc("boss", true));
  t = apply(t, setTurnState(t, "a", "fast", "done"));
  assert.deepEqual(setSpeed(t, "a", "slow"), {});
  assert.deepEqual(setSpeed(t, "boss", "slow"), {});
});

test("switching speed moves the combatant to the other lane as Waiting", () => {
  let t = build(pc("a"));
  t = apply(t, setSpeed(t, "a", "slow"));
  assert.equal(stateById(t, "a", "slow"), "waiting");
  assert.equal(stateById(t, "a", "fast"), undefined);
});

test("remove and reset clear combatants and the band", () => {
  let t = build(pc("a"), pc("b"));
  t = apply(t, removeCombatant("a"));
  assert.deepEqual(t.combatants.map((c) => c.id), ["b"]);
  t = apply(t, next(t));
  t = apply(t, resetFight(t));
  assert.equal(t.round, 1);
  assert.equal(t.band, null);
  assert.equal(t.combatants.length, 0);
});

test("Next on an empty tracker does nothing", () => {
  assert.deepEqual(next(emptyTracker()), {});
});

test("old 'active' states load as waiting, and malformed entries are ignored", () => {
  const t = parseTracker({
    [combatantKey("x")]: { id: "x", name: "x", side: "PC", boss: false, speed: "fast", ownerId: null, order: 1, fast: "active", slow: "waiting" },
    [combatantKey("y")]: { id: 5 },
  });
  assert.equal(t.combatants.length, 1);
  assert.equal(t.combatants[0]?.fast, "waiting");
});

test("owner id and name are kept, and missing ones load as null", () => {
  let t = build({ id: "k", name: "Kelsier", side: "PC", boss: false, ownerId: "p1", ownerName: "Sam" });
  assert.equal(t.combatants[0]?.ownerId, "p1");
  assert.equal(t.combatants[0]?.ownerName, "Sam");
  t = parseTracker({
    [combatantKey("x")]: { id: "x", name: "x", side: "PC", boss: false, speed: "fast", order: 1, fast: "waiting", slow: "waiting" },
  });
  assert.equal(t.combatants[0]?.ownerId, null);
  assert.equal(t.combatants[0]?.ownerName, null);
});
