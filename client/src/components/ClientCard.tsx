import { cn } from "@/lib/utils";
import { StatusPill } from "./StatusPill";
import { MapPin, Mail } from "lucide-react";
import type { Client } from "@shared/schema";

interface ClientCardProps {
  client: Client;
  isSelected?: boolean;
  onClick: () => void;
}

export function ClientCard({ client, isSelected, onClick }: ClientCardProps) {
  return (
    <button
      data-testid={`client-card-${client.id}`}
      onClick={onClick}
      className={cn(
        "w-full text-left p-3 rounded-lg border transition-colors",
        "hover-elevate active-elevate-2",
        isSelected
          ? "bg-sidebar-accent border-sidebar-accent-border"
          : "bg-transparent border-transparent"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="font-medium text-sm truncate">{client.name}</h3>
          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground">
            <Mail className="w-3 h-3 flex-shrink-0" />
            <span className="truncate">{client.primaryEmail}</span>
          </div>
          {client.locationCity && (
            <div className="flex items-center gap-1 mt-0.5 text-xs text-muted-foreground">
              <MapPin className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">
                {client.locationCity}
                {client.locationRegion && `, ${client.locationRegion}`}
              </span>
            </div>
          )}
        </div>
        <StatusPill status={client.status} size="sm" />
      </div>
    </button>
  );
}
