import { formatDistanceToNow } from "date-fns";
import { Clock, User, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { NewsletterVersion } from "@shared/schema";

interface VersionHistoryProps {
  versions: NewsletterVersion[];
  currentVersionId: string | null;
  onRestore: (versionId: string) => void;
  isLoading?: boolean;
}

export function VersionHistory({
  versions,
  currentVersionId,
  onRestore,
  isLoading,
}: VersionHistoryProps) {
  if (versions.length === 0) {
    return (
      <div className="p-6 text-center text-sm text-muted-foreground">
        No versions yet. Versions are created when you save changes.
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="relative pl-6 pr-2 py-2">
        <div className="absolute left-[11px] top-4 bottom-4 w-0.5 bg-border" />
        <div className="space-y-4">
          {versions.map((version, index) => {
            const isCurrent = version.id === currentVersionId;
            return (
              <div
                key={version.id}
                data-testid={`version-item-${version.id}`}
                className="relative"
              >
                <div
                  className={`absolute left-[-18px] top-2 w-3 h-3 rounded-full border-2 ${
                    isCurrent
                      ? "bg-primary border-primary"
                      : "bg-background border-muted-foreground"
                  }`}
                />
                <div
                  className={`p-3 rounded-lg ${
                    isCurrent ? "bg-primary/5 border border-primary/20" : "bg-card"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        v{version.versionNumber}
                      </span>
                      {isCurrent && (
                        <span className="px-1.5 py-0.5 text-xs bg-primary text-primary-foreground rounded">
                          Current
                        </span>
                      )}
                    </div>
                    {!isCurrent && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onRestore(version.id)}
                        disabled={isLoading}
                        data-testid={`button-restore-${version.id}`}
                      >
                        <RotateCcw className="w-3 h-3 mr-1" />
                        Restore
                      </Button>
                    )}
                  </div>
                  {version.changeSummary && (
                    <p className="text-sm text-muted-foreground mt-1">
                      {version.changeSummary}
                    </p>
                  )}
                  <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      <span>
                        {formatDistanceToNow(new Date(version.createdAt), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                    {version.createdById && (
                      <div className="flex items-center gap-1">
                        <User className="w-3 h-3" />
                        <span>Producer</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </ScrollArea>
  );
}
