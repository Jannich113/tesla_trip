import { cn } from "@/lib/utils";

type ConfirmStripProps = {
  title: string;
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  danger?: boolean;
  className?: string;
};

/** Inline confirm for destructive actions (remove group, location, wipe data). */
export function ConfirmStrip({
  title,
  body,
  confirmLabel = "Remove",
  cancelLabel = "Keep",
  onConfirm,
  onCancel,
  danger = true,
  className,
}: ConfirmStripProps) {
  return (
    <div
      role="alertdialog"
      aria-labelledby="confirm-strip-title"
      aria-describedby={body ? "confirm-strip-body" : undefined}
      className={cn("rounded-lg bg-surface-2 p-3 shadow-[var(--shadow-border)]", className)}
    >
      <p id="confirm-strip-title" className="text-sm font-medium">
        {title}
      </p>
      {body ? (
        <p id="confirm-strip-body" className="mt-1 text-xs leading-relaxed text-muted">
          {body}
        </p>
      ) : null}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onConfirm}
          className={cn(
            "h-10 flex-1 rounded-full text-sm font-medium transition-[scale] duration-150 ease-[var(--ease-out)] active:scale-[0.96]",
            danger ? "bg-danger text-white" : "bg-foreground text-background",
          )}
        >
          {confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-10 flex-1 rounded-full bg-surface text-sm font-medium shadow-[var(--shadow-border)] transition-[scale] duration-150 ease-[var(--ease-out)] active:scale-[0.96]"
        >
          {cancelLabel}
        </button>
      </div>
    </div>
  );
}
