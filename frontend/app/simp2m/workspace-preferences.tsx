"use client";

import { createContext, useContext, useState, useSyncExternalStore } from "react";
import type { Palette } from "./workspace-palettes";

export type Theme = "dark" | "light" | "system";
export type { Palette };

type Preferences = {
  theme: Theme;
  appearance: "dark" | "light";
  collapsed: boolean;
  iconColor: string;
  palette: Palette;
  saveIconColor: (color: string) => void;
  savePalette: (palette: Palette) => void;
  save: (theme: Theme, collapsed: boolean) => void;
};

const PreferencesContext = createContext<Preferences | null>(null);
const systemQuery = "(prefers-color-scheme: dark)";
const hexColor = /^#[0-9a-f]{6}$/i;

function preferenceCookie(name: string, value: string, maxAge = 31536000) {
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${name}=${value}; Path=/simp2m; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

function subscribe(callback: () => void) {
  const media = window.matchMedia(systemQuery);
  media.addEventListener("change", callback);
  return () => media.removeEventListener("change", callback);
}

export function WorkspacePreferences({ initialTheme, initialCollapsed, initialIconColor, initialPalette, children }: {
  initialTheme: Theme; initialCollapsed: boolean; initialIconColor?: string; initialPalette?: Palette; children: React.ReactNode;
}) {
  const [theme, setTheme] = useState(initialTheme);
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [palette, setPalette] = useState<Palette>(initialPalette ?? "slate");
  const [iconColor, setIconColor] = useState(() =>
    initialIconColor && hexColor.test(initialIconColor) ? initialIconColor : "");
  const systemDark = useSyncExternalStore(subscribe, () => window.matchMedia(systemQuery).matches, () => true);
  const appearance = theme === "system" ? (systemDark ? "dark" : "light") : theme;

  function save(nextTheme: Theme, nextCollapsed: boolean) {
    setTheme(nextTheme);
    setCollapsed(nextCollapsed);
    preferenceCookie("simp2m_theme", nextTheme);
    preferenceCookie("simp2m_sidebar", nextCollapsed ? "collapsed" : "expanded");
  }

  function saveIconColor(color: string) {
    if (color && !hexColor.test(color)) return;
    setIconColor(color);
    preferenceCookie("simp2m_icon_color", color ? color.slice(1) : "", color ? 31536000 : 0);
  }

  function savePalette(nextPalette: Palette) {
    setPalette(nextPalette);
    preferenceCookie("simp2m_palette", nextPalette);
  }

  return (
    <PreferencesContext.Provider value={{ theme, appearance, collapsed, iconColor, palette, saveIconColor, savePalette, save }}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function useWorkspacePreferences() {
  const preferences = useContext(PreferencesContext);
  if (!preferences) throw new Error("WorkspacePreferences is missing");
  return preferences;
}
