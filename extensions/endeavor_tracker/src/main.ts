import { connect, type Host, type Me } from "./host.ts";
import {
  DIFFICULTIES,
  MAX_TRACK,
  NS,
  ROOM_LIMIT_BYTES,
  TRACK_LABEL,
  TYPES,
  activeEndeavors,
  applyUpdate,
  archivedEndeavors,
  blankEndeavor,
  blankTrack,
  createEndeavor,
  defaultTracks,
  deleteEndeavor,
  describe,
  emptyBoard,
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
  type Board,
  type Endeavor,
  type EndeavorType,
  type Metadata,
  type Stamp,
  type Track,
  type TrackKind,
  type Update,
} from "./state.ts";

let host: Host;
let me: Me = { name: "", role: "PLAYER" };
// The room metadata as last seen, with our own writes applied on top at once, so
// two quick clicks on +1 both count instead of both starting from the old value.
let metadata: Metadata = {};
let board: Board = emptyBoard();
let draft: Endeavor | null = null; // the endeavor open in the editor (GM only)
let draftIsNew = false;
let armedDelete: string | null = null; // endeavor whose Delete was clicked once
let armTimer: ReturnType<typeof setTimeout> | undefined;

// Which cards this person has opened or closed. Kept per browser: it is each
// person's own view, not shared state.
const OPEN_KEY = `${NS}/open`;
const openCards = new Map<string, boolean>();

const RESOLVED_LABEL = { success: "Succeeded", failure: "Failed" } as const;

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

interface Props {
  className?: string;
  text?: string;
  title?: string;
  label?: string;
  type?: string;
  disabled?: boolean;
}

// Builds an element with textContent only, so typed names can never inject HTML.
function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: Node[]
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.className) node.className = props.className;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.title) node.title = props.title;
  if (props.label) node.setAttribute("aria-label", props.label);
  if (props.type) node.setAttribute("type", props.type);
  if (props.disabled !== undefined) node.toggleAttribute("disabled", props.disabled);
  node.append(...children);
  return node;
}

function button(text: string, onClick: () => void, props: Props = {}): HTMLButtonElement {
  const node = h("button", { type: "button", className: "secondary", text, ...props });
  node.addEventListener("click", onClick);
  return node;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function showNotice(message: string | null): void {
  const notice = byId("notice");
  notice.hidden = message === null;
  notice.textContent = message ?? "";
}

// UI-level rule. The SDK does not enforce it: only the GM changes anything.
const isGM = (): boolean => me.role === "GM";

const newId = (): string => crypto.randomUUID().slice(0, 8);
const stamp = (): Stamp => ({ id: newId(), at: Date.now(), by: (me.name || "GM").slice(0, 24) });

function show(next: Metadata): void {
  metadata = next;
  board = parseBoard(metadata);
  render();
}

async function commit(update: Update): Promise<void> {
  if (!isGM() || Object.keys(update).length === 0) return;
  show(applyUpdate(metadata, update));
  try {
    await host.setMetadata(update);
  } catch (error) {
    showNotice(`Could not save: ${errorText(error)}`);
    show(await host.getMetadata());
  }
}

function loadOpenCards(): void {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(OPEN_KEY) ?? "{}");
    if (typeof stored !== "object" || stored === null) return;
    for (const [id, open] of Object.entries(stored)) openCards.set(id, open === true);
  } catch {
    // Storage is blocked or holds junk: cards just start in their default state.
  }
}

function rememberOpen(id: string, open: boolean): void {
  openCards.set(id, open);
  try {
    localStorage.setItem(OPEN_KEY, JSON.stringify(Object.fromEntries(openCards)));
  } catch {
    // Not remembered across reloads, which is fine.
  }
}

function renderTrack(e: Endeavor, t: Track): HTMLElement {
  const pips = h("div", { className: "pips" });
  for (let i = 0; i < t.max; i++) pips.append(h("span", { className: i < t.value ? "pip on" : "pip" }));

  const head = h(
    "div",
    { className: "track-head" },
    h("span", { className: "track-label", text: t.label }),
    h("span", { className: "count", text: `${t.value} / ${t.max}` }),
  );
  if (isGM()) {
    const step = (delta: number, title: string): HTMLButtonElement =>
      button(`${delta > 0 ? "+" : "−"}${Math.abs(delta)}`, () => void commit(tick(board, e.id, t.id, delta, stamp())), {
        className: "secondary step",
        title,
        label: `${t.label} ${delta > 0 ? "plus" : "minus"} ${Math.abs(delta)}`,
        disabled: delta > 0 ? t.value >= t.max : t.value <= 0,
      });
    head.append(step(-1, "Take one back"), step(1, "Add one"));
    if (t.kind === "success") head.append(step(2, "Spectacular success: add two"));
    head.append(
      button(t.shared ? "Shown" : "Hidden", () => void commit(setTrackShared(board, e.id, t.id, !t.shared)), {
        className: t.shared ? "secondary eye" : "secondary eye off",
        title: t.shared ? "Players see this track. Click to hide it." : "Hidden from players. Click to show it.",
      }),
    );
  }
  return h("div", { className: `track ${t.kind}` }, head, pips);
}

