// Endeavor rules and storage, kept free of any Owlbear or DOM code so they can be tested alone.
//
// Storage layout in room metadata (endeavors span scenes, so not scene metadata):
//   <NS>/meta        -> { v: 1, pinned: string | null }   the pinned active endeavor
//   <NS>/e/<id>      -> one endeavor record per key, tracks and checklist inline,
//                       plus any fields this version does not know, carried
//                       through untouched
//   <NS>/log         -> the last LOG_LIMIT ticks, oldest first, so the GM can undo
//
// Room metadata is capped at 16 kB and that budget is shared by every extension
// in the room, so records stay small: text fields have length limits in the
// interface and the log is short.
//
// Every endeavor reduces to segmented counters (Handbook ch. 12). A track is
// that counter. The endeavor type only picks which tracks a new endeavor starts
// with; nothing else depends on it.

export const NS = "com.brandonklein.cosmere-endeavors";
export const META_KEY = `${NS}/meta`;
export const LOG_KEY = `${NS}/log`;
const NS_PREFIX = `${NS}/`;
const ENDEAVOR_PREFIX = `${NS}/e/`;

export const ROOM_LIMIT_BYTES = 16_000;
export const LOG_LIMIT = 12;
export const MAX_TRACK = 30;

// success: filled toward a threshold. failure: an optional limit. clock: the
// Mission Ticking Clock, advanced each round and bumped by Complications.
export type TrackKind = "success" | "failure" | "clock";
export type EndeavorType = "discovery" | "exploration" | "mission" | "pursuit" | "legacy" | "custom";
export type Resolution = "success" | "failure";

export interface Track {
  id: string;
  kind: TrackKind;
  label: string;
  value: number;
  max: number;
  shared: boolean; // whether players see this track
  extra: Record<string, unknown>; // stored fields this version does not know, written back as they were
}

export interface Objective {
  id: string;
  text: string;
  done: boolean;
  secondary: boolean;
  extra: Record<string, unknown>;
}

export interface Endeavor {
  id: string;
  name: string;
  type: EndeavorType;
  objective: string;
  notes: string; // GM notes, never shown to players
  shared: boolean; // whether players see this endeavor at all
  archived: boolean;
  order: number; // creation order
  tracks: Track[];
  objectives: Objective[];
  extra: Record<string, unknown>;
}

// One tick of a track (delta is what was actually applied after clamping) or one
// checklist toggle (delta +1 checked, -1 unchecked).
export interface LogEntry {
  id: string;
  at: number; // epoch milliseconds
  by: string; // player name
  endeavorId: string;
  kind: "track" | "objective";
  target: string; // track id or objective id
  delta: number;
}

// Who made a change and when. The caller supplies it so this file stays pure.
export type Stamp = Pick<LogEntry, "id" | "at" | "by">;

export interface Board {
  pinned: string | null;
  endeavors: Endeavor[];
  log: LogEntry[];
  bytes: number; // approximate size of everything we store
}

// A partial metadata write. An undefined value deletes that key.
export type Update = Record<string, unknown>;
export type Metadata = Record<string, unknown>;

// The collective threshold table (Handbook ch. 12).
export const DIFFICULTIES = [
  { id: "simple", label: "Simple", successes: 4 },
  { id: "average", label: "Average", successes: 8 },
  { id: "intricate", label: "Intricate", successes: 9 },
  { id: "insurmountable", label: "Insurmountable", successes: 11 },
] as const;

// Starting limits for a new failure track and a new clock. The GM can edit both.
export const DEFAULT_FAILURES = 4;
export const DEFAULT_CLOCK = 6;

// What a new endeavor of each type starts with.
export const TYPES: Record<EndeavorType, { label: string; success: string; failure: boolean; clock: boolean }> = {
  discovery: { label: "Discovery", success: "Successes", failure: true, clock: false },
  exploration: { label: "Exploration", success: "Successes", failure: true, clock: false },
  mission: { label: "Mission", success: "Successes", failure: true, clock: true },
  pursuit: { label: "Pursuit", success: "Successes", failure: true, clock: false },
  legacy: { label: "Legacy", success: "Events", failure: false, clock: false },
  custom: { label: "Custom", success: "Successes", failure: false, clock: false },
};

