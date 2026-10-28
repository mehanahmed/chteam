import {
  Moon,
  Sun,
} from "lucide-react";
import type { ReactNode } from "react";
import { useTheme } from "../../contexts/theme-context";
import { LanguageSwitcher } from "../settings/LanguageSwitcher";

interface GlassAuthShellProps {
  children: ReactNode;
}

export function GlassAuthShell({ children }: GlassAuthShellProps) {
  let resolvedTheme = "light";
  let toggleTheme = () => {};
  try {
    const theme = useTheme();
    resolvedTheme = theme.resolvedTheme;
    toggleTheme = theme.toggleTheme;
  } catch {
    // Fallback when rendered outside ThemeProvider
  }

  return (
    <div className="relative min-h-dvh w-full overflow-x-hidden flex flex-col justify-between bg-gradient-to-b from-[#e1f3e9] via-[#edf7f1] to-[#f5fbf7] dark:from-[#0b141a] dark:via-[#111b21] dark:to-[#17242c] text-slate-800 dark:text-slate-100 transition-colors duration-500">
      {/* WhatsApp Atmospheric & Glass Ambient Glows */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        {/* Top WhatsApp Deep Teal Ambient Beam */}
        <div className="absolute -top-36 left-1/2 -translate-x-1/2 w-[850px] h-[520px] rounded-full bg-gradient-to-b from-[#075e54]/18 via-[#128c7e]/12 to-transparent blur-3xl dark:from-[#00a884]/15 dark:via-[#075e54]/25" />

        {/* WhatsApp Green Soft Radial Blobs */}
        <div className="absolute top-1/4 -left-36 w-[500px] h-[500px] rounded-full bg-[#25d366]/12 blur-3xl dark:bg-[#00a884]/10" />
        <div className="absolute top-1/3 -right-36 w-[550px] h-[550px] rounded-full bg-[#128c7e]/14 blur-3xl dark:bg-[#128c7e]/15" />

        {/* Faint Concentric Arch Rings in WhatsApp Green/Teal */}
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[680px] h-[680px] rounded-full border border-[#128c7e]/15 dark:border-[#25d366]/10 pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[920px] h-[920px] rounded-full border border-[#128c7e]/10 dark:border-[#25d366]/5 pointer-events-none" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[1160px] h-[1160px] rounded-full border border-[#128c7e]/5 dark:border-[#25d366]/[0.03] pointer-events-none" />

        {/* Bottom Ambient Cloud / Fog Layer in Soft WhatsApp White/Teal */}
        <div className="absolute -bottom-10 inset-x-0 h-80 bg-gradient-to-t from-white via-white/80 to-transparent dark:from-[#0b141a] dark:via-[#0b141a]/80 dark:to-transparent blur-xl" />
        <div className="absolute -bottom-24 left-1/2 -translate-x-1/2 w-[120vw] h-96 rounded-[50%] bg-[#e3f4ea]/70 dark:bg-[#075e54]/15 blur-3xl" />
      </div>

      {/* Top Controls Centered */}
      <header className="relative z-10 w-full max-w-7xl mx-auto px-6 pt-6 sm:pt-8 flex items-center justify-center">
        {/* Controls: Language & Theme Toggle */}
        <div className="flex items-center gap-2.5">
          {/* Language Switcher */}
          <div>
            <LanguageSwitcher showLabel={false} className="[&_button]:h-9 [&_button]:rounded-full [&_button]:bg-white/80 dark:[&_button]:bg-[#1f2c33]/80 [&_button]:backdrop-blur-md [&_button]:border-emerald-900/10 dark:[&_button]:border-white/10 [&_button]:shadow-sm" />
          </div>

          {/* Theme Toggle Button */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={resolvedTheme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            className="flex items-center justify-center h-9 w-9 rounded-full bg-white/80 dark:bg-[#1f2c33]/80 backdrop-blur-md border border-emerald-900/10 dark:border-white/10 shadow-sm text-slate-700 dark:text-slate-200 hover:bg-white dark:hover:bg-[#2a3942] hover:scale-105 active:scale-95 transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#25d366]"
          >
            {resolvedTheme === "dark" ? (
              <Sun className="h-4 w-4 text-[#25d366]" />
            ) : (
              <Moon className="h-4 w-4 text-[#075e54]" />
            )}
          </button>
        </div>
      </header>

      {/* Main Content Area (Centered Floating Glass Card) */}
      <main className="relative z-10 flex-1 flex items-center justify-center px-4 py-8 sm:py-12">
        {children}
      </main>
    </div>
  );
}
