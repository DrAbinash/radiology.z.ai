import type { HTMLAttributes } from "react";
import { clsx } from "clsx";

type Variant = "default" | "outline" | "secondary" | "destructive";

const variants: Record<Variant, string> = {
  default: "bg-primary/10 text-primary border-primary/20",
  outline: "border-border text-foreground",
  secondary: "bg-secondary text-secondary-foreground border-transparent",
  destructive: "bg-destructive/10 text-destructive border-destructive/20",
};

export function Badge({
  className,
  variant = "default",
  ...props
}: HTMLAttributes<HTMLSpanElement> & { variant?: Variant }) {
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        variants[variant],
        className,
      )}
      {...props}
    />
  );
}