export const TRACK_LABEL: Record<TrackKind, string> = {
  success: "Successes",
  failure: "Failures",
  clock: "Ticking clock",
};

export const emptyBoard = (): Board => ({ pinned: null, endeavors: [], log: [], bytes: 0 });

export const endeavorKey = (id: string): string => `${ENDEAVOR_PREFIX}${id}`;

const clamp = (n: number, min: number, max: number): number => Math.min(max, Math.max(min, n));

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isKind = (v: unknown): v is TrackKind => v === "success" || v === "failure" || v === "clock";
const isType = (v: unknown): v is EndeavorType => typeof v === "string" && Object.hasOwn(TYPES, v);
const toText = (v: unknown): string => (typeof v === "string" ? v : "");
const toCount = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : fallback;

const unknownFields = (value: Record<string, unknown>, known: readonly string[]): Record<string, unknown> =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !known.includes(key)));

const TRACK_FIELDS = ["id", "kind", "label", "value", "max", "shared"];
const OBJECTIVE_FIELDS = ["id", "text", "done", "secondary"];
const ENDEAVOR_FIELDS = [
  "id", "name", "type", "objective", "notes", "shared", "archived", "order", "tracks", "objectives",
];

function parseTrack(value: unknown): Track | null {
  if (!isRecord(value) || typeof value.id !== "string" || !isKind(value.kind)) return null;
  const max = clamp(toCount(value.max, 1), 1, MAX_TRACK);
  return {
    id: value.id,
    kind: value.kind,
    label: toText(value.label) || TRACK_LABEL[value.kind],
    value: clamp(toCount(value.value, 0), 0, max),
    max,
    shared: value.shared !== false,
    extra: unknownFields(value, TRACK_FIELDS),
  };
}

function parseObjective(value: unknown): Objective | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.text !== "string") return null;
  return {
    id: value.id,
    text: value.text,
    done: value.done === true,
    secondary: value.secondary === true,
    extra: unknownFields(value, OBJECTIVE_FIELDS),
  };
}

function parseList<T>(value: unknown, parse: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(parse).filter((item): item is T => item !== null);
}

function parseEndeavor(value: unknown): Endeavor | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  return {
    id: value.id,
    name: value.name,
    type: isType(value.type) ? value.type : "custom",
    objective: toText(value.objective),
    notes: toText(value.notes),
    shared: value.shared !== false,
    archived: value.archived === true,
    order: typeof value.order === "number" ? value.order : 0,
    tracks: parseList(value.tracks, parseTrack),
    objectives: parseList(value.objectives, parseObjective),
    extra: unknownFields(value, ENDEAVOR_FIELDS),
  };
}

function parseLogEntry(value: unknown): LogEntry | null {
  if (!isRecord(value)) return null;
  const { id, at, by, endeavorId, kind, target, delta } = value;
  if (
    typeof id !== "string" ||
    typeof at !== "number" ||
    typeof endeavorId !== "string" ||
    (kind !== "track" && kind !== "objective") ||
    typeof target !== "string" ||
    typeof delta !== "number"
  ) {
    return null;
  }
  return { id, at, by: toText(by), endeavorId, kind, target, delta };
}

// Plain code-unit order, not localeCompare, so every browser sorts ids the same way.
const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function parseBoard(metadata: Metadata): Board {
  const meta = isRecord(metadata[META_KEY]) ? metadata[META_KEY] : {};
  const endeavors: Endeavor[] = [];
  let bytes = 0;
  const encoder = new TextEncoder();
  for (const [key, value] of Object.entries(metadata)) {
    if (!key.startsWith(NS_PREFIX)) continue;
    bytes += encoder.encode(key + JSON.stringify(value)).length;
    if (!key.startsWith(ENDEAVOR_PREFIX)) continue;
    const parsed = parseEndeavor(value);
    if (parsed) endeavors.push(parsed);
  }
  endeavors.sort((a, b) => a.order - b.order || compareIds(a.id, b.id));
  return {
    pinned: typeof meta.pinned === "string" ? meta.pinned : null,
    endeavors,
    log: parseList(metadata[LOG_KEY], parseLogEntry),
    bytes,
  };
}

