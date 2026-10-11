import OBR from "@owlbear-rodeo/sdk";
import {
  ACTIONS,
  LANES,
  addCombatant,
  emptyTracker,
  entriesInLane,
  next,
  nextAction,
  parseTracker,
  removeCombatant,
  resetFight,
  setSpeed,
  setTurnState,
  stateOf,
  type Combatant,
  type Entry,
  type Side,
  type Tracker,
  type TurnState,
  type Update,
} from "./state.ts";

type Role = "GM" | "PLAYER";
interface PartyPlayer {
  id: string;
  name: string;
}

const me: { id: string; name: string; role: Role } = { id: "", name: "", role: "PLAYER" };
let tracker: Tracker = emptyTracker();
let sceneReady = false;
let partyPlayers: PartyPlayer[] = [];
// Every player name we know, by Owlbear player id, including this player.
const playerNames = new Map<string, string>();
let clearArmed = false;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

const STATE_SYMBOL: Record<TurnState, string> = { waiting: "○", done: "✓" };
const STATE_LABEL: Record<TurnState, string> = { waiting: "Waiting", done: "Done" };
const TOGGLE_STATE: Record<TurnState, TurnState> = { waiting: "done", done: "waiting" };
const NEXT_LABEL = { start: "Start round", band: "Next band", round: "Next round" } as const;

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

// Builds an element with textContent only, so player-typed names can never inject HTML.
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

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function showNotice(message: string | null, info = false): void {
  const notice = byId("notice");
  notice.hidden = message === null;
  notice.className = info ? "notice info" : "notice";
  notice.textContent = message ?? "";
}

async function write(update: Update): Promise<void> {
  if (Object.keys(update).length === 0) return;
  try {
    await OBR.scene.setMetadata(update);
  } catch (error) {
    showNotice(`Could not save: ${errorText(error)}`);
  }
}

const isGM = (): boolean => me.role === "GM";

// UI-level rules. The SDK does not enforce them; they are a table convention.
// - Moving the band (Next), Clear fight, add and remove are GM only.
// - A player controls only PCs they own: fast or slow, and marking their own turn Done.
// - The GM controls every row.
const canControl = (c: Combatant): boolean =>
  isGM() || (c.side === "PC" && c.ownerId !== null && c.ownerId === me.id);

// Live name if the player is in the room, otherwise the name saved when they were assigned.
const ownerLabel = (c: Combatant): string | null =>
  c.ownerId === null ? null : (playerNames.get(c.ownerId) ?? c.ownerName);

function renderRow(entry: Entry): HTMLElement {
  const { combatant: c, speed } = entry;
  const state = stateOf(entry);
  const controllable = sceneReady && canControl(c);

  const stateBtn = h("button", {
    className: "state-btn",
    text: STATE_SYMBOL[state],
    title: controllable ? `${STATE_LABEL[state]}. Click to toggle.` : STATE_LABEL[state],
    label: `${c.name}: ${STATE_LABEL[state]}`,
    type: "button",
    disabled: !controllable,
  });
  stateBtn.addEventListener("click", () => {
    if (!canControl(c)) return;
    void write(setTurnState(tracker, c.id, speed, TOGGLE_STATE[state]));
  });

  const name = h("span", { className: "name", text: c.name });
  if (c.boss) name.append(h("span", { className: "tag", text: "Boss" }));
  const nameCell = h("div", {}, name);
  // Show the player's name small beside the character, unless it is the same text.
  const owner = ownerLabel(c);
  if (owner && owner !== c.name) {
    nameCell.append(h("span", { className: "owner", text: owner, title: "Player" }));
  }

  const controls = h("div");
  if (!c.boss) {
    const other = speed === "fast" ? "slow" : "fast";
    const speedBtn = h("button", {
      className: "speed-btn secondary",
      text: speed === "fast" ? "Fast" : "Slow",
      title: `Switch to ${other} turn (only before this turn starts)`,
      type: "button",
      disabled: !controllable || state !== "waiting",
    });
    speedBtn.addEventListener("click", () => {
      if (!canControl(c)) return;
      void write(setSpeed(tracker, c.id, other));
    });
    controls.append(speedBtn);
  }

  const removeCell = h("div");
  // Bosses appear in two lanes; only the fast row carries the remove button.
  if (isGM() && (!c.boss || speed === "fast")) {
    const removeBtn = h("button", {
      className: "remove-btn",
      text: "×",
      title: `Remove ${c.name}`,
      label: `Remove ${c.name}`,
      type: "button",
    });
    removeBtn.addEventListener("click", () => {
      if (isGM()) void write(removeCombatant(c.id));
    });
    removeCell.append(removeBtn);
  }

  const classes = ["row", state];
  if (!isGM() && canControl(c)) classes.push("mine");
  return h("div", { className: classes.join(" ") }, stateBtn, nameCell, controls, removeCell);
}

// Two solid arrows for a fast turn (2 actions), three for a slow turn (3 actions).
function pips(speed: "fast" | "slow"): HTMLElement {
  const count = ACTIONS[speed];
  return h("span", {
    className: "pips",
    text: "▶".repeat(count),
    title: `${count} actions`,
    label: `${count} actions`,
  });
}

