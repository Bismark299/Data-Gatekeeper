import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/context/ThemeContext";

type Props = {
  variant?: "icon" | "full";
  className?: string;
};

export function ThemeToggle({ variant = "icon", className }: Props) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";
  const label  = isDark ? "Switch to light mode" : "Switch to dark mode";

  if (variant === "full") {
    return (
      <Button
        variant="ghost"
        size="sm"
        onClick={toggleTheme}
        className={className}
        aria-label={label}
        data-testid="button-theme-toggle"
      >
        {isDark ? <Sun className="w-4 h-4 mr-2" /> : <Moon className="w-4 h-4 mr-2" />}
        {isDark ? "Light Mode" : "Dark Mode"}
      </Button>
    );
  }

  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={toggleTheme}
      className={className}
      aria-label={label}
      title={label}
      data-testid="button-theme-toggle"
    >
      {isDark ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
    </Button>
  );
}
