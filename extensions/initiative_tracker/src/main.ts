import OBR from "@owlbear-rodeo/sdk";
import {
  LANES,
  addCombatant,
  allEntries,
  entriesInLane,
  next,
  parseTracker,
  removeCombatant,
  resetFight,
  setSpeed,
  setTurnState,
  stateOf,
  type Combatant,
  type Entry,
  type Side,
  type TurnState,
  type Tracker,
  type Update,
} from "./state.ts";

type Role = "GM" | "PLAYER";
interface PartyPlayer {
  id: string;
  name: string;
}

const me: { id: string; role: Role } = { id: "", role: "PLAYER" };
let tracker: Tracker = { round: 1, combatants: [] };
let sceneReady = false;
let partyPlayers: PartyPlayer[] = [];
let clearArmed = false;
let clearTimer: ReturnType<typeof setTimeout> | undefined;

const STATE_SYMBOL: Record<TurnState, string> = { waiting: "○", active: "▶", done: "✓" };
const STATE_LABEL: Record<TurnState, string> = {
  waiting: "Waiting",
  active: "Active",
  done: "Done",
};
const NEXT_STATE: Record<TurnState, TurnState> = {
  waiting: "active",
  active: "done",
  done: "waiting",
};

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

// UI-level rule: the GM acts for everyone, players only for PCs they own.
// The SDK does not enforce this; it is a table convention.
const canAct = (c: Combatant): boolean => isGM() || (c.side === "PC" && c.ownerId === me.id);

function renderRow(entry: Entry): HTMLElement {
  const { combatant: c, speed } = entry;
  const state = stateOf(entry);
  const allowed = sceneReady && canAct(c);

  const stateBtn = h("button", {
    className: "state-btn",
    text: STATE_SYMBOL[state],
    title: `${STATE_LABEL[state]}. Click to change.`,
    label: `${c.name}: ${STATE_LABEL[state]}`,
    type: "button",
    disabled: !allowed,
  });
  stateBtn.addEventListener("click", () =>
    write(setTurnState(tracker, c.id, speed, NEXT_STATE[state])),
  );

  const name = h("span", { className: "name", text: c.name });
  if (c.boss) name.append(h("span", { className: "tag", text: "Boss" }));
  const nameCell = h("div", {}, name);

  const controls = h("div");
  if (!c.boss) {
    const other = speed === "fast" ? "slow" : "fast";
    const speedBtn = h("button", {
      className: "speed-btn secondary",
      text: speed === "fast" ? "Fast" : "Slow",
      title: `Switch to ${other} turn (only before this turn starts)`,
      type: "button",
      disabled: !allowed || state !== "waiting",
    });
    speedBtn.addEventListener("click", () => write(setSpeed(tracker, c.id, other)));
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
    removeBtn.addEventListener("click", () => write(removeCombatant(c.id)));
    removeCell.append(removeBtn);
  }

  const classes = ["row", state];
  if (c.side === "PC" && c.ownerId === me.id && !isGM()) classes.push("mine");
  return h("div", { className: classes.join(" ") }, stateBtn, nameCell, controls, removeCell);
}

function renderLanes(): void {
  const container = byId("lanes");
  container.replaceChildren();
  for (const lane of LANES) {
    const entries = entriesInLane(tracker, lane);
    const hasActive = entries.some((e) => stateOf(e) === "active");
    const title = `${lane.speed === "fast" ? "Fast" : "Slow"} ${lane.side === "PC" ? "PCs" : "NPCs"}`;
    const section = h(
      "section",
      { className: hasActive ? "lane has-active" : "lane" },
      h("h2", { text: title }),
    );
    if (entries.length === 0) section.append(h("div", { className: "lane-empty", text: "Nobody" }));
    for (const entry of entries) section.append(renderRow(entry));
    container.append(section);
  }
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

  const entries = allEntries(tracker);
  const anyActive = entries.some((e) => stateOf(e) === "active");
  const anyWaiting = entries.some((e) => stateOf(e) === "waiting");

  byId("gm-actions").hidden = !isGM();
  const nextBtn = byId<HTMLButtonElement>("next-btn");
  nextBtn.disabled = !sceneReady || entries.length === 0;
  nextBtn.textContent = !anyActive && !anyWaiting && entries.length > 0 ? "Next round" : "Next";

  byId("add-form").hidden = !isGM() || !sceneReady;
  renderLanes();
}

function wireControls(): void {
  byId("next-btn").addEventListener("click", () => write(next(tracker)));

  const clearBtn = byId<HTMLButtonElement>("clear-btn");
  clearBtn.addEventListener("click", () => {
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
    const nameInput = byId<HTMLInputElement>("add-name");
    const name = nameInput.value.trim();
    if (!name) return;
    const side: Side = sideSelect.value === "NPC" ? "NPC" : "PC";
    void write(
      addCombatant(tracker, {
        id: crypto.randomUUID(),
        name,
        side,
        boss: byId<HTMLInputElement>("add-boss").checked,
        ownerId: side === "PC" && ownerSelect.value ? ownerSelect.value : null,
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
  renderOwnerOptions();
}

OBR.onReady(async () => {
  [me.id, me.role] = await Promise.all([OBR.player.getId(), OBR.player.getRole()]);
  wireControls();

  await loadParty();
  OBR.party.onChange(() => void loadParty());

  sceneReady = await OBR.scene.isReady();
  if (sceneReady) tracker = parseTracker(await OBR.scene.getMetadata());
  OBR.scene.onReadyChange(async (ready) => {
    sceneReady = ready;
    tracker = ready ? parseTracker(await OBR.scene.getMetadata()) : { round: 1, combatants: [] };
    render();
  });
  OBR.scene.onMetadataChange((metadata) => {
    tracker = parseTracker(metadata);
    render();
  });

  render();
});
