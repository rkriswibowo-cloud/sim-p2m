"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, fieldClass } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Eye, EyeOff, GraduationCap } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";

export function LoginForm({ renew }: { renew: boolean }) {
  const [pending, setPending] = useState(renew);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    if (!renew || attempted.current) return;
    attempted.current = true;
    async function refresh() {
      try {
        const response = await fetch("/api/v1/auth/refresh", { method: "POST" });
        if (response.ok) {
          window.location.replace("/simp2m");
          return;
        }
      } catch {
        // The login form remains available after a failed refresh.
      }
      setError("Sesi tidak bisa diperbarui. Silakan masuk kembali.");
      setPending(false);
    }
    void refresh();
  }, [renew]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setPending(true);
    setError("");
    try {
      const response = await fetch("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: fields.get("email"), password: fields.get("password") }),
      });
      if (response.ok) {
        window.location.replace("/simp2m");
        return;
      }
      switch (response.status) {
        case 401:
          setError("Email atau kata sandi salah.");
          break;
        case 403:
          setError("Akses ditolak: alamat origin belum terdaftar di SIMP2M_WEB_ORIGIN.");
          break;
        case 429:
          setError("Terlalu banyak percobaan masuk. Coba lagi dalam satu menit.");
          break;
        default:
          setError("Layanan masuk tidak dapat digunakan saat ini.");
      }
    } catch {
      setError("Koneksi ke layanan masuk terputus.");
    }
    setPending(false);
  }

  return (
    <Card lang="id" className="w-full max-w-[440px] overflow-hidden border-border/80 p-0 shadow-lg">
      <div className="relative bg-[#dce6f7] px-6 pt-6 pb-10 dark:bg-slate-800/90">
        <h1 className="text-lg font-semibold tracking-tight text-[#1e3a6e] dark:text-sky-200">
          Selamat Datang di Aplikasi SIM-P2M
        </h1>
        <p className="mt-1 text-sm leading-snug text-[#2c4a7c] dark:text-slate-300">
          Basis informasi penelitian dan pengabdian kepada masyarakat · Universitas Anwar Medika
        </p>
        <div className="absolute -bottom-8 left-6 grid size-16 place-items-center rounded-full border-4 border-card bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-md">
          <GraduationCap aria-hidden="true" className="size-8" />
        </div>
      </div>

      <div className="px-6 pt-12 pb-6">
        <form method="post" className="space-y-4" onSubmit={login}>
          <Input
            label="Email"
            name="email"
            type="email"
            placeholder="Masukkan Email"
            autoComplete="username"
            maxLength={254}
            required
            disabled={pending}
          />

          <div className="space-y-1.5">
            <label htmlFor="login-password" className="block text-sm font-medium leading-none text-foreground">
              Password
            </label>
            <div className="flex">
              <input
                id="login-password"
                name="password"
                type={showPassword ? "text" : "password"}
                placeholder="Masukkan Password"
                autoComplete="current-password"
                maxLength={256}
                required
                disabled={pending}
                className={cn(fieldClass, "flex h-9 rounded-r-none border-r-0 px-3 py-1")}
              />
              <button
                type="button"
                aria-label={showPassword ? "Sembunyikan kata sandi" : "Tampilkan kata sandi"}
                onClick={() => setShowPassword(prev => !prev)}
                disabled={pending}
                className="inline-flex h-9 items-center justify-center rounded-r-lg border border-input bg-muted/60 px-3 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={e => setRememberMe(e.target.checked)}
              disabled={pending}
              className="size-4 rounded border-input accent-[#1f5cb8]"
            />
            <span>Ingat saya</span>
          </label>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <Button
            type="submit"
            disabled={pending}
            className="h-10 w-full bg-[#1f5cb8] text-white hover:bg-[#194c99]"
          >
            {pending ? "Memproses…" : "Log In"}
          </Button>
        </form>

        <div className="mt-5 text-center">
          <button
            type="button"
            onClick={() => setShowHelp(prev => !prev)}
            className="text-sm font-medium text-[#1f5cb8] hover:underline dark:text-sky-400"
          >
            Kesulitan login? Bantuan
          </button>
          {showHelp && (
            <p className="mt-2 rounded-md border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
              Hubungi Admin LPPM Universitas Anwar Medika untuk aktivasi akun dosen atau pengaturan ulang kata sandi.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
