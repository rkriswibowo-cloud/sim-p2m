"use client";

import { Monitor, Moon, Sun } from "lucide-react";
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
  const { theme, collapsed, save } = useWorkspacePreferences();

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
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-xs text-muted-foreground">Preferensi tersimpan di browser ini.</p>
        <Button type="button" size="sm" variant="outline" disabled={theme === "dark" && !collapsed} onClick={() => update("dark", false)}>
          Kembalikan bawaan
        </Button>
      </div>
    </CardContent>
  </Card>;
}
