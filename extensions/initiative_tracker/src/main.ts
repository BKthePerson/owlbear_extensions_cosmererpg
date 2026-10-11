import OBR from "@owlbear-rodeo/sdk";

// Permissions spike. Question being answered: can players, as well as the GM,
// write to shared state and see each other's writes? Scene metadata, room
// metadata and broadcast messages are the three candidate channels.

const NS = "com.brandonklein.cosmere-initiative";
const KEY = `${NS}/spike`;
const CHANNEL = `${NS}/ping`;

interface Stamp {
  by: string;
  role: string;
  n: number;
  at: string;
}

type Role = "GM" | "PLAYER";

const me: { id: string; name: string; role: Role } = {
  id: "",
  name: "",
  role: "PLAYER",
};
let counter = 0;

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function isStamp(value: unknown): value is Stamp {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.by === "string" &&
    typeof v.role === "string" &&
    typeof v.n === "number" &&
    typeof v.at === "string"
  );
}

function describe(value: unknown): string {
  if (value === undefined) return "nothing yet";
  if (isStamp(value)) return `${value.by} (${value.role}) #${value.n} at ${value.at}`;
  return JSON.stringify(value);
}

function makeStamp(): Stamp {
  counter += 1;
  return {
    by: me.name || me.id,
    role: me.role,
    n: counter,
    at: new Date().toLocaleTimeString(),
  };
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function log(line: string): void {
  const item = document.createElement("li");
  item.textContent = `${new Date().toLocaleTimeString()}  ${line}`;
  byId("log").prepend(item);
}

async function attempt(label: string, action: () => Promise<void>): Promise<void> {
  try {
    await action();
    log(`${label}: ok`);
  } catch (error) {
    log(`${label}: FAILED ${errorText(error)}`);
  }
}

OBR.onReady(async () => {
  [me.id, me.name, me.role] = await Promise.all([
    OBR.player.getId(),
    OBR.player.getName(),
    OBR.player.getRole(),
  ]);
  byId("who").textContent = `You are ${me.name || me.id}, role ${me.role}.`;

  // Scene metadata. Only readable once a scene is loaded.
  const showScene = (metadata: Record<string, unknown>): void => {
    byId("scene-value").textContent = describe(metadata[KEY]);
  };
  if (await OBR.scene.isReady()) showScene(await OBR.scene.getMetadata());
  OBR.scene.onReadyChange(async (ready) => {
    if (ready) showScene(await OBR.scene.getMetadata());
  });
  OBR.scene.onMetadataChange(showScene);
  byId("scene-btn").addEventListener("click", () =>
    attempt("scene metadata write", () => OBR.scene.setMetadata({ [KEY]: makeStamp() })),
  );

  // Room metadata. Lives with the room, not a particular scene.
  const showRoom = (metadata: Record<string, unknown>): void => {
    byId("room-value").textContent = describe(metadata[KEY]);
  };
  showRoom(await OBR.room.getMetadata());
  OBR.room.onMetadataChange(showRoom);
  byId("room-btn").addEventListener("click", () =>
    attempt("room metadata write", () => OBR.room.setMetadata({ [KEY]: makeStamp() })),
  );

  // Broadcast. Not stored, so late joiners see nothing, but any role can send.
  OBR.broadcast.onMessage(CHANNEL, (event) => {
    log(`broadcast received: ${describe(event.data)}`);
  });
  byId("bcast-btn").addEventListener("click", () =>
    attempt("broadcast send", () =>
      OBR.broadcast.sendMessage(CHANNEL, makeStamp(), { destination: "ALL" }),
    ),
  );

  // Room permissions, as reported to this player.
  const showPerms = (permissions: string[]): void => {
    byId("perms").textContent = permissions.length ? permissions.join(", ") : "(none reported)";
  };
  showPerms(await OBR.room.getPermissions());
  OBR.room.onPermissionsChange(showPerms);
});
