// Shared chrome for the public share landing page: the centered card shell,
// a status panel for terminal states, and the byte formatter the previews use.

import type { ReactNode } from "react";

import { Logo } from "@/shared/components/logo";
import { ModeToggle } from "@/shared/components/mode-toggle";

export function ShareShell({ children, wide }: { readonly children: ReactNode; readonly wide?: boolean }) {
  return (
    <div className="flex min-h-svh flex-col bg-muted/30">
      <header className="flex items-center justify-between px-4 py-3 md:px-6">
        <Logo />
        <ModeToggle />
      </header>
      <main className="flex flex-1 items-start justify-center p-4">
        <div className={`w-full ${wide ? "max-w-5xl" : "max-w-md"} rounded-xl border bg-background p-6 shadow-sm`}>
          {children}
        </div>
      </main>
    </div>
  );
}

export function ShareStatus({ icon, title }: { readonly icon: ReactNode; readonly title: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-center">
      {icon}
      <p className="text-sm font-medium text-muted-foreground">{title}</p>
    </div>
  );
}
