// Where the Supabase session actually lives depends on the "Remember me on
// this device" checkbox on the login form. Supabase's client picks its
// storage adapter once, at client-construction time — before we know what
// the user will choose on any given login. So instead of swapping the whole
// client, we hand it ONE storage object whose getItem/setItem/removeItem
// route to real localStorage or sessionStorage based on a flag written to
// localStorage itself (localStorage is used for the flag regardless of mode,
// since it's the only one of the two that's readable before we know which
// mode is active). The flag MUST be set before signInWithPassword runs, or
// the session write that follows lands in the wrong backing store.
export const PERSIST_FLAG_KEY = "sybil.persist";

export function isPersistEnabled(): boolean {
  const raw = localStorage.getItem(PERSIST_FLAG_KEY);
  return raw === null ? true : raw === "true"; // unset = current default = remember me ON
}

export function setPersistEnabled(persist: boolean) {
  localStorage.setItem(PERSIST_FLAG_KEY, String(persist));
}

function backingStore(): Storage {
  return isPersistEnabled() ? window.localStorage : window.sessionStorage;
}

export const authStorage = {
  getItem: (key: string) => backingStore().getItem(key),
  setItem: (key: string, value: string) => backingStore().setItem(key, value),
  removeItem: (key: string) => backingStore().removeItem(key),
};
