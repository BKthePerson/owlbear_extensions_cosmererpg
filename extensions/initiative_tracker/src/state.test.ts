import { test } from "node:test";
import assert from "node:assert/strict";
import {
  META_KEY,
  NS,
  addCombatant,
  addPlayerCombatants,
  allEntries,
  combatantKey,
  emptyTracker,
  canGoBack,
  canSetSpeed,
  combatantRecord,
  deadCombatants,
  next,
  nextAction,
  parseTracker,
  removeCombatant,
  previous,
  resetFight,
  setSpeed,
  setStatus,
  setTurnState,
  stateOf,
  type NewCombatant,
  type Tracker,
  type Update,
} from "./state.ts";

type Metadata = Record<string, unknown>;

// Apply an Update to raw metadata the way Owlbear would: top-level keys are
// replaced whole, and an undefined value deletes the key.
function applyRaw(metadata: Metadata, update: Update): Metadata {
  const result = { ...metadata };
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) delete result[key];
    else result[key] = value;
  }
  return result;
}

// The metadata a tracker would be stored as.
function toMetadata(tracker: Tracker): Metadata {
  const metadata: Metadata = { [META_KEY]: { v: 1, round: tracker.round, band: tracker.band } };
  for (const c of tracker.combatants) metadata[combatantKey(c.id)] = combatantRecord(c);
  return metadata;
}

