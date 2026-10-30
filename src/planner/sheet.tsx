import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * An overlay over the planner sidebar: a bottom sheet on phones, a panel over the sidebar on
 * laptops. Escape, the backdrop or Done closes it; the page behind does not scroll while open.
 * It renders into <body>: inside the sidebar, the page layout clipped its bottom edge.
 */
export function Sheet({
  open,
  onClose,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[1100] flex items-end lg:items-stretch" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label={`Close ${title.toLowerCase()}`} className="absolute inset-0 bg-black/55" onClick={onClose} />
      <div className="relative flex max-h-[90dvh] w-full flex-col rounded-t-2xl bg-background shadow-2xl lg:max-h-none lg:w-[400px] lg:rounded-none lg:rounded-r-2xl">
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{title}</p>
            {subtitle ? <p className="truncate text-xs text-muted">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto inline-flex h-8 shrink-0 items-center rounded-full bg-foreground px-3 text-xs font-medium text-background"
          >
            Done
          </button>
        </div>
        <div className="overflow-y-auto overscroll-contain px-3 pb-6 pt-3">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
