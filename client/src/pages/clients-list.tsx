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
import { Plus, Search, Mail, MapPin, Users, LayoutGrid, List } from "lucide-react";
import { CreateClientDialog } from "@/components/CreateClientDialog";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Client } from "@shared/schema";

function getStatusBadge(status: string) {
  switch (status) {
    case "active":
      return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs">Active</Badge>;
    case "paused":
      return <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs">Paused</Badge>;
    case "canceled":
      return <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 text-xs">Churned</Badge>;
    case "past_due":
      return <Badge className="bg-orange-500/10 text-orange-600 dark:text-orange-400 text-xs">Past Due</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
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
      
      <div className="p-6">
        <div className="flex items-center justify-between gap-4 mb-6 flex-wrap">
          <div className="flex items-center gap-4 flex-wrap">
            <h1 className="text-2xl font-semibold">Clients</h1>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <TabsList>
                <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
                <TabsTrigger value="active" data-testid="tab-active">Active</TabsTrigger>
                <TabsTrigger value="churned" data-testid="tab-churned">Churned</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1 bg-muted rounded-md p-0.5">
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2"
                onClick={() => setViewMode("list")}
                data-testid="button-view-list"
              >
                <List className="w-4 h-4" />
              </Button>
              <Button
                variant={viewMode === "gallery" ? "secondary" : "ghost"}
                size="sm"
                className="h-7 px-2"
                onClick={() => setViewMode("gallery")}
                data-testid="button-view-gallery"
              >
                <LayoutGrid className="w-4 h-4" />
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
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
            {filteredClients.map((client) => (
              <Card
                key={client.id}
                className="p-4 hover-elevate cursor-pointer"
                onClick={() => setSelectedClientId(client.id)}
                data-testid={`client-card-${client.id}`}
              >
                <div className="flex flex-col items-center text-center gap-3">
                  <Avatar className="w-16 h-16">
                    <AvatarFallback className="text-lg bg-primary/10 text-primary">
                      {client.name.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 w-full">
                    <p className="font-medium truncate">{client.name}</p>
                    <p className="text-xs text-muted-foreground truncate">{client.primaryEmail}</p>
                    {getLocation(client) && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-center justify-center gap-1">
                        <MapPin className="w-3 h-3" />
                        {getLocation(client)}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {getStatusBadge(client.subscriptionStatus)}
                    <Badge variant="outline" className="text-xs">
                      {getFrequencyLabel(client.newsletterFrequency)}
                    </Badge>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="border rounded-md overflow-hidden">
            <div className="grid grid-cols-[1fr_200px_120px_100px] gap-4 px-4 py-3 text-sm font-medium text-muted-foreground bg-muted/30 border-b">
              <span>Client</span>
              <span>Location</span>
              <span>Frequency</span>
              <span>Status</span>
            </div>
            <div className="divide-y">
              {filteredClients.map((client) => (
                <div
                  key={client.id}
                  className="grid grid-cols-[1fr_200px_120px_100px] gap-4 px-4 py-3 hover-elevate cursor-pointer items-center"
                  onClick={() => setSelectedClientId(client.id)}
                  data-testid={`client-row-${client.id}`}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => e.key === "Enter" && setSelectedClientId(client.id)}
                >
                  <div className="min-w-0">
                    <div className="font-medium truncate">{client.name}</div>
                    <div className="flex items-center gap-1 text-sm text-muted-foreground">
                      <Mail className="w-3 h-3 flex-shrink-0" />
                      <span className="truncate">{client.primaryEmail}</span>
                    </div>
                  </div>
                  <div className="text-sm text-muted-foreground truncate">
                    {getLocation(client) ? (
                      <span className="flex items-center gap-1">
                        <MapPin className="w-3 h-3 flex-shrink-0" />
                        {getLocation(client)}
                      </span>
                    ) : (
                      "—"
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {getFrequencyLabel(client.newsletterFrequency)}
                  </div>
                  <div>
                    {getStatusBadge(client.subscriptionStatus)}
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
