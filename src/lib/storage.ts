export const storage = {
  get<T>(key: string, fallback: T): T {
    try {
      return (
        JSON.parse(localStorage.getItem(`echo:${key}`) || "null") ?? fallback
      );
    } catch {
      return fallback;
    }
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
    try {
      return (
        JSON.parse(sessionStorage.getItem(`echo:${key}`) || "null") ?? fallback
      );
    } catch {
      return fallback;
    }
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
