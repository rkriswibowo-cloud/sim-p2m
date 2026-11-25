"use client";

import { createContext, useContext, useState, useSyncExternalStore } from "react";

export type Theme = "dark" | "light" | "system";
type Preferences = {
  theme: Theme;
  appearance: "dark" | "light";
  collapsed: boolean;
  save: (theme: Theme, collapsed: boolean) => void;
};

const PreferencesContext = createContext<Preferences | null>(null);
const systemQuery = "(prefers-color-scheme: dark)";

function subscribe(callback: () => void) {
  const media = window.matchMedia(systemQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

export function WorkspacePreferences({ initialTheme, initialCollapsed, children }: {
  initialTheme: Theme; initialCollapsed: boolean; children: React.ReactNode;
}) {
  const [theme, setTheme] = useState(initialTheme);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const systemDark = useSyncExternalStore(subscribe, () => window.matchMedia(systemQuery).matches, () => true);
  const appearance = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  function save(nextTheme: Theme, nextCollapsed: boolean) {
    setTheme(nextTheme);
    setCollapsed(nextCollapsed);
    const secure = window.location.protocol === "https:" ? "; Secure" : "";
    const options = `; Path=/simp2m; Max-Age=31536000; SameSite=Lax${secure}`;
    document.cookie = `simp2m_theme=${nextTheme}${options}`;
    document.cookie = `simp2m_sidebar=${nextCollapsed ? "collapsed" : "expanded"}${options}`;
  }

  return <PreferencesContext.Provider value={{ theme, appearance, collapsed, save }}>{children}</PreferencesContext.Provider>;
}

export function useWorkspacePreferences() {
  const preferences = useContext(PreferencesContext);
  if (!preferences) throw new Error("WorkspacePreferences is missing");
  return preferences;
}
