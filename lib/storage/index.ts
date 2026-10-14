import { createLocalSessionStore } from "./local";
import type { SessionStore } from "./types";

export * from "./types";
export { createLocalSessionStore } from "./local";
export {
  loadCardMemory,
  saveCardMemory,
  removeCardMemory,
  listCardMemories,
  replaceCardMemories,
  emptyCardMemory,
  replaceSessions,
  subscribeSessions,
  type CardMemory,
} from "./local";
export { createMemoryBackend, configureBackends, getDataBackend, getLocalBackend, resetBackendCache } from "./backend";
export type { BackendKind, VaultBackend } from "./backend";

/** 存储层的唯一入口。所有读写都在解锁之后才有意义。 */
export function getSessionStore(): SessionStore {
  return createLocalSessionStore();
}