function renderLanes(): void {
  const container = byId("lanes");
  container.replaceChildren();
  LANES.forEach((lane, index) => {
    const entries = entriesInLane(tracker, lane);
    const current = tracker.band === index;
    const title = `${lane.speed === "fast" ? "Fast" : "Slow"} ${lane.side === "PC" ? "PCs" : "NPCs"}`;
    const heading = h("h2", { text: title }, pips(lane.speed));
    if (current) heading.append(h("span", { className: "now", text: "Now" }));
    const section = h("section", { className: current ? "lane current" : "lane" }, heading);
    if (entries.length === 0) section.append(h("div", { className: "lane-empty", text: "Nobody" }));
    for (const entry of entries) section.append(renderRow(entry));
    container.append(section);
  });
}

function renderOwnerOptions(): void {
  const select = byId<HTMLSelectElement>("add-owner");
  const previous = select.value;
  select.replaceChildren(h("option", { text: "No owner" }));
  select.options[0]!.value = "";
  for (const player of partyPlayers) {
    const option = h("option", { text: player.name || player.id });
    option.value = player.id;
    select.append(option);
  }
  select.value = [...select.options].some((o) => o.value === previous) ? previous : "";
}

function render(): void {
  byId("round").textContent = `Round ${tracker.round}`;

  if (!sceneReady) showNotice("Open a scene to use the tracker.", true);
  else if (byId("notice").classList.contains("info")) showNotice(null);

  const action = nextAction(tracker);

  byId("gm-actions").hidden = !isGM();
  const nextBtn = byId<HTMLButtonElement>("next-btn");
  nextBtn.disabled = !sceneReady || action === null;
  nextBtn.textContent = NEXT_LABEL[action ?? "start"];

  byId("add-form").hidden = !isGM() || !sceneReady;
  renderLanes();
}

function wireControls(): void {
  byId("next-btn").addEventListener("click", () => {
    if (isGM()) void write(next(tracker));
  });

  const clearBtn = byId<HTMLButtonElement>("clear-btn");
  clearBtn.addEventListener("click", () => {
    if (!isGM()) return;
    if (!clearArmed) {
      clearArmed = true;
      clearBtn.textContent = "Click again to clear";
      clearBtn.classList.add("armed");
      clearTimer = setTimeout(disarmClear, 3000);
      return;
    }
    disarmClear();
    void write(resetFight(tracker));
  });

  const sideSelect = byId<HTMLSelectElement>("add-side");
  const ownerSelect = byId<HTMLSelectElement>("add-owner");
  const syncOwnerVisibility = (): void => {
    ownerSelect.hidden = sideSelect.value !== "PC";
  };
  sideSelect.addEventListener("change", syncOwnerVisibility);
  syncOwnerVisibility();

  byId<HTMLFormElement>("add-form").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!isGM()) return;
    const nameInput = byId<HTMLInputElement>("add-name");
    const side: Side = sideSelect.value === "NPC" ? "NPC" : "PC";
    const ownerId = side === "PC" && ownerSelect.value ? ownerSelect.value : null;
    const ownerName = ownerId ? (playerNames.get(ownerId) ?? null) : null;
    // A blank name falls back to the chosen player's name.
    const name = nameInput.value.trim() || ownerName;
    if (!name) {
      showNotice("Enter a name, or pick a player to use their name.");
      return;
    }
    showNotice(null);
    void write(
      addCombatant(tracker, {
        id: crypto.randomUUID(),
        name,
        side,
        boss: byId<HTMLInputElement>("add-boss").checked,
        ownerId,
        ownerName,
      }),
    );
    nameInput.value = "";
    nameInput.focus();
  });
}

function disarmClear(): void {
  clearArmed = false;
  clearTimeout(clearTimer);
  const clearBtn = byId<HTMLButtonElement>("clear-btn");
  clearBtn.textContent = "Clear fight";
  clearBtn.classList.remove("armed");
}

async function loadParty(): Promise<void> {
  const players = await OBR.party.getPlayers();
  partyPlayers = players
    .filter((p) => p.role === "PLAYER")
    .map((p) => ({ id: p.id, name: p.name }));
  playerNames.clear();
  playerNames.set(me.id, me.name);
  for (const p of players) playerNames.set(p.id, p.name);
  renderOwnerOptions();
  render();
}

OBR.onReady(async () => {
  [me.id, me.name, me.role] = await Promise.all([
    OBR.player.getId(),
    OBR.player.getName(),
    OBR.player.getRole(),
  ]);
  wireControls();

  await loadParty();
  OBR.party.onChange(() => void loadParty());

  sceneReady = await OBR.scene.isReady();
  if (sceneReady) tracker = parseTracker(await OBR.scene.getMetadata());
  OBR.scene.onReadyChange(async (ready) => {
    sceneReady = ready;
    tracker = ready ? parseTracker(await OBR.scene.getMetadata()) : emptyTracker();
    render();
  });
  OBR.scene.onMetadataChange((metadata) => {
    tracker = parseTracker(metadata);
    render();
  });

  render();
});
