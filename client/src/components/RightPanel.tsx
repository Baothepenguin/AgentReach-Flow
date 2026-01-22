import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { History, Clock, RotateCcw, MessageSquare } from "lucide-react";
import type { NewsletterVersion, TasksFlags } from "@shared/schema";
import { format } from "date-fns";

const NEWSLETTER_STATUSES = [
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "internal_review", label: "Internal Review" },
  { value: "client_review", label: "Client Review" },
  { value: "revisions", label: "Revisions" },
  { value: "approved", label: "Approved" },
  { value: "sent", label: "Sent" },
];

interface RightPanelProps {
  versions: NewsletterVersion[];
  currentVersionId: string | null;
  status: string;
  flags?: TasksFlags[];
  onRestoreVersion: (versionId: string) => void;
  onStatusChange?: (status: string) => void;
}

export function RightPanel({
  versions,
  currentVersionId,
  status,
  flags = [],
  onRestoreVersion,
  onStatusChange,
}: RightPanelProps) {
  const currentStatus = NEWSLETTER_STATUSES.find(s => s.value === status) || NEWSLETTER_STATUSES[0];
  
  const clientComments = flags.filter(f => f.code === "CLIENT_CHANGES_REQUESTED");

  return (
    <div className="flex flex-col h-full bg-muted/30">
      <div className="p-4 border-b">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block" data-testid="label-status">
          Status
        </label>
        {onStatusChange ? (
          <Select value={status} onValueChange={onStatusChange}>
            <SelectTrigger className="w-full" data-testid="select-status-trigger">
              <SelectValue placeholder="Select status" data-testid="select-status-value" />
            </SelectTrigger>
            <SelectContent align="start" data-testid="select-status-content">
              {NEWSLETTER_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value} data-testid={`status-option-${s.value}`}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="px-3 py-2 rounded-md text-sm font-medium bg-muted" data-testid="text-status-readonly">
            {currentStatus.label}
          </div>
        )}
      </div>

      {clientComments.length > 0 && (
        <div className="p-3 border-b">
          <div className="flex items-center gap-2 text-sm font-medium mb-2" data-testid="label-client-feedback">
            <MessageSquare className="w-4 h-4" />
            Client Feedback
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {clientComments.map((comment) => (
              <div 
                key={comment.id} 
                className="p-2 rounded-md bg-background text-sm"
                data-testid={`comment-${comment.id}`}
              >
                <p className="text-foreground" data-testid={`comment-message-${comment.id}`}>{comment.message}</p>
                <p className="text-xs text-muted-foreground mt-1" data-testid={`comment-timestamp-${comment.id}`}>
                  {format(new Date(comment.createdAt), "MMM d, yyyy 'at' h:mm a")}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
      
      <div className="p-3 border-b">
        <div className="flex items-center gap-2 text-sm font-medium" data-testid="label-version-history">
          <History className="w-4 h-4" />
          Version History
        </div>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {versions.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground" data-testid="text-no-versions">
              No versions yet
            </div>
          ) : (
            versions.map((v) => (
              <div
                key={v.id}
                className={`p-2 rounded-md text-sm ${
                  v.id === currentVersionId ? "bg-primary/10" : "hover:bg-muted/50"
                }`}
                data-testid={`version-${v.id}`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span data-testid={`version-timestamp-${v.id}`}>
                      {format(new Date(v.createdAt), "MMM d, h:mm a")}
                    </span>
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
                  <p className="text-xs text-muted-foreground mt-1 truncate" data-testid={`version-summary-${v.id}`}>
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
