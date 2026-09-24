let entries: string[] = [];
const listeners = new Set<() => void>();

export const getSessionLog = () => entries;
export function subscribeToSessionLog(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Keep history across screens and retries until the app closes.
export function appendSessionLog(message: string) {
  entries = [...entries, `[${new Date().toISOString()}] ${message}`];
  for (const listener of listeners) listener();
}