// Store the tracker, apply the Update to the stored form, then re-parse.
function apply(tracker: Tracker, update: Update): Tracker {
  return parseTracker(applyRaw(toMetadata(tracker), update));
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
  return entry ? stateOf(entry, t.round) : undefined;
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
  assert.equal(stateById(t, "x", "fast"), "waiting");
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

test("status defaults to active and can be set", () => {
  let t = build(pc("a"));
  assert.equal(t.combatants[0]?.status, "active");
  t = apply(t, setStatus(t, "a", "down"));
  assert.equal(t.combatants[0]?.status, "down");
  assert.deepEqual(setStatus(t, "a", "down"), {});
});

test("a Down combatant stays in its band but cannot be marked Done or change speed", () => {
  let t = build(pc("a"));
  t = apply(t, setStatus(t, "a", "down"));
  assert.equal(allEntries(t).length, 1);
  assert.deepEqual(setTurnState(t, "a", "fast", "done"), {});
  assert.deepEqual(setSpeed(t, "a", "slow"), {});
  t = apply(t, setStatus(t, "a", "active"));
  assert.notDeepEqual(setTurnState(t, "a", "fast", "done"), {});
});

test("a Dead combatant leaves the bands and shows in the out-of-fight list", () => {
  let t = build(pc("a"), npc("boss", true));
  t = apply(t, setStatus(t, "boss", "dead"));
  assert.equal(allEntries(t).length, 1);
  assert.deepEqual(deadCombatants(t).map((c) => c.id), ["boss"]);
});

test("Next skips a band that holds only dead combatants", () => {
  let t = build(pc("a"), npc("goon"), npc("thug"));
  t = apply(t, setSpeed(t, "thug", "slow"));
  t = apply(t, setStatus(t, "goon", "dead"));
  t = apply(t, next(t));
  assert.equal(t.band, 0);
  t = apply(t, next(t));
  assert.equal(t.band, 3);
});

test("a new round keeps Down and Dead", () => {
  let t = build(pc("a"), pc("b"));
  t = apply(t, setStatus(t, "a", "down"));
  t = apply(t, setStatus(t, "b", "dead"));
  t = apply(t, next(t));
  t = apply(t, next(t));
  assert.equal(t.round, 2);
  assert.equal(t.combatants.find((c) => c.id === "a")?.status, "down");
  assert.equal(t.combatants.find((c) => c.id === "b")?.status, "dead");
});

test("Back goes to the previous occupied band without touching Done marks", () => {
  let t = build(pc("a"), npc("goon"), npc("thug"));
  t = apply(t, setSpeed(t, "thug", "slow"));
  t = apply(t, next(t));
  t = apply(t, setTurnState(t, "a", "fast", "done"));
  t = apply(t, next(t));
  t = apply(t, next(t));
  assert.equal(t.band, 3);

  t = apply(t, previous(t));
  assert.equal(t.band, 1);
  assert.equal(t.round, 1);
  assert.equal(stateById(t, "a", "fast"), "done");
});

test("Back does nothing before the round starts or at the first occupied band", () => {
  let t = build(pc("a"), npc("goon"));
  assert.equal(canGoBack(t), false);
  assert.deepEqual(previous(t), {});
  t = apply(t, next(t));
  assert.equal(t.band, 0);
  assert.equal(canGoBack(t), false);
  assert.deepEqual(previous(t), {});
  t = apply(t, next(t));
  assert.equal(canGoBack(t), true);
});

test("quick-add makes one PC per player, owned by that player, named after them", () => {
  const t = build();
  const update = addPlayerCombatants(t, [
    { combatantId: "c1", playerId: "p1", playerName: "Sam" },
    { combatantId: "c2", playerId: "p2", playerName: "Alex" },
  ]);
  const next = apply(t, update);
  assert.deepEqual(next.combatants.map((c) => [c.name, c.ownerId, c.side, c.order]), [
    ["Sam", "p1", "PC", 1],
    ["Alex", "p2", "PC", 2],
  ]);
  assert.equal(next.combatants[0]?.ownerName, "Sam");
});

test("quick-add skips players who already own a combatant, including a dead one", () => {
  let t = build({ id: "k", name: "Kelsier", side: "PC", boss: false, ownerId: "p1", ownerName: "Sam" });
  t = apply(t, setStatus(t, "k", "dead"));
  const update = addPlayerCombatants(t, [
    { combatantId: "c1", playerId: "p1", playerName: "Sam" },
    { combatantId: "c2", playerId: "p2", playerName: "Alex" },
  ]);
  const next = apply(t, update);
  assert.deepEqual(next.combatants.map((c) => c.id).sort(), ["c2", "k"]);
});

test("quick-add with nobody to add does nothing", () => {
  assert.deepEqual(addPlayerCombatants(build(), []), {});
});

const legacyRecord = {
  id: "x", name: "x", side: "PC", boss: false, speed: "fast", ownerId: null, ownerName: null, order: 1, status: "active",
};

test("a player marking Done and the GM starting a new round, in either order, leave the new round Waiting", () => {
  let t = build(pc("a"), npc("goon"));
  t = apply(t, next(t));
  t = apply(t, next(t));
  assert.equal(t.band, 1);

  const gmNext = next(t);
  const playerDone = setTurnState(t, "goon", "fast", "done");
  for (const order of [[gmNext, playerDone], [playerDone, gmNext]]) {
    let result = t;
    for (const update of order) result = apply(result, update);
    assert.equal(result.round, 2);
    assert.equal(stateById(result, "goon", "fast"), "waiting");
  }
});

test("Next at the end of a round writes only the meta, with the format version", () => {
  let t = build(pc("a"));
  t = apply(t, next(t));
  t = apply(t, setTurnState(t, "a", "fast", "done"));
  const update = next(t);
  assert.deepEqual(Object.keys(update), [META_KEY]);
  assert.deepEqual(update[META_KEY], { v: 1, round: 2, band: 0 });
});

test("unknown stored fields survive writes, flat, in the stored record", () => {
  const raw: Metadata = {
    [combatantKey("a")]: { ...legacyRecord, id: "a", name: "a", tokenIds: ["t1"] },
  };
  const t = parseTracker(raw);
  assert.deepEqual(t.combatants[0]?.extra, { tokenIds: ["t1"] });
  const updates = [
    setTurnState(t, "a", "fast", "done"),
    setSpeed(t, "a", "slow"),
    setStatus(t, "a", "down"),
  ];
  for (const update of updates) {
    const stored = applyRaw(raw, update)[combatantKey("a")] as Record<string, unknown>;
    assert.deepEqual(stored.tokenIds, ["t1"]);
    assert.equal("extra" in stored, false);
  }
});

test("a legacy fast/slow record reads as Waiting and loses those keys on the next write", () => {
  const raw: Metadata = { [combatantKey("x")]: { ...legacyRecord, fast: "done", slow: "done", tokenIds: ["t1"] } };
  const t = parseTracker(raw);
  assert.equal(stateById(t, "x", "fast"), "waiting");
  assert.deepEqual(t.combatants[0]?.extra, { tokenIds: ["t1"] });
  const stored = applyRaw(raw, setStatus(t, "x", "down"))[combatantKey("x")] as Record<string, unknown>;
  assert.equal("fast" in stored, false);
  assert.equal("slow" in stored, false);
  assert.deepEqual(stored.tokenIds, ["t1"]);
});

test("Clear fight deletes malformed and unrecognised keys in the namespace only", () => {
  const raw: Metadata = {
    [META_KEY]: { v: 1, round: 3, band: 2 },
    [combatantKey("x")]: legacyRecord,
    [combatantKey("bad")]: { id: 5 },
    [`${NS}/future`]: { anything: true },
    [`${NS}-other/c/y`]: { keep: true },
    "other/key": 1,
  };
  const result = applyRaw(raw, resetFight(parseTracker(raw)));
  assert.deepEqual(result[META_KEY], { v: 1, round: 1, band: null });
  assert.deepEqual(Object.keys(result).sort(), [META_KEY, `${NS}-other/c/y`, "other/key"].sort());
});

test("a switch into a band that is already over is blocked", () => {
  let t = build(pc("fastpc"), pc("slowpc"), npc("goon"));
  t = apply(t, setSpeed(t, "slowpc", "slow"));
  t = apply(t, next(t));
  t = apply(t, next(t));
  t = apply(t, next(t));
  assert.equal(t.band, 2);

  assert.equal(canSetSpeed(t, "slowpc", "fast"), false);
  assert.deepEqual(setSpeed(t, "slowpc", "fast"), {});
  // Switching to the lane that is still ahead, or the current band, is fine.
  assert.equal(canSetSpeed(t, "fastpc", "slow"), true);
  assert.equal(canSetSpeed(t, "goon", "slow"), true);
});

test("a fast PC can still switch to slow during the Fast PC band", () => {
  let t = build(pc("a"));
  t = apply(t, next(t));
  assert.equal(t.band, 0);
  assert.equal(canSetSpeed(t, "a", "slow"), true);
  t = apply(t, setSpeed(t, "a", "slow"));
  assert.equal(t.combatants[0]?.speed, "slow");
});

test("before the round starts a combatant can switch both ways", () => {
  let t = build(pc("a"));
  assert.equal(t.band, null);
  t = apply(t, setSpeed(t, "a", "slow"));
  assert.equal(t.combatants[0]?.speed, "slow");
  t = apply(t, setSpeed(t, "a", "fast"));
  assert.equal(t.combatants[0]?.speed, "fast");
});
