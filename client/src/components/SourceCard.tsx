import { ExternalLink, Calendar, Globe } from "lucide-react";
import type { AIDraftSource } from "@shared/schema";

interface SourceCardProps {
  source: AIDraftSource;
}

export function SourceCard({ source }: SourceCardProps) {
  return (
    <div
      data-testid={`source-card-${source.id}`}
      className="p-3 rounded-lg bg-card border border-card-border"
    >
      <div className="flex items-start gap-2">
        <div className="w-5 h-5 rounded bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
          <Globe className="w-3 h-3 text-muted-foreground" />
        </div>
        <div className="min-w-0 flex-1">
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium hover:underline flex items-center gap-1 group"
          >
            <span className="truncate">{source.sourceName}</span>
            <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 flex-shrink-0" />
          </a>
          {source.sourceDate && (
            <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
              <Calendar className="w-3 h-3" />
              <span>{source.sourceDate}</span>
            </div>
          )}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {source.referencedBy.map((moduleId) => (
              <span
                key={moduleId}
                className="px-1.5 py-0.5 text-xs bg-muted rounded font-mono"
              >
                {moduleId}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
