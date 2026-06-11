type Stored<T> = { v: number; t: number; data: T };

function isBrowser(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function loadDraft<T>(key: string, version: number): T | null {
  if (!isBrowser()) return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored<T>;
    if (!parsed || parsed.v !== version) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function saveDraft<T>(key: string, version: number, data: T): void {
  if (!isBrowser()) return;
  try {
    const payload: Stored<T> = { v: version, t: Date.now(), data };
    window.localStorage.setItem(key, JSON.stringify(payload));
  } catch {
    // QuotaExceeded など — 黙って諦める
  }
}

export function clearDraft(key: string): void {
  if (!isBrowser()) return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}