function renderObjectives(e: Endeavor): HTMLElement {
  const list = h("ul", { className: "checks" });
  for (const o of e.objectives) {
    const box = h("input", { type: "checkbox", disabled: !isGM() });
    box.checked = o.done;
    box.addEventListener("change", () => void commit(toggleObjective(board, e.id, o.id, stamp())));
    const label = h("label", { className: o.done ? "done" : "" }, box, h("span", { text: o.text }));
    if (o.secondary) label.append(h("span", { className: "tag", text: "Secondary" }));
    list.append(h("li", {}, label));
  }
  return list;
}

function armDelete(id: string): void {
  clearTimeout(armTimer);
  armedDelete = id;
  armTimer = setTimeout(() => {
    armedDelete = null;
    render();
  }, 3000);
  render();
}

// Click once to arm, click again to delete.
function deleteButton(e: Endeavor): HTMLButtonElement {
  const armed = armedDelete === e.id;
  return button(
    armed ? "Click again to delete" : "Delete",
    () => {
      if (!armed) return armDelete(e.id);
      clearTimeout(armTimer);
      armedDelete = null;
      void commit(deleteEndeavor(board, e.id));
    },
    { className: armed ? "armed" : "secondary" },
  );
}

function renderCard(e: Endeavor): HTMLElement {
  const pinned = pinnedId(board) === e.id;
  const result = resolution(e);

  const summary = h("summary", {}, h("span", { className: "name", text: e.name }));
  summary.append(h("span", { className: "tag", text: TYPES[e.type].label }));
  if (pinned) summary.append(h("span", { className: "tag active", text: "Active" }));
  if (isGM() && !e.shared) summary.append(h("span", { className: "tag off", text: "Hidden" }));
  if (result) summary.append(h("span", { className: `tag ${result}`, text: RESOLVED_LABEL[result] }));
  summary.append(
    h("span", { className: "glance", text: e.tracks.map((t) => `${t.value}/${t.max}`).join(" · ") }),
  );

  const card = h("details", { className: pinned ? "card pinned" : "card" }, summary);
  card.open = openCards.get(e.id) ?? pinned;
  summary.addEventListener("click", () => rememberOpen(e.id, !card.open));

  if (e.objective) card.append(h("p", { className: "objective", text: e.objective }));
  for (const t of e.tracks) card.append(renderTrack(e, t));
  if (e.objectives.length > 0) card.append(renderObjectives(e));
  if (!isGM()) return card;

  if (e.notes) card.append(h("p", { className: "notes", text: e.notes, title: "GM notes. Players do not see these." }));
  card.append(
    h(
      "div",
      { className: "card-actions" },
      button(pinned ? "Unpin" : "Pin", () => void commit(setPinned(board, pinned ? null : e.id)), {
        title: "The pinned endeavor is the active one and sits at the top for everyone",
      }),
      button("Edit", () => openEditor(structuredClone(e), false)),
      button(e.shared ? "Hide" : "Share", () => void commit(setShared(board, e.id, !e.shared)), {
        title: e.shared ? "Players see this endeavor. Click to hide it." : "Hidden from players. Click to share it.",
      }),
      button("Archive", () => void commit(setArchived(board, e.id, true)), {
        title: "Put it away. Archived endeavors can be restored.",
      }),
      deleteButton(e),
    ),
  );
  return card;
}

function renderArchive(): HTMLElement | null {
  const archived = archivedEndeavors(board);
  if (archived.length === 0) return null;
  const section = h("details", { className: "drawer" }, h("summary", { text: `Archived (${archived.length})` }));
  section.open = openCards.get("archive") ?? false;
  section.firstElementChild?.addEventListener("click", () => rememberOpen("archive", !section.open));
  for (const e of archived) {
    const result = resolution(e);
    const name = h("span", { className: "name", text: e.name });
    if (result) name.append(h("span", { className: `tag ${result}`, text: RESOLVED_LABEL[result] }));
    section.append(
      h(
        "div",
        { className: "line" },
        name,
        button("Restore", () => void commit(setArchived(board, e.id, false))),
        deleteButton(e),
      ),
    );
  }
  return section;
}

