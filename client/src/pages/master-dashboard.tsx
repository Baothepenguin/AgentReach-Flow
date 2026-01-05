import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { CreateClientDialog } from "@/components/CreateClientDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  LogOut,
  User,
  ChevronDown,
  Search,
  MapPin,
  Calendar,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Client } from "@shared/schema";
import { format } from "date-fns";

export default function MasterDashboard() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const { data: clients, isLoading } = useQuery<Client[]>({
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

  const getClientLocation = (client: Client) => {
    if (client.locationCity && client.locationRegion) {
      return `${client.locationCity}, ${client.locationRegion}`;
    }
    return client.locationCity || client.locationRegion || null;
  };

  const getPlanLabel = (frequency: string) => {
    return frequency === "weekly" ? "Established" : "Starter";
  };

  const filteredClients = clients?.filter((client) => {
    const location = getClientLocation(client);
    return (
      client.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      client.primaryEmail.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (location && location.toLowerCase().includes(searchQuery.toLowerCase()))
    );
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":
        return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400";
      case "paused":
        return "bg-amber-500/10 text-amber-600 dark:text-amber-400";
      case "cancelled":
        return "bg-red-500/10 text-red-600 dark:text-red-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 flex items-center justify-between gap-4 px-6 h-14 border-b bg-background/80 glass-surface">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold">Clients</span>
          <Badge variant="secondary" className="text-xs">
            {clients?.length || 0}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="gap-2" data-testid="button-user-menu">
                <User className="w-4 h-4" />
                <span className="hidden sm:inline">{user?.name}</span>
                <ChevronDown className="w-3 h-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem disabled>
                <span className="text-xs text-muted-foreground">{user?.email}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={logout} data-testid="button-logout">
                <LogOut className="w-4 h-4 mr-2" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between gap-4 mb-8">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search clients..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-clients"
            />
          </div>
          <Button onClick={() => setShowCreateClient(true)} className="glow-green-hover" data-testid="button-add-client">
            <Plus className="w-4 h-4 mr-2" />
            Add Client
          </Button>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-6">
                  <Skeleton className="h-6 w-32 mb-4" />
                  <Skeleton className="h-4 w-48 mb-2" />
                  <Skeleton className="h-4 w-24" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : filteredClients && filteredClients.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredClients.map((client) => (
              <Card
                key={client.id}
                className="cursor-pointer hover-elevate glow-green-hover transition-all overflow-visible"
                onClick={() => setLocation(`/clients/${client.id}`)}
                data-testid={`card-client-${client.id}`}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => e.key === "Enter" && setLocation(`/clients/${client.id}`)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-base truncate">{client.name}</h3>
                      {getClientLocation(client) && (
                        <div className="flex items-center gap-1 text-sm text-muted-foreground mt-0.5">
                          <MapPin className="w-3 h-3 flex-shrink-0" />
                          <span className="truncate">{getClientLocation(client)}</span>
                        </div>
                      )}
                    </div>
                    <Badge 
                      variant="secondary" 
                      className={`flex-shrink-0 text-xs capitalize ${getStatusColor(client.subscriptionStatus)}`}
                    >
                      {client.subscriptionStatus}
                    </Badge>
                  </div>
                  
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{getPlanLabel(client.newsletterFrequency)}</span>
                    {client.createdAt && (
                      <span className="text-xs text-muted-foreground/70">
                        Since {format(new Date(client.createdAt), "MMM yyyy")}
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <div className="text-center py-16">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-muted flex items-center justify-center">
              <User className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-medium mb-2">
              {searchQuery ? "No clients found" : "No clients yet"}
            </h3>
            <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
              {searchQuery
                ? "Try adjusting your search terms"
                : "Add your first client to start creating newsletters"}
            </p>
            {!searchQuery && (
              <Button onClick={() => setShowCreateClient(true)} className="glow-green-hover" data-testid="button-add-first-client">
                <Plus className="w-4 h-4 mr-2" />
                Add Your First Client
              </Button>
            )}
          </div>
        )}
      </main>

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
