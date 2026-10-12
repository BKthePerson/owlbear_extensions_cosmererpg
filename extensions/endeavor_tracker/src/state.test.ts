import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LOG_KEY,
  LOG_LIMIT,
  META_KEY,
  NS,
  activeEndeavors,
  applyUpdate,
  archivedEndeavors,
  blankEndeavor,
  createEndeavor,
  defaultTracks,
  deleteEndeavor,
  describe,
  emptyBoard,
  endeavorKey,
  parseBoard,
  pinnedId,
  playerView,
  resolution,
  saveEndeavor,
  setArchived,
  setPinned,
  setShared,
  setTrackShared,
  tick,
  toggleObjective,
  undo,
  type Endeavor,
  type Metadata,
  type Stamp,
  type Update,
} from "./state.ts";

let counter = 0;
const newId = (): string => `id${++counter}`;
const stamp = (): Stamp => ({ id: newId(), at: 1000 + counter, by: "GM" });

// A room: raw metadata plus the board parsed from it, the way the popover holds it.
class Room {
  metadata: Metadata = {};
  get board() {
    return parseBoard(this.metadata);
  }
  apply(update: Update): void {
    // Round-trip through JSON, as Owlbear does, so undefined fields are dropped.
    const stored: Update = {};
    for (const [key, value] of Object.entries(update)) {
      stored[key] = value === undefined ? undefined : JSON.parse(JSON.stringify(value));
    }
    this.metadata = applyUpdate(this.metadata, stored);
  }
  add(name: string, change: Partial<Endeavor> = {}): Endeavor {
    const e = { ...blankEndeavor(newId(), newId), name, ...change };
    this.apply(createEndeavor(this.board, e));
    return this.get(e.id);
  }
  get(id: string): Endeavor {
    const e = this.board.endeavors.find((x) => x.id === id);
    assert.ok(e, `endeavor ${id} exists`);
    return e;
  }
}

const track = (e: Endeavor, kind: string) => {
  const t = e.tracks.find((x) => x.kind === kind);
  assert.ok(t, `${kind} track exists`);
  return t;
};

test("an empty room parses to an empty board", () => {
  assert.deepEqual(parseBoard({}), emptyBoard());
});

test("type presets pick the starting tracks", () => {
  assert.deepEqual(defaultTracks("mission", 8, newId).map((t) => [t.kind, t.max]), [
    ["success", 8],
    ["failure", 4],
    ["clock", 6],
  ]);
  assert.deepEqual(defaultTracks("pursuit", 4, newId).map((t) => t.kind), ["success", "failure"]);
  assert.deepEqual(defaultTracks("legacy", 11, newId).map((t) => [t.kind, t.label, t.max]), [
    ["success", "Events", 11],
  ]);
});

test("the first endeavor is pinned and later ones keep creation order", () => {
  const room = new Room();
  const a = room.add("Heist");
  const b = room.add("Chase");
  assert.equal(pinnedId(room.board), a.id);
  assert.deepEqual(activeEndeavors(room.board).map((e) => e.name), ["Heist", "Chase"]);
  room.apply(setPinned(room.board, b.id));
  assert.deepEqual(activeEndeavors(room.board).map((e) => e.name), ["Chase", "Heist"]);
});

test("ticks clamp to the track and log what was actually applied", () => {
  const room = new Room();
  const e = room.add("Heist");
  const success = track(e, "success");
  room.apply(tick(room.board, e.id, success.id, 2, stamp()));
  assert.equal(track(room.get(e.id), "success").value, 2);
  for (let i = 0; i < 3; i++) room.apply(tick(room.board, e.id, success.id, 2, stamp()));
  room.apply(tick(room.board, e.id, success.id, 1, stamp()));
  assert.equal(track(room.get(e.id), "success").value, 8);
  assert.deepEqual(tick(room.board, e.id, success.id, 1, stamp()), {});
  assert.deepEqual(tick(room.board, e.id, track(e, "failure").id, -1, stamp()), {});

  // 7 of 8, then +2 only moves by 1.
  room.apply(tick(room.board, e.id, success.id, -1, stamp()));
  room.apply(tick(room.board, e.id, success.id, 2, stamp()));
  assert.equal(room.board.log.at(-1)?.delta, 1);
});

test("an endeavor resolves when a track fills", () => {
  const room = new Room();
  const e = room.add("Heist");
  assert.equal(resolution(e), null);
  room.apply(tick(room.board, e.id, track(e, "success").id, 8, stamp()));
  assert.equal(resolution(room.get(e.id)), "success");
  room.apply(tick(room.board, e.id, track(e, "clock").id, 6, stamp()));
  assert.equal(resolution(room.get(e.id)), "failure");
});

test("every success track must fill for a success", () => {
  const room = new Room();
  const tracks = [...defaultTracks("custom", 2, newId), ...defaultTracks("custom", 2, newId)];
  const e = room.add("Mist-Crossed Lovers", { tracks });
  room.apply(tick(room.board, e.id, tracks[0]!.id, 2, stamp()));
  assert.equal(resolution(room.get(e.id)), null);
  room.apply(tick(room.board, e.id, tracks[1]!.id, 2, stamp()));
  assert.equal(resolution(room.get(e.id)), "success");
});

test("undo reverses a tick and drops it from the log", () => {
  const room = new Room();
  const e = room.add("Heist");
  const failure = track(e, "failure");
  room.apply(tick(room.board, e.id, failure.id, 1, stamp()));
  room.apply(tick(room.board, e.id, failure.id, 1, stamp()));
  const first = room.board.log[0]!;
  room.apply(undo(room.board, first.id));
  assert.equal(track(room.get(e.id), "failure").value, 1);
  assert.equal(room.board.log.length, 1);
  assert.deepEqual(undo(room.board, first.id), {});
});

