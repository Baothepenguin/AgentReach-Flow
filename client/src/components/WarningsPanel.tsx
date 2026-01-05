import { cn } from "@/lib/utils";
import { AlertCircle, AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "./StatusPill";
import type { TasksFlags } from "@shared/schema";

interface WarningsPanelProps {
  flags: TasksFlags[];
  onResolve?: (flagId: string) => void;
}

const severityIcons = {
  info: Info,
  warning: AlertTriangle,
  blocker: AlertCircle,
};

const severityColors = {
  info: "border-l-blue-500",
  warning: "border-l-amber-500",
  blocker: "border-l-red-500",
};

export function WarningsPanel({ flags, onResolve }: WarningsPanelProps) {
  const activeFlags = flags.filter((f) => !f.resolvedAt);
  const resolvedFlags = flags.filter((f) => f.resolvedAt);

  if (flags.length === 0) {
    return (
      <div className="p-6 text-center">
        <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500 mb-3" />
        <p className="text-sm font-medium">All Clear</p>
        <p className="text-xs text-muted-foreground mt-1">
          No warnings or blockers detected
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {activeFlags.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
            Active Issues ({activeFlags.length})
          </h4>
          {activeFlags.map((flag) => {
            const Icon = severityIcons[flag.severity as keyof typeof severityIcons];
            return (
              <div
                key={flag.id}
                data-testid={`warning-flag-${flag.id}`}
                className={cn(
                  "p-3 rounded-r-lg border-l-4 bg-card",
                  severityColors[flag.severity as keyof typeof severityColors]
                )}
              >
                <div className="flex items-start gap-2">
                  <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <StatusPill status={flag.severity as "info" | "warning" | "blocker"} size="sm" />
                      <span className="text-xs font-mono text-muted-foreground">{flag.code}</span>
                    </div>
                    <p className="text-sm">{flag.message}</p>
                    {onResolve && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="mt-2 h-7 text-xs"
                        onClick={() => onResolve(flag.id)}
                      >
                        Mark Resolved
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {resolvedFlags.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-1">
            Resolved ({resolvedFlags.length})
          </h4>
          {resolvedFlags.map((flag) => (
            <div
              key={flag.id}
              className="p-3 rounded-lg bg-muted/30 opacity-60"
            >
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                <span className="text-sm line-through">{flag.message}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
