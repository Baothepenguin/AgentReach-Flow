import { cn } from "@/lib/utils";
import type { ClientStatus, NewsletterStatus, FlagSeverity } from "@/lib/types";

interface StatusPillProps {
  status: ClientStatus | NewsletterStatus | FlagSeverity;
  size?: "sm" | "default";
}

const statusStyles: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  past_due: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  canceled: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  draft: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
  internal_review: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  client_review: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  revisions: "bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400",
  scheduled: "bg-violet-100 text-violet-800 dark:bg-violet-900/30 dark:text-violet-400",
  sent: "bg-teal-100 text-teal-800 dark:bg-teal-900/30 dark:text-teal-400",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400",
  blocker: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
};

const statusLabels: Record<string, string> = {
  active: "Active",
  paused: "Paused",
  past_due: "Past Due",
  canceled: "Canceled",
  draft: "Draft",
  internal_review: "Internal Review",
  client_review: "Client Review",
  revisions: "Revisions",
  approved: "Approved",
  scheduled: "Scheduled",
  sent: "Sent",
  info: "Info",
  warning: "Warning",
  blocker: "Blocker",
};

export function StatusPill({ status, size = "default" }: StatusPillProps) {
  return (
    <span
      data-testid={`status-${status}`}
      className={cn(
        "inline-flex items-center rounded-full font-medium whitespace-nowrap",
        size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-xs",
        statusStyles[status] || "bg-gray-100 text-gray-600"
      )}
    >
      {statusLabels[status] || status}
    </span>
  );
}
