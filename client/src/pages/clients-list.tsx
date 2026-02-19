import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TopNav } from "@/components/TopNav";
import { ClientSidePanel } from "@/components/ClientSidePanel";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, Search, Mail, MapPin, Users, LayoutGrid, List, Mail as MailIcon } from "lucide-react";
import { CreateClientDialog } from "@/components/CreateClientDialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { Client } from "@shared/schema";

function getStatusDot(status: string) {
  switch (status) {
    case "active":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs" data-testid={`status-${status}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
          <span className="text-blue-600 dark:text-blue-400">Active</span>
        </span>
      );
    case "paused":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs" data-testid={`status-${status}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
          <span className="text-amber-600 dark:text-amber-400">Paused</span>
        </span>
      );
    case "canceled":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs" data-testid={`status-${status}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-red-500" />
          <span className="text-red-600 dark:text-red-400">Churned</span>
        </span>
      );
    case "past_due":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs" data-testid={`status-${status}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-orange-500" />
          <span className="text-orange-600 dark:text-orange-400">Past Due</span>
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground" data-testid={`status-${status}`}>
          <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/50" />
          <span>{status}</span>
        </span>
      );
  }
}

function getFrequencyLabel(frequency: string) {
  switch (frequency) {
    case "weekly":
      return "Weekly";
    case "biweekly":
      return "Bi-Weekly";
    case "monthly":
      return "Monthly";
    default:
      return frequency;
  }
}

const initialsColors = [
  "bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400",
  "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400",
  "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  "bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400",
  "bg-slate-100 text-slate-700 dark:bg-slate-900/30 dark:text-slate-400",
  "bg-teal-100 text-teal-700 dark:bg-teal-900/30 dark:text-teal-400",
];

function getInitialsColor(name: string) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return initialsColors[Math.abs(hash) % initialsColors.length];
}

function getInitials(name: string) {
  return name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase();
}

export default function ClientsListPage() {
  const [filter, setFilter] = useState<"active" | "churned" | "all">("all");
  const [viewMode, setViewMode] = useState<"list" | "gallery">("list");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const { toast } = useToast();

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const createClientMutation = useMutation({
    mutationFn: (data: Partial<Client>) => apiRequest("POST", "/api/clients", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setShowCreateClient(false);
      toast({ title: "Client created" });
    },
    onError: (error) => {
      toast({ title: "Failed to create client", description: error.message, variant: "destructive" });
    },
  });

  const filteredClients = clients.filter(c => {
    const matchesFilter = filter === "all" || 
      (filter === "active" && c.subscriptionStatus === "active") ||
      (filter === "churned" && c.subscriptionStatus === "canceled");
    
    const matchesSearch = !searchQuery || 
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.primaryEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (c.locationCity && c.locationCity.toLowerCase().includes(searchQuery.toLowerCase()));
    
    return matchesFilter && matchesSearch;
  });

  const getLocation = (client: Client) => {
    if (client.locationCity && client.locationRegion) {
      return `${client.locationCity}, ${client.locationRegion}`;
    }
    return client.locationCity || client.locationRegion || null;
  };

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      
      <div className="px-8 py-6">
        <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
          <div className="flex items-center gap-4 flex-wrap">
            <h1 className="text-xl font-semibold">Clients</h1>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <TabsList>
                <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
                <TabsTrigger value="active" data-testid="tab-active">Active</TabsTrigger>
                <TabsTrigger value="churned" data-testid="tab-churned">Churned</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className={cn(viewMode === "list" && "bg-muted text-foreground")}
                onClick={() => setViewMode("list")}
                data-testid="button-view-list"
              >
                List
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className={cn(viewMode === "gallery" && "bg-muted text-foreground")}
                onClick={() => setViewMode("gallery")}
                data-testid="button-view-gallery"
              >
                Gallery
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search clients..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 w-64"
                data-testid="input-search-clients"
              />
            </div>
            <Button onClick={() => setShowCreateClient(true)} data-testid="button-new-client">
              <Plus className="w-4 h-4 mr-2" />
              New Client
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">Loading clients...</p>
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Users className="w-12 h-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">
              {searchQuery ? "No clients match your search" : "No clients found"}
            </p>
          </div>
        ) : viewMode === "gallery" ? (
          <div className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {filteredClients.map((client) => (
              <Card
                key={client.id}
                className="p-3 hover-elevate cursor-pointer border"
                onClick={() => setSelectedClientId(client.id)}
                data-testid={`client-card-${client.id}`}
              >
                <div className="flex flex-col items-center text-center gap-2">
                  <div className={`w-10 h-10 rounded-md flex items-center justify-center text-xs font-medium flex-shrink-0 ${getInitialsColor(client.name)}`}>
                    {getInitials(client.name)}
                  </div>
                  <div className="min-w-0 w-full">
                    <p className="font-medium text-sm truncate">{client.name}</p>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{client.primaryEmail}</p>
                  </div>
                  <div className="w-full pt-1 border-t border-border/30">
                    <div className="flex items-center justify-center gap-1.5">
                      {getStatusDot(client.subscriptionStatus)}
                      <span className="text-xs text-muted-foreground">
                        {getFrequencyLabel(client.newsletterFrequency)}
                      </span>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div>
            <div className="grid grid-cols-[1fr_200px_120px_100px] gap-4 px-3 py-2 border-b">
              <span className="text-sm font-medium text-muted-foreground">Client</span>
              <span className="text-sm font-medium text-muted-foreground">Location</span>
              <span className="text-sm font-medium text-muted-foreground">Frequency</span>
              <span className="text-sm font-medium text-muted-foreground">Status</span>
            </div>
            <div className="space-y-px">
              {filteredClients.map((client) => (
                <div
                  key={client.id}
                  className="grid grid-cols-[1fr_200px_120px_100px] gap-4 px-3 py-3 hover-elevate cursor-pointer items-center rounded-md"
                  onClick={() => setSelectedClientId(client.id)}
                  data-testid={`client-row-${client.id}`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedClientId(client.id)}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{client.name}</div>
                    <div className="text-sm text-muted-foreground truncate">
                      {client.primaryEmail}
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground truncate">
                    {getLocation(client) || "—"}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {getFrequencyLabel(client.newsletterFrequency)}
                  </div>
                  <div>
                    {getStatusDot(client.subscriptionStatus)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {selectedClientId && (
        <ClientSidePanel
          clientId={selectedClientId}
          open={!!selectedClientId}
          onClose={() => setSelectedClientId(null)}
        />
      )}

      <CreateClientDialog
        open={showCreateClient}
        onClose={() => setShowCreateClient(false)}
        onSubmit={async (data) => {
          await createClientMutation.mutateAsync(data);
        }}
        isSubmitting={createClientMutation.isPending}
      />
    </div>
  );
}
