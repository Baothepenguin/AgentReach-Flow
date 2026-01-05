import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { ClientCard } from "./ClientCard";
import { Search, Plus, Users, Filter } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Client } from "@shared/schema";
import type { ClientStatus } from "@/lib/types";

interface ClientSidebarProps {
  selectedClientId: string | null;
  onSelectClient: (clientId: string) => void;
  onCreateClient: () => void;
}

const STATUS_OPTIONS: { value: ClientStatus; label: string }[] = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "past_due", label: "Past Due" },
  { value: "canceled", label: "Canceled" },
];

export function ClientSidebar({ selectedClientId, onSelectClient, onCreateClient }: ClientSidebarProps) {
  const [search, setSearch] = useState("");
  const [statusFilters, setStatusFilters] = useState<ClientStatus[]>(["active", "paused", "past_due"]);

  const { data: clients, isLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const filteredClients = clients?.filter((client) => {
    const matchesSearch =
      client.name.toLowerCase().includes(search.toLowerCase()) ||
      client.primaryEmail.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilters.length === 0 || statusFilters.includes(client.subscriptionStatus as ClientStatus);
    return matchesSearch && matchesStatus;
  });

  const toggleStatus = (status: ClientStatus) => {
    setStatusFilters((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status]
    );
  };

  return (
    <div className="flex flex-col h-full bg-sidebar border-r border-sidebar-border">
      <div className="p-4 border-b border-sidebar-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5 text-muted-foreground" />
            <h2 className="font-semibold text-sm">Clients</h2>
            {clients && (
              <span className="text-xs text-muted-foreground">({filteredClients?.length || 0})</span>
            )}
          </div>
          <Button
            size="icon"
            variant="ghost"
            onClick={onCreateClient}
            data-testid="button-create-client"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search clients..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-9 text-sm"
              data-testid="input-search-clients"
            />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon"
                variant={statusFilters.length < 4 ? "secondary" : "ghost"}
                data-testid="button-filter-clients"
              >
                <Filter className="w-4 h-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {STATUS_OPTIONS.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.value}
                  checked={statusFilters.includes(option.value)}
                  onCheckedChange={() => toggleStatus(option.value)}
                >
                  {option.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="p-3">
                <Skeleton className="h-4 w-3/4 mb-2" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))
          ) : filteredClients?.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              {search ? "No clients match your search" : "No clients yet"}
            </div>
          ) : (
            filteredClients?.map((client) => (
              <ClientCard
                key={client.id}
                client={client}
                isSelected={client.id === selectedClientId}
                onClick={() => onSelectClient(client.id)}
              />
            ))
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