function renderLog(): HTMLElement | null {
  if (board.log.length === 0) return null;
  const section = h("details", { className: "drawer" }, h("summary", { text: `Change log (${board.log.length})` }));
  section.open = openCards.get("log") ?? false;
  section.firstElementChild?.addEventListener("click", () => rememberOpen("log", !section.open));
  for (const entry of [...board.log].reverse()) {
    const time = new Date(entry.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    section.append(
      h(
        "div",
        { className: "line" },
        h("span", {}, h("span", { className: "when", text: `${time} ${entry.by}` }), h("span", { text: describe(board, entry) })),
        button("Undo", () => void commit(undo(board, entry.id)), { title: "Reverse this change" }),
      ),
    );
  }
  return section;
}

// Room metadata is small and shared with every other extension, so show the GM how much we use.
function renderStorage(): HTMLElement {
  const kb = (bytes: number): string => (bytes / 1000).toFixed(1);
  const heavy = board.bytes > ROOM_LIMIT_BYTES * 0.6;
  return h("p", {
    className: heavy ? "storage heavy" : "storage",
    text: heavy
      ? `Storage: ${kb(board.bytes)} of ${kb(ROOM_LIMIT_BYTES)} kB, shared with other extensions. Delete old endeavors to free space.`
      : `Storage: ${kb(board.bytes)} of ${kb(ROOM_LIMIT_BYTES)} kB`,
    title: "Owlbear room storage is limited and shared by every extension in the room",
  });
}

function render(): void {
  const editing = draft !== null;
  byId("new-btn").hidden = !isGM() || editing;
  byId("board").hidden = editing;
  byId("editor").hidden = !editing;
  // The editor is built when it opens, never on a re-render, so typing is not interrupted.
  if (editing) return;

  const container = byId("board");
  container.replaceChildren();
  const shown = isGM() ? activeEndeavors(board) : playerView(board);
  if (shown.length === 0) {
    const text = isGM() ? "No endeavors in play. Start one with New endeavor." : "Nothing is shared yet.";
    container.append(h("p", { className: "empty", text }));
  }
  for (const e of shown) container.append(renderCard(e));
  if (!isGM()) return;
  for (const section of [renderArchive(), renderLog()]) if (section) container.append(section);
  container.append(renderStorage());
}

// ----- Editor (GM only) -----

function openEditor(endeavor: Endeavor, isNew: boolean): void {
  if (!isGM()) return;
  draft = endeavor;
  draftIsNew = isNew;
  showNotice(null);
  render();
  renderEditor();
}

function closeEditor(): void {
  draft = null;
  render();
}

function textInput(value: string, maxLength: number, onInput: (value: string) => void, placeholder = ""): HTMLInputElement {
  const input = h("input", { type: "text" });
  input.value = value;
  input.maxLength = maxLength;
  input.placeholder = placeholder;
  input.addEventListener("input", () => onInput(input.value));
  return input;
}

function select<T extends string>(
  options: readonly (readonly [T, string])[],
  value: T,
  onChange: (value: T) => void,
  label: string,
): HTMLSelectElement {
  const node = h("select", { label });
  for (const [id, text] of options) {
    const option = h("option", { text });
    option.value = id;
    node.append(option);
  }
  node.value = value;
  node.addEventListener("change", () => onChange(node.value as T));
  return node;
}

const field = (label: string, control: HTMLElement): HTMLElement =>
  h("label", { className: "field" }, h("span", { text: label }), control);

const setMax = (t: Track, max: number): void => {
  t.max = Math.min(MAX_TRACK, Math.max(1, Math.round(max) || 1));
  t.value = Math.min(t.value, t.max);
};

function renderEditor(): void {
  const d = draft;
  if (!d) return;
  const form = byId("editor");
  form.replaceChildren(h("h2", { text: draftIsNew ? "New endeavor" : "Edit endeavor" }));

  const name = textInput(d.name, 60, (v) => (d.name = v), "Name");
  name.required = true;
  form.append(field("Name", name));

  // Difficulty is the first success track's threshold, from the collective threshold table.
  const firstSuccess = d.tracks.find((t) => t.kind === "success");
  const difficulty = DIFFICULTIES.find((x) => x.successes === firstSuccess?.max)?.id ?? "custom";
  form.append(
    h(
      "div",
      { className: "form-row" },
      field(
        "Type",
        select(
          Object.entries(TYPES).map(([id, t]) => [id as EndeavorType, t.label] as const),
          d.type,
          (type) => {
            d.type = type;
            // A new endeavor takes the type's starting tracks. An existing one keeps its own.
            if (draftIsNew) d.tracks = defaultTracks(type, firstSuccess?.max ?? DIFFICULTIES[1].successes, newId);
            renderEditor();
          },
          "Type",
        ),
      ),
      field(
        "Difficulty",
        select(
          [...DIFFICULTIES.map((x) => [x.id, `${x.label} (${x.successes})`] as const), ["custom", "Custom"] as const],
          difficulty,
          (id) => {
            const preset = DIFFICULTIES.find((x) => x.id === id);
            if (preset && firstSuccess) setMax(firstSuccess, preset.successes);
            renderEditor();
          },
          "Difficulty",
        ),
      ),
    ),
  );

  form.append(field("Objective", textInput(d.objective, 140, (v) => (d.objective = v), "What the party is trying to do")));

  form.append(h("h3", { text: "Tracks" }));
  for (const t of d.tracks) {
    const max = h("input", { type: "number", label: "Threshold", title: "Threshold" });
    max.min = "1";
    max.max = String(MAX_TRACK);
    max.value = String(t.max);
    max.addEventListener("change", () => {
      setMax(t, Number(max.value));
      renderEditor();
    });
    form.append(
      h(
        "div",
        { className: "form-row" },
        select(
          (Object.keys(TRACK_LABEL) as TrackKind[]).map((kind) => [kind, kind[0]!.toUpperCase() + kind.slice(1)] as const),
          t.kind,
          (kind) => {
            // Follow the kind's default label unless the GM has typed their own.
            if (t.label === TRACK_LABEL[t.kind]) t.label = TRACK_LABEL[kind];
            t.kind = kind;
            renderEditor();
          },
          "Track kind",
        ),
        textInput(t.label, 30, (v) => (t.label = v), "Label"),
        max,
        button("✕", () => {
          d.tracks = d.tracks.filter((x) => x !== t);
          renderEditor();
        }, { label: `Remove track ${t.label}`, title: "Remove this track" }),
      ),
    );
  }
  form.append(
    button("Add track", () => {
      d.tracks.push(blankTrack(newId(), "success"));
      renderEditor();
    }),
  );

  form.append(h("h3", { text: "Objectives checklist" }));
  for (const o of d.objectives) {
    const secondary = h("input", { type: "checkbox" });
    secondary.checked = o.secondary;
    secondary.addEventListener("change", () => (o.secondary = secondary.checked));
    form.append(
      h(
        "div",
        { className: "form-row" },
        textInput(o.text, 80, (v) => (o.text = v), "Objective"),
        h("label", { className: "check" }, secondary, h("span", { text: "Secondary" })),
        button("✕", () => {
          d.objectives = d.objectives.filter((x) => x !== o);
          renderEditor();
        }, { label: "Remove objective", title: "Remove this objective" }),
      ),
    );
  }
  form.append(
    button("Add objective", () => {
      d.objectives.push({ id: newId(), text: "", done: false, secondary: false, extra: {} });
      renderEditor();
    }),
  );

  const notes = h("textarea");
  notes.value = d.notes;
  notes.maxLength = 600;
  notes.rows = 3;
  notes.addEventListener("input", () => (d.notes = notes.value));
  form.append(field("GM notes (players do not see these)", notes));

  const shared = h("input", { type: "checkbox" });
  shared.checked = d.shared;
  shared.addEventListener("change", () => (d.shared = shared.checked));
  form.append(h("label", { className: "check" }, shared, h("span", { text: "Shared with players" })));

  form.append(
    h(
      "div",
      { className: "form-row end" },
      button("Cancel", closeEditor),
      h("button", { type: "submit", text: draftIsNew ? "Create" : "Save" }),
    ),
  );
}

function saveDraft(): void {
  const d = draft;
  if (!d || !isGM()) return;
  const endeavor: Endeavor = {
    ...d,
    name: d.name.trim(),
    objective: d.objective.trim(),
    notes: d.notes.trim(),
    tracks: d.tracks.map((t) => ({ ...t, label: t.label.trim() || TRACK_LABEL[t.kind] })),
    objectives: d.objectives.map((o) => ({ ...o, text: o.text.trim() })).filter((o) => o.text),
  };
  if (!endeavor.name) return;
  draft = null;
  void commit(draftIsNew ? createEndeavor(board, endeavor) : saveEndeavor(endeavor));
  render();
}

function wireControls(): void {
  byId("new-btn").addEventListener("click", () => openEditor(blankEndeavor(newId(), newId), true));
  byId("editor").addEventListener("submit", (event) => {
    event.preventDefault();
    saveDraft();
  });
}

async function start(): Promise<void> {
  host = await connect();
  loadOpenCards();
  wireControls();
  me = await host.getMe();
  host.onMeChange((next) => {
    me = next;
    if (!isGM()) draft = null;
    render();
  });
  host.onMetadataChange(show);
  show(await host.getMetadata());
}

void start();