// Apply an Update the way Owlbear does: top-level keys are replaced whole, and
// an undefined value deletes the key.
export function applyUpdate(metadata: Metadata, update: Update): Metadata {
  const result = { ...metadata };
  for (const [key, value] of Object.entries(update)) {
    if (value === undefined) delete result[key];
    else result[key] = value;
  }
  return result;
}

// The stored form: one flat object, unknown fields first so the fields we know always win.
function flat<T extends { extra: Record<string, unknown> }>(item: T): Record<string, unknown> {
  const { extra, ...known } = item;
  return { ...extra, ...known };
}

export const endeavorRecord = (e: Endeavor): Record<string, unknown> => ({
  ...flat(e),
  tracks: e.tracks.map(flat),
  objectives: e.objectives.map(flat),
});

const metaUpdate = (pinned: string | null): Update => ({ [META_KEY]: { v: 1, pinned } });

const find = (board: Board, id: string): Endeavor | undefined => board.endeavors.find((e) => e.id === id);

// The pinned endeavor's id, or null if the stored one is gone or archived.
export function pinnedId(board: Board): string | null {
  const pinned = board.pinned === null ? undefined : find(board, board.pinned);
  return pinned && !pinned.archived ? pinned.id : null;
}

// Endeavors in play, the pinned one first.
export function activeEndeavors(board: Board): Endeavor[] {
  const pinned = pinnedId(board);
  const active = board.endeavors.filter((e) => !e.archived);
  return [...active.filter((e) => e.id === pinned), ...active.filter((e) => e.id !== pinned)];
}

export const archivedEndeavors = (board: Board): Endeavor[] => board.endeavors.filter((e) => e.archived);

// What a player is shown: shared endeavors with only their shared tracks, and no
// GM notes. This is interface-level hiding. The full record is still in room
// metadata, which every client can read.
export function playerView(board: Board): Endeavor[] {
  return activeEndeavors(board)
    .filter((e) => e.shared)
    .map((e) => ({ ...e, notes: "", tracks: e.tracks.filter((t) => t.shared) }));
}

// Failure if any failure track or clock is full, otherwise success once every
// success track is full. Only the tracks passed in count, so a player's view
// never reveals a hidden track by resolving.
export function resolution(e: Endeavor): Resolution | null {
  if (e.tracks.some((t) => t.kind !== "success" && t.value >= t.max)) return "failure";
  const successes = e.tracks.filter((t) => t.kind === "success");
  return successes.length > 0 && successes.every((t) => t.value >= t.max) ? "success" : null;
}

function makeTrack(id: string, kind: TrackKind, label: string, max: number): Track {
  return { id, kind, label, value: 0, max, shared: true, extra: {} };
}

// The tracks a new endeavor of this type starts with.
export function defaultTracks(type: EndeavorType, successes: number, newId: () => string): Track[] {
  const preset = TYPES[type];
  const tracks = [makeTrack(newId(), "success", preset.success, successes)];
  if (preset.failure) tracks.push(makeTrack(newId(), "failure", TRACK_LABEL.failure, DEFAULT_FAILURES));
  if (preset.clock) tracks.push(makeTrack(newId(), "clock", TRACK_LABEL.clock, DEFAULT_CLOCK));
  return tracks;
}

export const blankTrack = (id: string, kind: TrackKind): Track =>
  makeTrack(id, kind, TRACK_LABEL[kind], kind === "success" ? 2 : DEFAULT_FAILURES);

export function blankEndeavor(id: string, newId: () => string): Endeavor {
  return {
    id,
    name: "",
    type: "mission",
    objective: "",
    notes: "",
    shared: true,
    archived: false,
    order: 0,
    tracks: defaultTracks("mission", DIFFICULTIES[1].successes, newId),
    objectives: [],
    extra: {},
  };
}

export const saveEndeavor = (e: Endeavor): Update => ({ [endeavorKey(e.id)]: endeavorRecord(e) });

// Adds a new endeavor at the end of the list. The first one in play is pinned.
export function createEndeavor(board: Board, e: Endeavor): Update {
  const order = board.endeavors.reduce((max, x) => Math.max(max, x.order), 0) + 1;
  const update = saveEndeavor({ ...e, order });
  return pinnedId(board) === null && !e.archived ? { ...update, ...metaUpdate(e.id) } : update;
}

export const setPinned = (board: Board, id: string | null): Update =>
  id === pinnedId(board) ? {} : metaUpdate(id);

