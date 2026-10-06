"use client";

import { cn } from "@/lib/cn";

/** Error alert for tutor/API errors. */
export interface ErrorAlertProps {
  /** Error message to display. */
  message: string;
  /** Called when the user dismisses the alert. */
  onDismiss: () => void;
  /** Optional: retry action. */
  onRetry?: () => void;
}

export function ErrorAlert({ message, onDismiss, onRetry }: ErrorAlertProps) {
  return (
    <div className={cn("rounded-ctl border border-error bg-error/10 p-3 text-sm text-error")}>
      <div className="flex items-start gap-2">
        <svg className="w-4 h-4 mt-0.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="12" y1="8" x2="12" y2="12" />
          <line x1="12" y1="16" x2="12.01" y2="16" />
        </svg>
        <div className="flex-1">
          <p className="font-medium">Something went wrong</p>
          <p>{message}</p>
        </div>
        <div className="flex items-center gap-1">
          {onRetry && (
            <button
              onClick={onRetry}
              className="btn btn-ghost btn-xs rounded-ctl text-error hover:bg-error/10"
            >
              Retry
            </button>
          )}
          <button
            onClick={onDismiss}
            className="btn btn-ghost btn-xs rounded-ctl text-muted hover:text-error"
            aria-label="Dismiss error"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}