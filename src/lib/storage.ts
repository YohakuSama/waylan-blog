/** Shared JSON read semantics: both backends return their own fallback on denied storage, missing keys or malformed JSON. */
function readJSON<T>(read: () => string | null, fallback: T): T {
  try {
    return JSON.parse(read() || "null") ?? fallback;
  } catch {
    return fallback;
  }
}

export const storage = {
  get<T>(key: string, fallback: T): T {
    return readJSON(() => localStorage.getItem(`echo:${key}`), fallback);
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(`echo:${key}`, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(`echo:${key}`);
      return true;
    } catch {
      return false;
    }
  },
};
export const transient = {
  get<T>(key: string, fallback: T): T {
    return readJSON(() => sessionStorage.getItem(`echo:${key}`), fallback);
  },
  set(key: string, value: unknown) {
    try {
      sessionStorage.setItem(`echo:${key}`, JSON.stringify(value));
    } catch {}
  },
  remove(key: string) {
    try {
      sessionStorage.removeItem(`echo:${key}`);
    } catch {}
  },
};
