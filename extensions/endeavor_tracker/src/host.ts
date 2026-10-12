// Everything the popover needs from Owlbear, behind one small interface, so the
// dev server can also run the popover in a plain browser tab with no Owlbear.

import OBR from "@owlbear-rodeo/sdk";
import { applyUpdate, type Metadata, type Update } from "./state.ts";

export type Role = "GM" | "PLAYER";
export interface Me {
  name: string;
  role: Role;
}

export interface Host {
  getMe(): Promise<Me>;
  onMeChange(callback: (me: Me) => void): void;
  getMetadata(): Promise<Metadata>;
  setMetadata(update: Update): Promise<void>;
  onMetadataChange(callback: (metadata: Metadata) => void): void;
}

const owlbear: Host = {
  async getMe() {
    const [name, role] = await Promise.all([OBR.player.getName(), OBR.player.getRole()]);
    return { name, role };
  },
  onMeChange: (callback) => void OBR.player.onChange((player) => callback({ name: player.name, role: player.role })),
  getMetadata: () => OBR.room.getMetadata(),
  setMetadata: (update) => OBR.room.setMetadata(update),
  onMetadataChange: (callback) => void OBR.room.onMetadataChange(callback),
};

// Dev only: a room kept in this tab's localStorage. Open popover.html straight
// from the dev server to use it, and add ?role=player for the player view.
function standIn(): Host {
  const key = "endeavor-tracker-dev-room";
  const listeners: ((metadata: Metadata) => void)[] = [];
  let metadata: Metadata = JSON.parse(localStorage.getItem(key) ?? "{}");
  const role: Role = new URLSearchParams(location.search).get("role") === "player" ? "PLAYER" : "GM";
  return {
    getMe: async () => ({ name: role === "GM" ? "Dev GM" : "Dev player", role }),
    onMeChange: () => {},
    getMetadata: async () => metadata,
    async setMetadata(update) {
      metadata = JSON.parse(JSON.stringify(applyUpdate(metadata, update)));
      localStorage.setItem(key, JSON.stringify(metadata));
      for (const listener of listeners) listener(metadata);
    },
    onMetadataChange: (callback) => void listeners.push(callback),
  };
}

export function connect(): Promise<Host> {
  if (import.meta.env.DEV && !OBR.isAvailable) return Promise.resolve(standIn());
  return new Promise((resolve) => OBR.onReady(() => resolve(owlbear)));
}
