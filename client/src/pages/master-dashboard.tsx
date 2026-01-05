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
  LayoutGrid,
  List,
  ChevronLeft,
  ChevronRight,
  Circle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Client, Newsletter } from "@shared/schema";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isSameMonth, isSameDay, addMonths, subMonths, getDay, parseISO } from "date-fns";

type ViewMode = "grid" | "list" | "calendar";

export default function MasterDashboard() {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [calendarDate, setCalendarDate] = useState(new Date());

  const { data: clients, isLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: newsletters } = useQuery<Newsletter[]>({
    queryKey: ["/api/newsletters"],
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

  const getNewsletterStatusColor = (status: string) => {
    switch (status) {
      case "not_started":
        return "text-muted-foreground";
      case "in_progress":
        return "text-blue-500";
      case "internal_review":
        return "text-purple-500";
      case "client_review":
        return "text-amber-500";
      case "revisions":
        return "text-orange-500";
      case "approved":
        return "text-emerald-500";
      case "sent":
        return "text-emerald-600";
      default:
        return "text-muted-foreground";
    }
  };

  const monthStart = startOfMonth(calendarDate);
  const monthEnd = endOfMonth(calendarDate);
  const calendarDays = eachDayOfInterval({ start: monthStart, end: monthEnd });
  const startingDayOfWeek = getDay(monthStart);

  const getNewslettersForDay = (day: Date) => {
    if (!newsletters) return [];
    return newsletters.filter((nl) => {
      if (nl.expectedSendDate) {
        return isSameDay(parseISO(nl.expectedSendDate as unknown as string), day);
      }
      return false;
    });
  };

  const getClientById = (clientId: string) => {
    return clients?.find((c) => c.id === clientId);
  };

  const renderGridView = () => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {filteredClients?.map((client) => (
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
  );

  const renderListView = () => (
    <div className="space-y-2">
      <div className="grid grid-cols-[1fr_150px_150px_100px] gap-4 px-4 py-2 text-sm font-medium text-muted-foreground border-b">
        <span>Client</span>
        <span>Location</span>
        <span>Plan</span>
        <span>Status</span>
      </div>
      {filteredClients?.map((client) => (
        <div
          key={client.id}
          className="grid grid-cols-[1fr_150px_150px_100px] gap-4 px-4 py-3 hover-elevate cursor-pointer rounded-md items-center"
          onClick={() => setLocation(`/clients/${client.id}`)}
          data-testid={`row-client-${client.id}`}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => e.key === "Enter" && setLocation(`/clients/${client.id}`)}
        >
          <div className="min-w-0">
            <span className="font-medium truncate block">{client.name}</span>
            <span className="text-xs text-muted-foreground truncate block">{client.primaryEmail}</span>
          </div>
          <span className="text-sm text-muted-foreground truncate">
            {getClientLocation(client) || "-"}
          </span>
          <span className="text-sm text-muted-foreground">
            {getPlanLabel(client.newsletterFrequency)}
          </span>
          <Badge 
            variant="secondary" 
            className={`text-xs capitalize ${getStatusColor(client.subscriptionStatus)}`}
          >
            {client.subscriptionStatus}
          </Badge>
        </div>
      ))}
    </div>
  );

  const renderCalendarView = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">
          {format(calendarDate, "MMMM yyyy")}
        </h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCalendarDate(subMonths(calendarDate, 1))}
            data-testid="button-calendar-prev"
          >
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setCalendarDate(new Date())}
            data-testid="button-calendar-today"
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCalendarDate(addMonths(calendarDate, 1))}
            data-testid="button-calendar-next"
          >
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="border rounded-md overflow-hidden">
        <div className="grid grid-cols-7 text-center text-sm font-medium text-muted-foreground border-b">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div key={day} className="py-2">{day}</div>
          ))}
        </div>
        <div className="grid grid-cols-7">
          {Array.from({ length: startingDayOfWeek }).map((_, i) => (
            <div key={`empty-${i}`} className="h-28 border-b border-r bg-muted/30" />
          ))}
          {calendarDays.map((day, i) => {
            const dayNewsletters = getNewslettersForDay(day);
            const isToday = isSameDay(day, new Date());
            
            return (
              <div
                key={day.toISOString()}
                className={`h-28 border-b border-r p-1 ${
                  !isSameMonth(day, calendarDate) ? "bg-muted/30" : ""
                } ${isToday ? "bg-primary/5" : ""}`}
              >
                <div className={`text-sm font-medium mb-1 ${isToday ? "text-primary" : "text-muted-foreground"}`}>
                  {format(day, "d")}
                </div>
                <div className="space-y-1 overflow-y-auto max-h-20">
                  {dayNewsletters.slice(0, 3).map((nl) => {
                    const client = getClientById(nl.clientId);
                    return (
                      <div
                        key={nl.id}
                        className="text-xs px-1.5 py-0.5 rounded bg-muted/50 truncate cursor-pointer hover-elevate"
                        onClick={() => setLocation(`/clients/${nl.clientId}`)}
                        data-testid={`calendar-item-${nl.id}`}
                      >
                        <Circle className={`w-2 h-2 inline-block mr-1 fill-current ${getNewsletterStatusColor(nl.status)}`} />
                        <span className="text-muted-foreground">{client?.name || "Client"}</span>
                      </div>
                    );
                  })}
                  {dayNewsletters.length > 3 && (
                    <div className="text-xs text-muted-foreground px-1.5">
                      +{dayNewsletters.length - 3} more
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1">
          <Circle className="w-2 h-2 fill-current text-blue-500" />
          <span>In Progress</span>
        </div>
        <div className="flex items-center gap-1">
          <Circle className="w-2 h-2 fill-current text-amber-500" />
          <span>Client Review</span>
        </div>
        <div className="flex items-center gap-1">
          <Circle className="w-2 h-2 fill-current text-emerald-500" />
          <span>Approved</span>
        </div>
      </div>
    </div>
  );

  const renderEmptyState = () => (
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
  );

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
        <div className="flex items-center justify-between gap-4 mb-8 flex-wrap">
          <div className="relative flex-1 max-w-md min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search clients..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10"
              data-testid="input-search-clients"
            />
          </div>
          
          <div className="flex items-center gap-2">
            <div className="flex items-center border rounded-md p-0.5">
              <Button
                variant={viewMode === "grid" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("grid")}
                data-testid="button-view-grid"
                className="gap-1.5"
              >
                <LayoutGrid className="w-4 h-4" />
                <span className="hidden sm:inline">Grid</span>
              </Button>
              <Button
                variant={viewMode === "list" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("list")}
                data-testid="button-view-list"
                className="gap-1.5"
              >
                <List className="w-4 h-4" />
                <span className="hidden sm:inline">List</span>
              </Button>
              <Button
                variant={viewMode === "calendar" ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setViewMode("calendar")}
                data-testid="button-view-calendar"
                className="gap-1.5"
              >
                <Calendar className="w-4 h-4" />
                <span className="hidden sm:inline">Calendar</span>
              </Button>
            </div>

            <Button onClick={() => setShowCreateClient(true)} className="glow-green-hover" data-testid="button-add-client">
              <Plus className="w-4 h-4 mr-2" />
              Add Client
            </Button>
          </div>
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
          viewMode === "grid" ? renderGridView() :
          viewMode === "list" ? renderListView() :
          renderCalendarView()
        ) : (
          renderEmptyState()
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
