/**
 * useTheme — dark/light mode toggle for the radiology workstation.
 * Useful for night reporting / eye strain reduction.
 */
import { useEffect, useState } from "react";

type Theme = "light" | "dark";

const THEME_KEY = "rad_theme";

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    if (typeof window === "undefined") return "light";
    return (localStorage.getItem(THEME_KEY) as Theme) ?? "light";
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  return {
    theme,
    toggle: () => setTheme((t) => (t === "light" ? "dark" : "light")),
    setTheme,
  };
}