export function setShared(board: Board, id: string, shared: boolean): Update {
  const e = find(board, id);
  return e && e.shared !== shared ? saveEndeavor({ ...e, shared }) : {};
}

export function setTrackShared(board: Board, id: string, trackId: string, shared: boolean): Update {
  const e = find(board, id);
  if (!e || !e.tracks.some((t) => t.id === trackId && t.shared !== shared)) return {};
  return saveEndeavor({ ...e, tracks: e.tracks.map((t) => (t.id === trackId ? { ...t, shared } : t)) });
}

// Archiving the pinned endeavor unpins it.
export function setArchived(board: Board, id: string, archived: boolean): Update {
  const e = find(board, id);
  if (!e || e.archived === archived) return {};
  const update = saveEndeavor({ ...e, archived });
  return archived && board.pinned === id ? { ...update, ...metaUpdate(null) } : update;
}

// Deletes the endeavor and its log entries, and unpins it if it was pinned.
export function deleteEndeavor(board: Board, id: string): Update {
  const update: Update = { [endeavorKey(id)]: undefined };
  if (board.pinned === id) Object.assign(update, metaUpdate(null));
  if (board.log.some((entry) => entry.endeavorId === id)) {
    update[LOG_KEY] = board.log.filter((entry) => entry.endeavorId !== id);
  }
  return update;
}

const logged = (board: Board, entry: LogEntry): Update => ({
  [LOG_KEY]: [...board.log, entry].slice(-LOG_LIMIT),
});

// Moves a track by delta, clamped to 0..max. A tick that changes nothing writes nothing.
export function tick(board: Board, id: string, trackId: string, delta: number, stamp: Stamp): Update {
  const e = find(board, id);
  const track = e?.tracks.find((t) => t.id === trackId);
  if (!e || !track) return {};
  const value = clamp(track.value + delta, 0, track.max);
  if (value === track.value) return {};
  return {
    ...saveEndeavor({ ...e, tracks: e.tracks.map((t) => (t === track ? { ...t, value } : t)) }),
    ...logged(board, { ...stamp, endeavorId: id, kind: "track", target: trackId, delta: value - track.value }),
  };
}

export function toggleObjective(board: Board, id: string, objectiveId: string, stamp: Stamp): Update {
  const e = find(board, id);
  const objective = e?.objectives.find((o) => o.id === objectiveId);
  if (!e || !objective) return {};
  const done = !objective.done;
  return {
    ...saveEndeavor({ ...e, objectives: e.objectives.map((o) => (o === objective ? { ...o, done } : o)) }),
    ...logged(board, { ...stamp, endeavorId: id, kind: "objective", target: objectiveId, delta: done ? 1 : -1 }),
  };
}

// Reverses one logged change and drops it from the log. If its endeavor, track
// or objective is gone, only the log entry is dropped.
export function undo(board: Board, logId: string): Update {
  const entry = board.log.find((x) => x.id === logId);
  if (!entry) return {};
  const update: Update = { [LOG_KEY]: board.log.filter((x) => x !== entry) };
  const e = find(board, entry.endeavorId);
  if (!e) return update;
  if (entry.kind === "track") {
    const tracks = e.tracks.map((t) =>
      t.id === entry.target ? { ...t, value: clamp(t.value - entry.delta, 0, t.max) } : t,
    );
    return { ...update, ...saveEndeavor({ ...e, tracks }) };
  }
  const objectives = e.objectives.map((o) => (o.id === entry.target ? { ...o, done: entry.delta < 0 } : o));
  return { ...update, ...saveEndeavor({ ...e, objectives }) };
}

// What a log entry did, for display. Null names mean the thing has since been deleted.
export function describe(board: Board, entry: LogEntry): string {
  const e = find(board, entry.endeavorId);
  const name = e?.name ?? "Deleted endeavor";
  if (entry.kind === "track") {
    const label = e?.tracks.find((t) => t.id === entry.target)?.label ?? "removed track";
    return `${name}: ${label} ${entry.delta > 0 ? "+" : "−"}${Math.abs(entry.delta)}`;
  }
  const text = e?.objectives.find((o) => o.id === entry.target)?.text ?? "removed objective";
  return `${name}: ${entry.delta > 0 ? "checked" : "unchecked"} “${text}”`;
}
