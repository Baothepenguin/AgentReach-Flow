import { useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { VersionHistory } from "./VersionHistory";
import { History, Clock } from "lucide-react";
import type { NewsletterVersion } from "@shared/schema";
import { format } from "date-fns";

interface RightPanelProps {
  versions: NewsletterVersion[];
  currentVersionId: string | null;
  status: string;
  invoiceAmount?: number;
  invoiceStatus?: string;
  onRestoreVersion: (versionId: string) => void;
}

export function RightPanel({
  versions,
  currentVersionId,
  status,
  invoiceAmount,
  invoiceStatus,
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
    <div className="flex flex-col h-full bg-sidebar/50 border-l border-sidebar-border glass-surface">
      <div className="p-4 border-b border-sidebar-border space-y-4">
        <div>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</span>
          <div className="mt-1">
            <Badge className={`${getStatusColor(status)} capitalize`}>
              {getStatusLabel(status)}
            </Badge>
          </div>
        </div>
        
        {invoiceAmount !== undefined && (
          <div>
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Invoice</span>
            <div className="mt-1 flex items-center gap-2">
              <span className="font-medium">${invoiceAmount}</span>
              {invoiceStatus && (
                <Badge variant="outline" className="text-xs capitalize">
                  {invoiceStatus}
                </Badge>
              )}
            </div>
          </div>
        )}
      </div>
      
      <div className="flex-1 overflow-hidden">
        <div className="p-3 border-b border-sidebar-border">
          <div className="flex items-center gap-2 text-sm font-medium">
            <History className="w-4 h-4" />
            Version History
          </div>
        </div>
        <VersionHistory
          versions={versions}
          currentVersionId={currentVersionId}
          onRestore={onRestoreVersion}
        />
      </div>
    </div>
  );
}
