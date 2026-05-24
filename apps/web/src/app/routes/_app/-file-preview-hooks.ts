import { useEffect, useState } from "react";

import { useTheme } from "@/shared/components/theme-provider";

/** Resolve the effective dark/light mode the way the app applies it. */
export function useIsDark(): boolean {
  const { theme } = useTheme();
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches);

  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined")
      return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setSystemDark(mq.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return theme === "dark" || (theme === "system" && systemDark);
}
