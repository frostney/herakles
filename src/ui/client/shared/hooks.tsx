import { createContext, useContext, useEffect, useRef, useState } from "react";
import type { HeraklesEvent } from "../../../domain";
import { subscribeToEvents } from "../api";

export type Loadable<T> =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: T };

export const EventContext = createContext<HeraklesEvent | undefined>(undefined);
const themeStorageKey = "herakles.workbenchTheme.v1";
type ThemePreference = "dark" | "light";

export function useResource<T>(
  loader: () => Promise<T>,
): [Loadable<T>, (loaderOverride?: () => Promise<T>) => void] {
  const [state, setState] = useState<Loadable<T>>({ status: "loading" });
  const requestIdRef = useRef(0);
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  const refresh = (loaderOverride?: () => Promise<T>) => {
    const requestId = ++requestIdRef.current;
    setState({ status: "loading" });
    (loaderOverride ?? loaderRef.current)()
      .then((data) => {
        if (requestId === requestIdRef.current) setState({ status: "ready", data });
      })
      .catch((error) => {
        if (requestId === requestIdRef.current) {
          setState({ status: "error", error: String(error) });
        }
      });
  };
  useEffect(refresh, []);
  return [state, refresh];
}

export function useEventStreamStatus(): HeraklesEvent | undefined {
  const [latest, setLatest] = useState<HeraklesEvent>();
  useEffect(
    () =>
      subscribeToEvents((event) => {
        setLatest(event);
      }),
    [],
  );
  return latest;
}

export function useRefreshOnEvents(refresh: () => void, types: HeraklesEvent["type"][]) {
  const latestEvent = useContext(EventContext);
  const refreshRef = useRef(refresh);
  const key = types.join("|");
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);
  useEffect(() => {
    if (!latestEvent) return;
    if ((key.split("|") as HeraklesEvent["type"][]).includes(latestEvent.type)) {
      refreshRef.current();
    }
  }, [latestEvent, key]);
}

export function useWorkbenchTheme() {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => {
    if (typeof window === "undefined") return "dark";
    const stored = window.localStorage.getItem(themeStorageKey);
    if (stored === "dark" || stored === "light") return stored;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  });
  useEffect(() => {
    document.documentElement.dataset.theme = preference;
  }, [preference]);
  const setPreference = (next: ThemePreference) => {
    setPreferenceState(next);
    window.localStorage.setItem(themeStorageKey, next);
  };
  const cycle = () => {
    setPreference(preference === "dark" ? "light" : "dark");
  };
  return { cycle, preference };
}
