import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { TopNav } from "@/components/TopNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LayoutGrid, List, Calendar, ChevronRight, Plus, Search, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import type { Newsletter, Client, Subscription, Invoice } from "@shared/schema";

const STATUS_DOT_COLORS: Record<string, string> = {
  not_started: "bg-gray-300",
  in_progress: "bg-blue-400",
  revisions: "bg-orange-400",
  internal_review: "bg-purple-400",
  client_review: "bg-yellow-400",
  approved: "bg-green-400",
  sent: "bg-emerald-600",
};

const NEWSLETTER_STATUSES = [
  { value: "not_started", label: "Not Started", color: "bg-muted text-muted-foreground" },
  { value: "in_progress", label: "In Progress", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  { value: "revisions", label: "Revisions", color: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  { value: "internal_review", label: "Internal Review", color: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
  { value: "client_review", label: "Client Review", color: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" },
  { value: "approved", label: "Approved", color: "bg-green-500/10 text-green-600 dark:text-green-400" },
  { value: "sent", label: "Sent", color: "bg-primary/10 text-primary" },
] as const;

type NewsletterWithClient = Newsletter & { client: Client };

function DraggableNewsletterCard({ newsletter }: { newsletter: NewsletterWithClient }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: newsletter.id,
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    zIndex: isDragging ? 100 : undefined,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <Link href={`/newsletters/${newsletter.id}`}>
        <Card
          className="p-3 hover-elevate cursor-pointer"
          data-testid={`newsletter-card-${newsletter.id}`}
        >
          <div className="flex flex-col gap-1.5">
            <p className="font-medium text-sm line-clamp-1">{newsletter.client.name}</p>
            <p className="text-xs text-muted-foreground">
              {newsletter.expectedSendDate 
                ? format(new Date(newsletter.expectedSendDate), "MMM d")
                : "No date set"
              }
            </p>
          </div>
        </Card>
      </Link>
    </div>
  );
}

function StatusColumn({ status, newsletters }: { status: typeof NEWSLETTER_STATUSES[number]; newsletters: NewsletterWithClient[] }) {
  const { setNodeRef, isOver } = useDroppable({
    id: status.value,
  });

  const dotColor = STATUS_DOT_COLORS[status.value] || "bg-gray-300";

  return (
    <div 
      ref={setNodeRef} 
      className={`flex-shrink-0 w-60 min-h-[300px] rounded-lg transition-colors ${isOver ? 'bg-primary/5' : ''}`}
    >
      <div className="flex items-center gap-2 mb-4 px-1" data-testid={`board-column-${status.value}`}>
        <span className={`w-2 h-2 rounded-full ${dotColor} flex-shrink-0`} />
        <span className="text-xs font-medium text-muted-foreground">
          {status.label} ({newsletters.length})
        </span>
      </div>
      <div className="space-y-2">
        {newsletters.map((newsletter) => (
          <DraggableNewsletterCard key={newsletter.id} newsletter={newsletter} />
        ))}
      </div>
    </div>
  );
}

function BoardView({ newsletters, onStatusChange }: { newsletters: NewsletterWithClient[]; onStatusChange: (id: string, status: string) => void }) {
  const ongoingStatuses = NEWSLETTER_STATUSES.filter(s => s.value !== "sent");
  const [activeNewsletter, setActiveNewsletter] = useState<NewsletterWithClient | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const newsletter = newsletters.find(n => n.id === event.active.id);
    if (newsletter) {
      setActiveNewsletter(newsletter);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveNewsletter(null);

    if (over && active.id !== over.id) {
      const newStatus = over.id as string;
      const currentNewsletter = newsletters.find(n => n.id === active.id);
      if (currentNewsletter && currentNewsletter.status !== newStatus) {
        onStatusChange(active.id as string, newStatus);
      }
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-6 overflow-x-auto pb-4 pt-2">
        {ongoingStatuses.map((status) => {
          const statusNewsletters = newsletters.filter(n => n.status === status.value);
          return (
            <StatusColumn key={status.value} status={status} newsletters={statusNewsletters} />
          );
        })}
      </div>
      <DragOverlay>
        {activeNewsletter ? (
          <Card className="p-3 shadow-lg border-primary/30 w-60">
            <div className="flex flex-col gap-1.5">
              <p className="font-medium text-sm line-clamp-1">{activeNewsletter.client.name}</p>
              <p className="text-xs text-muted-foreground">
                {activeNewsletter.expectedSendDate 
                  ? format(new Date(activeNewsletter.expectedSendDate), "MMM d")
                  : "No date set"
                }
              </p>
            </div>
          </Card>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

function TableView({ newsletters, onStatusChange }: { newsletters: NewsletterWithClient[]; onStatusChange: (id: string, status: string) => void }) {
  return (
    <div className="rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b">
            <th className="text-left p-3 text-xs font-medium text-muted-foreground">Client</th>
            <th className="text-left p-3 text-xs font-medium text-muted-foreground">Title</th>
            <th className="text-left p-3 text-xs font-medium text-muted-foreground">Due Date</th>
            <th className="text-left p-3 text-xs font-medium text-muted-foreground">Status</th>
          </tr>
        </thead>
        <tbody>
          {newsletters.map((newsletter) => (
            <tr key={newsletter.id} className="border-b border-border/50 hover:bg-muted/20" data-testid={`newsletter-row-${newsletter.id}`}>
              <td className="p-3">
                <Link href={`/newsletters/${newsletter.id}`} className="hover:underline font-medium">
                  {newsletter.client.name}
                </Link>
              </td>
              <td className="p-3 text-muted-foreground">{newsletter.title}</td>
              <td className="p-3 text-muted-foreground">
                {format(new Date(newsletter.expectedSendDate), "MMM d, yyyy")}
              </td>
              <td className="p-3">
                <Select
                  value={newsletter.status}
                  onValueChange={(value) => onStatusChange(newsletter.id, value)}
                >
                  <SelectTrigger className="h-8 w-40" data-testid={`status-trigger-table-${newsletter.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NEWSLETTER_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${STATUS_DOT_COLORS[s.value] || "bg-gray-300"}`} />
                          {s.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function NewslettersPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [view, setView] = useState<"board" | "table">("board");
  const [filter, setFilter] = useState<"ongoing" | "sent" | "all">("ongoing");
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [clientSearch, setClientSearch] = useState("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [importedHtml, setImportedHtml] = useState("");

  const { data: newsletters = [], isLoading } = useQuery<NewsletterWithClient[]>({
    queryKey: ["/api/newsletters"],
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: invoices = [] } = useQuery<(Invoice & { client?: Client })[]>({
    queryKey: ["/api/invoices"],
  });

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(clientSearch.toLowerCase()) ||
    c.primaryEmail.toLowerCase().includes(clientSearch.toLowerCase())
  ).slice(0, 8);

  const getFrequencyLabel = (frequency?: string) => {
    switch (frequency) {
      case "weekly": return "Weekly";
      case "biweekly": return "Bi-Weekly";
      case "monthly": return "Monthly";
      default: return frequency || "Monthly";
    }
  };

  const handleCreateNewsletter = async () => {
    if (!selectedClient) return;
    setIsCreating(true);
    try {
      const frequency = selectedClient.newsletterFrequency || "monthly";
      const title = `${selectedClient.name} - ${getFrequencyLabel(frequency)}`;
      
      const res = await apiRequest("POST", `/api/clients/${selectedClient.id}/newsletters`, {
        title,
        invoiceId: selectedInvoice?.id || null,
        isUnpaid: !selectedInvoice,
        expectedSendDate: new Date().toISOString().split("T")[0],
        status: "not_started",
        importedHtml: importedHtml.trim() || undefined,
      });
      
      if (!res.ok) throw new Error("Failed to create newsletter");
      
      const newsletter = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
      toast({ title: "Newsletter created" });
      setShowCreateDialog(false);
      setSelectedClient(null);
      setSelectedInvoice(null);
      setClientSearch("");
      setLocation(`/newsletters/${newsletter.id}`);
    } catch (error) {
      toast({ title: "Failed to create newsletter", variant: "destructive" });
    } finally {
      setIsCreating(false);
    }
  };

  const clientInvoices = selectedClient 
    ? invoices.filter(inv => inv.clientId === selectedClient.id && inv.status !== "paid")
    : [];

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return apiRequest("PATCH", `/api/newsletters/${id}`, { status });
    },
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/newsletters"] });
      const previousNewsletters = queryClient.getQueryData<NewsletterWithClient[]>(["/api/newsletters"]);
      queryClient.setQueryData<NewsletterWithClient[]>(["/api/newsletters"], (old) =>
        old?.map((n) => (n.id === id ? { ...n, status: status as Newsletter["status"] } : n))
      );
      return { previousNewsletters };
    },
    onError: (err, variables, context) => {
      if (context?.previousNewsletters) {
        queryClient.setQueryData(["/api/newsletters"], context.previousNewsletters);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
    },
  });

  const filteredNewsletters = newsletters.filter(n => {
    if (filter === "ongoing") return n.status !== "sent";
    if (filter === "sent") return n.status === "sent";
    return true;
  });

  const handleStatusChange = (id: string, status: string) => {
    updateStatusMutation.mutate({ id, status });
  };

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      
      <div className="px-8 py-6">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-xl font-semibold">Newsletters</h1>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant={view === "board" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setView("board")}
              data-testid="button-view-board"
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
            <Button
              variant={view === "table" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setView("table")}
              data-testid="button-view-table"
            >
              <List className="w-4 h-4" />
            </Button>
            <div className="w-px h-5 bg-border mx-1" />
            <Button onClick={() => setShowCreateDialog(true)} data-testid="button-new-newsletter">
              <Plus className="w-4 h-4 mr-2" />
              New Newsletter
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-4 mb-6">
          <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
            <TabsList>
              <TabsTrigger value="ongoing" data-testid="tab-ongoing">Ongoing</TabsTrigger>
              <TabsTrigger value="sent" data-testid="tab-sent">Sent</TabsTrigger>
              <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">Loading newsletters...</p>
          </div>
        ) : filteredNewsletters.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Calendar className="w-12 h-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">No newsletters found</p>
          </div>
        ) : view === "board" ? (
          <div className="h-[calc(100vh-200px)] overflow-auto">
            <BoardView newsletters={filteredNewsletters} onStatusChange={handleStatusChange} />
          </div>
        ) : (
          <TableView newsletters={filteredNewsletters} onStatusChange={handleStatusChange} />
        )}
      </div>

      <Dialog open={showCreateDialog} onOpenChange={(open) => {
        setShowCreateDialog(open);
        if (!open) {
          setSelectedClient(null);
          setSelectedInvoice(null);
          setClientSearch("");
          setImportedHtml("");
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New Newsletter</DialogTitle>
            <DialogDescription>
              {selectedClient ? `Creating for ${selectedClient.name}` : "Select a client to create a newsletter"}
            </DialogDescription>
          </DialogHeader>

          {!selectedClient ? (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Search clients..."
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  className="pl-10"
                  data-testid="input-search-client"
                  autoFocus
                />
              </div>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {filteredClients.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No clients found</p>
                ) : (
                  filteredClients.map((client) => (
                    <button
                      key={client.id}
                      type="button"
                      className="w-full text-left p-3 rounded-md hover-elevate flex items-center justify-between"
                      onClick={() => setSelectedClient(client)}
                      data-testid={`client-option-${client.id}`}
                    >
                      <div>
                        <p className="font-medium">{client.name}</p>
                        <p className="text-xs text-muted-foreground">{client.primaryEmail}</p>
                      </div>
                      <Badge variant="outline" className="text-xs">
                        {getFrequencyLabel(client.newsletterFrequency)}
                      </Badge>
                    </button>
                  ))
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="p-3 rounded-md bg-muted/30 flex items-center justify-between">
                <div>
                  <p className="font-medium">{selectedClient.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedClient.name} - {getFrequencyLabel(selectedClient.newsletterFrequency)}
                  </p>
                </div>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setSelectedClient(null)}
                  data-testid="button-change-client"
                >
                  Change
                </Button>
              </div>

              {clientInvoices.length > 0 && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Link to Order (optional)</label>
                  <div className="space-y-1">
                    <button
                      type="button"
                      className={`w-full text-left p-2 rounded-md border ${!selectedInvoice ? 'border-primary bg-primary/5' : 'hover-elevate'}`}
                      onClick={() => setSelectedInvoice(null)}
                      data-testid="invoice-option-none"
                    >
                      <p className="text-sm">No order (mark as unpaid)</p>
                    </button>
                    {clientInvoices.map((inv) => (
                      <button
                        key={inv.id}
                        type="button"
                        className={`w-full text-left p-2 rounded-md border ${selectedInvoice?.id === inv.id ? 'border-primary bg-primary/5' : 'hover-elevate'}`}
                        onClick={() => setSelectedInvoice(inv)}
                        data-testid={`invoice-option-${inv.id}`}
                      >
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">Order #{inv.id.slice(0, 8)}</p>
                          <p className="text-sm">${Number(inv.amount).toFixed(2)}</p>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(inv.createdAt), "MMM d, yyyy")}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {clientInvoices.length === 0 && (
                <div className="p-3 rounded-md bg-amber-500/10 border border-amber-500/20">
                  <p className="text-sm text-amber-600 dark:text-amber-400">
                    No unpaid orders found. This newsletter will be marked as unpaid.
                  </p>
                </div>
              )}

              <div className="space-y-2 pt-2 border-t">
                <label className="text-sm font-medium">Import HTML (optional)</label>
                <Textarea
                  placeholder="Paste your email HTML here..."
                  value={importedHtml}
                  onChange={(e) => setImportedHtml(e.target.value)}
                  className="min-h-[100px] font-mono text-xs"
                  data-testid="textarea-import-html"
                />
              </div>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              Cancel
            </Button>
            <Button 
              onClick={handleCreateNewsletter} 
              disabled={!selectedClient || isCreating}
              data-testid="button-create-newsletter"
            >
              {isCreating && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Create Newsletter
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
