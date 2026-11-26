"use client";

import { FlaskConical, Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { HexColorInput, HexColorPicker } from "react-colorful";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { workspaceToastOptions } from "../confirm-removal";
import { useWorkspacePreferences } from "../workspace-preferences";
import type { Theme } from "../workspace-preferences";

const themes = [
  { value: "dark", label: "Gelap", icon: Moon },
  { value: "light", label: "Terang", icon: Sun },
  { value: "system", label: "Ikuti perangkat", icon: Monitor },
] as const;

export function AppearanceSettings() {
  const { theme, appearance, collapsed, iconColor, saveIconColor, save } = useWorkspacePreferences();
  const pickerColor = iconColor || (appearance === "light" ? "#28557c" : "#a3c9ec");

  function update(nextTheme: Theme, nextCollapsed: boolean) {
    save(nextTheme, nextCollapsed);
    toast.success("Tampilan disimpan.", workspaceToastOptions);
  }

  return <Card>
    <CardHeader><CardTitle>Tampilan</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <fieldset className="min-w-0">
        <legend className="mb-2 text-sm font-medium">Tema</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {themes.map(({ value, label, icon: Icon }) => <label key={value} className="flex cursor-pointer flex-wrap items-center gap-2 rounded-lg border border-border p-3 text-sm has-checked:border-primary">
            <input type="radio" name="workspace-theme" value={value} checked={theme === value} onChange={() => update(value, collapsed)} />
            <Icon size={16} aria-hidden="true" /> {label}
          </label>)}
        </div>
      </fieldset>
      <label className="flex w-fit cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" checked={collapsed} onChange={event => update(theme, event.target.checked)} />
        Ciutkan sidebar desktop
      </label>
      <fieldset className="space-y-3 border-t border-border pt-3">
        <legend className="pr-2 text-sm font-medium">Warna ikon navigasi</legend>
        <div className="flex flex-wrap items-start gap-4">
          <HexColorPicker color={pickerColor} onChange={saveIconColor} role="group" aria-label="Pemilih warna ikon" />
          <div className="space-y-2">
            <label htmlFor="workspace-icon-hex" className="block text-sm">Kode HEX</label>
            <HexColorInput id="workspace-icon-hex" color={pickerColor} onChange={saveIconColor} prefixed
              className="w-28 rounded-md border border-input bg-card px-2 py-1 font-mono text-sm" />
            <div className="workspace-icon-preview flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-sm">
              <FlaskConical size={17} aria-hidden="true" /> Pratinjau ikon
            </div>
            {iconColor && <Button data-action-tone="attention" type="button" size="sm" variant="outline" onClick={() => saveIconColor("")}>
              <RotateCcw size={15} aria-hidden="true" /> Warna ikon bawaan
            </Button>}
          </div>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">Preferensi tersimpan di browser ini.</p>
        <Button data-action-tone="attention" type="button" size="sm" variant="outline" disabled={theme === "dark" && !collapsed && !iconColor} onClick={() => {
          saveIconColor("");
          update("dark", false);
        }}>
          <RotateCcw size={15} aria-hidden="true" />
          Kembalikan bawaan
        </Button>
      </div>
    </CardContent>
  </Card>;
}