test("checklist toggles are logged and undoable", () => {
  const room = new Room();
  const objectives = [{ id: "o1", text: "Steal the atium", done: false, secondary: false, extra: {} }];
  const e = room.add("Heist", { objectives });
  room.apply(toggleObjective(room.board, e.id, "o1", stamp()));
  assert.equal(room.get(e.id).objectives[0]?.done, true);
  assert.equal(describe(room.board, room.board.log[0]!), "Heist: checked “Steal the atium”");
  room.apply(undo(room.board, room.board.log[0]!.id));
  assert.equal(room.get(e.id).objectives[0]?.done, false);
});

test("the log keeps only the most recent entries", () => {
  const room = new Room();
  const e = room.add("Heist", { tracks: defaultTracks("custom", 30, newId) });
  for (let i = 0; i < LOG_LIMIT + 5; i++) room.apply(tick(room.board, e.id, e.tracks[0]!.id, 1, stamp()));
  assert.equal(room.board.log.length, LOG_LIMIT);
  assert.equal(describe(room.board, room.board.log[0]!), "Heist: Successes +1");
});

test("undo of a deleted track only drops the log entry", () => {
  const room = new Room();
  const e = room.add("Heist");
  room.apply(tick(room.board, e.id, track(e, "failure").id, 1, stamp()));
  room.apply(saveEndeavor({ ...room.get(e.id), tracks: [track(e, "success")] }));
  assert.equal(describe(room.board, room.board.log[0]!), "Heist: removed track +1");
  room.apply(undo(room.board, room.board.log[0]!.id));
  assert.equal(room.board.log.length, 0);
  assert.equal(room.get(e.id).tracks.length, 1);
});

test("players see only shared endeavors and tracks, and never notes", () => {
  const room = new Room();
  const e = room.add("Heist", { notes: "The butler did it" });
  const secret = room.add("Betrayal");
  room.apply(setShared(room.board, secret.id, false));
  room.apply(setTrackShared(room.board, e.id, track(e, "failure").id, false));

  const view = playerView(room.board);
  assert.deepEqual(view.map((x) => x.name), ["Heist"]);
  assert.deepEqual(view[0]?.tracks.map((t) => t.kind), ["success", "clock"]);
  assert.equal(view[0]?.notes, "");

  // A hidden track filling does not resolve the endeavor in the player's view.
  room.apply(tick(room.board, e.id, track(e, "failure").id, 4, stamp()));
  assert.equal(resolution(room.get(e.id)), "failure");
  assert.equal(resolution(playerView(room.board)[0]!), null);
});

test("archiving unpins and hides from play, restoring brings it back", () => {
  const room = new Room();
  const a = room.add("Heist");
  room.add("Chase");
  room.apply(setArchived(room.board, a.id, true));
  assert.equal(pinnedId(room.board), null);
  assert.deepEqual(activeEndeavors(room.board).map((e) => e.name), ["Chase"]);
  assert.deepEqual(archivedEndeavors(room.board).map((e) => e.name), ["Heist"]);
  assert.deepEqual(playerView(room.board).map((e) => e.name), ["Chase"]);
  room.apply(setArchived(room.board, a.id, false));
  assert.deepEqual(activeEndeavors(room.board).map((e) => e.name), ["Heist", "Chase"]);
});

test("deleting removes the endeavor, its pin and its log entries", () => {
  const room = new Room();
  const a = room.add("Heist");
  const b = room.add("Chase");
  room.apply(tick(room.board, a.id, track(a, "success").id, 1, stamp()));
  room.apply(tick(room.board, b.id, track(b, "success").id, 1, stamp()));
  room.apply(deleteEndeavor(room.board, a.id));
  assert.equal(endeavorKey(a.id) in room.metadata, false);
  assert.equal(pinnedId(room.board), null);
  assert.deepEqual(room.board.log.map((x) => x.endeavorId), [b.id]);
});

test("malformed records are skipped and other extensions' keys are ignored", () => {
  const board = parseBoard({
    [META_KEY]: "nope",
    [LOG_KEY]: [{ id: "x" }, 7],
    [`${NS}/e/bad`]: { id: "bad" },
    [`${NS}/e/ok`]: { id: "ok", name: "Ok", tracks: [{ id: "t", kind: "success", value: 99, max: 3 }, { kind: "?" }] },
    "com.example/other": { big: "x".repeat(500) },
  });
  assert.deepEqual(board.endeavors.map((e) => e.id), ["ok"]);
  assert.deepEqual(board.log, []);
  assert.equal(board.pinned, null);
  const [t] = board.endeavors[0]!.tracks;
  assert.deepEqual([t?.value, t?.max, t?.shared, t?.label], [3, 3, true, "Successes"]);
  assert.ok(board.bytes > 0 && board.bytes < 300);
});

test("fields from a newer version survive a write", () => {
  const room = new Room();
  room.metadata = {
    [`${NS}/e/a`]: {
      id: "a",
      name: "Heist",
      tokens: ["x"],
      tracks: [{ id: "t", kind: "success", value: 0, max: 4, tokenIds: ["p1"] }],
      objectives: [{ id: "o", text: "Get in", weight: 2 }],
    },
  };
  room.apply(tick(room.board, "a", "t", 1, stamp()));
  const stored = room.metadata[`${NS}/e/a`] as Record<string, any>;
  assert.deepEqual(stored.tokens, ["x"]);
  assert.deepEqual(stored.tracks[0].tokenIds, ["p1"]);
  assert.equal(stored.tracks[0].value, 1);
  assert.equal(stored.objectives[0].weight, 2);
  assert.equal("extra" in stored, false);
});
