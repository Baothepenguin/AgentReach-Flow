import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { StatusPill } from "./StatusPill";
import { Calendar, FileText } from "lucide-react";
import type { Newsletter } from "@shared/schema";

interface NewsletterCardProps {
  newsletter: Newsletter;
  isSelected?: boolean;
  onClick: () => void;
}

export function NewsletterCard({ newsletter, isSelected, onClick }: NewsletterCardProps) {
  return (
    <button
      data-testid={`newsletter-card-${newsletter.id}`}
      onClick={onClick}
      className={cn(
        "w-full text-left p-4 rounded-lg border transition-colors",
        "hover-elevate active-elevate-2",
        isSelected
          ? "bg-accent border-accent-border"
          : "bg-card border-card-border"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <h3 className="font-medium text-sm truncate">{newsletter.title}</h3>
          </div>
          <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <Calendar className="w-3 h-3" />
              <span>{new Date(newsletter.periodStart).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
            </div>
            <span>
              Updated {formatDistanceToNow(new Date(newsletter.updatedAt), { addSuffix: true })}
            </span>
          </div>
        </div>
        <StatusPill status={newsletter.status} size="sm" />
      </div>
    </button>
  );
}
