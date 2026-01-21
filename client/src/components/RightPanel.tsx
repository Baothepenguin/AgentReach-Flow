import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { History, Clock, RotateCcw } from "lucide-react";
import type { NewsletterVersion } from "@shared/schema";
import { format } from "date-fns";

interface RightPanelProps {
  versions: NewsletterVersion[];
  currentVersionId: string | null;
  status: string;
  onRestoreVersion: (versionId: string) => void;
}

export function RightPanel({
  versions,
  currentVersionId,
  status,
  onRestoreVersion,
}: RightPanelProps) {
  const getStatusLabel = (s: string) => {
    const labels: Record<string, string> = {
      not_started: "Not Started",
      in_progress: "In Progress",
      internal_review: "Internal Review",
      client_review: "Client Review",
      revisions: "Revisions",
      approved: "Approved",
      sent: "Sent",
    };
    return labels[s] || s;
  };

  const getStatusColor = (s: string) => {
    switch (s) {
      case "approved":
      case "sent":
        return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
      case "client_review":
      case "internal_review":
        return "bg-blue-500/10 text-blue-600 dark:text-blue-400";
      case "revisions":
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="flex flex-col h-full bg-muted/30">
      <div className="p-4 border-b">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</span>
        <div className="mt-1">
          <Badge className={`${getStatusColor(status)} capitalize`}>
            {getStatusLabel(status)}
          </Badge>
        </div>
      </div>
      
      <div className="p-3 border-b">
        <div className="flex items-center gap-2 text-sm font-medium">
          <History className="w-4 h-4" />
          Version History
        </div>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {versions.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              No versions yet
            </div>
          ) : (
            versions.map((v) => (
              <div
                key={v.id}
                className={`p-2 rounded-md text-sm ${
                  v.id === currentVersionId ? "bg-primary/10" : "hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    {format(new Date(v.createdAt), "MMM d, h:mm a")}
                  </div>
                  {v.id !== currentVersionId && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={() => onRestoreVersion(v.id)}
                      data-testid={`button-restore-${v.id}`}
                    >
                      <RotateCcw className="w-3 h-3 mr-1" />
                      Restore
                    </Button>
                  )}
                </div>
                {v.changeSummary && (
                  <p className="text-xs text-muted-foreground mt-1 truncate">
                    {v.changeSummary}
                  </p>
                )}
              </div>
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
