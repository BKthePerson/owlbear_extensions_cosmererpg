import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addCombatant,
  allEntries,
  combatantKey,
  next,
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
  const metadata: Record<string, unknown> = { "com.brandonklein.cosmere-initiative/meta": { round: tracker.round } };
  for (const c of tracker.combatants) metadata[combatantKey(c.id)] = c;
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) delete metadata[key];
    else metadata[key] = value;
  }
  return parseTracker(metadata);
}

function build(...inputs: NewCombatant[]): Tracker {
  let t: Tracker = { round: 1, combatants: [] };
  for (const input of inputs) t = apply(t, addCombatant(t, input));
  return t;
}

const pc = (id: string, name = id): NewCombatant => ({ id, name, side: "PC", boss: false, ownerId: null });
const npc = (id: string, boss = false): NewCombatant => ({ id, name: id, side: "NPC", boss, ownerId: null });

const activeNames = (t: Tracker): string[] =>
  allEntries(t)
    .filter((e) => stateOf(e) === "active")
    .map((e) => `${e.combatant.id}:${e.speed}`);

test("next walks phases in order: fast PC, fast NPC, slow PC, slow NPC", () => {
  let t = build(pc("a"), pc("b"), npc("goon"), npc("thug"));
  t = apply(t, setSpeed(t, "b", "slow"));
  t = apply(t, setSpeed(t, "thug", "slow"));

  const seen: string[] = [];
  for (let i = 0; i < 4; i++) {
    t = apply(t, next(t));
    seen.push(...activeNames(t));
  }
  assert.deepEqual(seen, ["a:fast", "goon:fast", "b:slow", "thug:slow"]);
});

test("a boss takes a fast turn and a slow turn", () => {
  let t = build(pc("a"), npc("boss", true));
  const seen: string[] = [];
  for (let i = 0; i < 3; i++) {
    t = apply(t, next(t));
    seen.push(...activeNames(t));
  }
  assert.deepEqual(seen, ["a:fast", "boss:fast", "boss:slow"]);
});

test("after the last turn, next starts round 2 with everyone reset", () => {
  let t = build(pc("a"), npc("goon"));
  t = apply(t, next(t));
  t = apply(t, next(t));
  t = apply(t, next(t));
  assert.equal(t.round, 2);
  assert.deepEqual(activeNames(t), ["a:fast"]);
  assert.equal(t.combatants.find((c) => c.id === "goon")?.fast, "waiting");
});

test("only one turn is active at a time; the older one becomes done", () => {
  let t = build(pc("a"), pc("b"));
  t = apply(t, setTurnState(t, "a", "fast", "active"));
  t = apply(t, setTurnState(t, "b", "fast", "active"));
  assert.deepEqual(activeNames(t), ["b:fast"]);
  assert.equal(t.combatants.find((c) => c.id === "a")?.fast, "done");
});

test("speed cannot change after the turn has started, or for bosses", () => {
  let t = build(pc("a"), npc("boss", true));
  t = apply(t, setTurnState(t, "a", "fast", "done"));
  assert.deepEqual(setSpeed(t, "a", "slow"), {});
  assert.deepEqual(setSpeed(t, "boss", "slow"), {});
});

test("switching speed resets the new lane to waiting", () => {
  let t = build(pc("a"));
  t = apply(t, setSpeed(t, "a", "slow"));
  const entry = allEntries(t)[0];
  assert.equal(entry?.speed, "slow");
  assert.equal(entry ? stateOf(entry) : undefined, "waiting");
});

test("remove and reset clear combatants", () => {
  let t = build(pc("a"), pc("b"));
  t = apply(t, removeCombatant("a"));
  assert.deepEqual(t.combatants.map((c) => c.id), ["b"]);
  t = apply(t, next(t));
  t = apply(t, next(t));
  assert.equal(t.round, 2);
  t = apply(t, resetFight(t));
  assert.equal(t.round, 1);
  assert.equal(t.combatants.length, 0);
});

test("next on an empty tracker does nothing", () => {
  assert.deepEqual(next({ round: 1, combatants: [] }), {});
});

test("malformed combatant entries are ignored", () => {
  const t = parseTracker({ "com.brandonklein.cosmere-initiative/c/x": { id: 5 } });
  assert.equal(t.combatants.length, 0);
});
