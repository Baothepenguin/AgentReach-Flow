import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { TopNav } from "@/components/TopNav";
import { RightPanel } from "@/components/RightPanel";
import { HTMLPreviewFrame } from "@/components/HTMLPreviewFrame";
import { CreateNewsletterDialog } from "@/components/CreateNewsletterDialog";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Plus,
  ChevronLeft,
  Send,
  Download,
  Copy,
  ExternalLink,
  Mail,
  Phone,
  MapPin,
  Calendar,
  FileText,
  Edit2,
  Check,
  X,
  Receipt,
  CreditCard,
  Palette,
  Users,
  ArrowDownLeft,
  ArrowUpRight,
  Trash2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Client, Newsletter, NewsletterVersion, NewsletterDocument, BrandingKit, Project, TasksFlags, Subscription, Invoice, ClientNote } from "@shared/schema";
import { format } from "date-fns";

interface EmailItem {
  id: string;
  subject: string;
  snippet: string;
  date: string;
  isInbound: boolean;
  threadId: string;
}

function ClientEmailsList({ clientId }: { clientId: string }) {
  const { data: gmailStatus } = useQuery<{ connected: boolean }>({
    queryKey: ["/api/gmail/status"],
  });

  const { data: emails = [], isLoading } = useQuery<EmailItem[]>({
    queryKey: ["/api/clients", clientId, "emails"],
    enabled: !!gmailStatus?.connected,
  });

  if (!gmailStatus?.connected) {
    return (
      <div className="text-center py-8">
        <Mail className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground" data-testid="text-gmail-not-connected">Gmail not connected</p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-2 p-1">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (emails.length === 0) {
    return (
      <div className="text-center py-8">
        <Mail className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
        <p className="text-sm text-muted-foreground" data-testid="text-no-emails">No emails found</p>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {emails.map((email) => (
        <div key={email.id} className="p-2 rounded-md hover-elevate cursor-pointer" data-testid={`email-${email.id}`}>
          <div className="flex items-center gap-2 mb-0.5">
            {email.isInbound ? (
              <ArrowDownLeft className="w-3 h-3 text-blue-500 flex-shrink-0" />
            ) : (
              <ArrowUpRight className="w-3 h-3 text-green-500 flex-shrink-0" />
            )}
            <span className="text-sm font-medium truncate">{email.subject || "(No subject)"}</span>
          </div>
          <p className="text-xs text-muted-foreground line-clamp-2 pl-5">{email.snippet}</p>
          <p className="text-xs text-muted-foreground/60 pl-5 mt-0.5">
            {email.date ? format(new Date(email.date), "MMM d, yyyy") : ""}
          </p>
        </div>
      ))}
    </div>
  );
}

function ClientNotesPanel({ clientId }: { clientId: string }) {
  const [newNoteContent, setNewNoteContent] = useState("");
  const [noteType, setNoteType] = useState<"note" | "task">("note");

  const { data: notes = [], isLoading } = useQuery<ClientNote[]>({
    queryKey: ["/api/clients", clientId, "notes"],
  });

  const createNoteMutation = useMutation({
    mutationFn: async (data: { content: string; type: string }) => {
      return apiRequest("POST", `/api/clients/${clientId}/notes`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "notes"] });
    },
  });

  const updateNoteMutation = useMutation({
    mutationFn: async (data: { id: string; isCompleted: boolean }) => {
      return apiRequest("PATCH", `/api/notes/${data.id}`, { isCompleted: data.isCompleted });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "notes"] });
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/notes/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "notes"] });
    },
  });

  return (
    <div>
      <div className="flex items-center gap-1 mb-3 px-1">
        <Input
          placeholder="Add a note or task..."
          value={newNoteContent}
          onChange={(e) => setNewNoteContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newNoteContent.trim()) {
              createNoteMutation.mutate({ content: newNoteContent.trim(), type: noteType });
              setNewNoteContent("");
            }
          }}
          className="h-8 text-sm flex-1"
          data-testid="input-new-note"
        />
        <Select value={noteType} onValueChange={(v) => setNoteType(v as "note" | "task")}>
          <SelectTrigger className="h-8 w-20 text-xs" data-testid="select-note-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="note">Note</SelectItem>
            <SelectItem value="task">Task</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2 p-1">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : notes.length === 0 ? (
        <div className="text-center py-8">
          <FileText className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
          <p className="text-sm text-muted-foreground" data-testid="text-no-notes">No notes yet</p>
        </div>
      ) : (
        <div className="space-y-0.5">
          {notes.map((note) => (
            <div key={note.id} className="flex items-start gap-2 p-2 rounded-md group" data-testid={`note-${note.id}`}>
              {note.type === "task" && (
                <Checkbox
                  checked={note.isCompleted}
                  onCheckedChange={(checked) => updateNoteMutation.mutate({ id: note.id, isCompleted: !!checked })}
                  className="mt-0.5"
                  data-testid={`checkbox-note-${note.id}`}
                />
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${note.type === "task" && note.isCompleted ? "line-through text-muted-foreground" : ""}`}>
                  {note.content}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">
                  {format(new Date(note.createdAt), "MMM d")}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="invisible group-hover:visible"
                onClick={() => deleteNoteMutation.mutate(note.id)}
                data-testid={`delete-note-${note.id}`}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

interface ClientProfilePageProps {
  clientId: string;
}

export default function ClientProfilePage({ clientId }: ClientProfilePageProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedNewsletterId, setSelectedNewsletterId] = useState<string | null>(null);
  const [showCreateNewsletter, setShowCreateNewsletter] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<"campaigns" | "orders" | "emails" | "notes" | "info">("campaigns");
  const [isEditingInfo, setIsEditingInfo] = useState(false);
  const [editedClient, setEditedClient] = useState<Partial<Client>>({});
  const [showAddSubscription, setShowAddSubscription] = useState(false);
  const [newSubscription, setNewSubscription] = useState<{ frequency: "weekly" | "biweekly" | "monthly"; pricePerPeriod: string }>({ frequency: "monthly", pricePerPeriod: "" });

  const { data: clientData, isLoading: loadingClient } = useQuery<{
    client: Client;
    brandingKit: BrandingKit | null;
    newsletters: Newsletter[];
    subscriptions?: Subscription[];
    invoices?: Invoice[];
  }>({
    queryKey: ["/api/clients", clientId],
  });

  const client = clientData?.client;
  const newsletters = clientData?.newsletters;
  const subscriptions = clientData?.subscriptions || [];
  const clientInvoices = clientData?.invoices || [];

  const { data: allInvoices = [] } = useQuery<(Invoice & { client?: Client })[]>({
    queryKey: ["/api/invoices"],
  });

  const clientOrders = allInvoices.filter(inv => inv.clientId === clientId);

  const updateClientMutation = useMutation({
    mutationFn: async (data: Partial<Client>) => {
      return apiRequest("PATCH", `/api/clients/${clientId}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
      setIsEditingInfo(false);
      toast({ title: "Client updated" });
    },
    onError: () => {
      toast({ title: "Failed to update client", variant: "destructive" });
    },
  });

  const createSubscriptionMutation = useMutation({
    mutationFn: async (data: { frequency: string; amount: string }) => {
      return apiRequest("POST", `/api/clients/${clientId}/subscriptions`, {
        frequency: data.frequency,
        amount: data.amount,
        status: "active",
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
      setShowAddSubscription(false);
      setNewSubscription({ frequency: "monthly", pricePerPeriod: "" });
      toast({ title: "Subscription created" });
    },
    onError: () => {
      toast({ title: "Failed to create subscription", variant: "destructive" });
    },
  });

  const { data: newsletterData, isLoading: loadingNewsletter, refetch: refetchNewsletter } = useQuery<{
    newsletter: Newsletter;
    document: NewsletterDocument;
    versions: NewsletterVersion[];
    flags: TasksFlags[];
    html: string;
  }>({
    queryKey: ["/api/newsletters", selectedNewsletterId],
    enabled: !!selectedNewsletterId,
  });

  const createNewsletterMutation = useMutation({
    mutationFn: async (data: { expectedSendDate: string; importedHtml?: string }) => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/newsletters`, data);
      return res.json() as Promise<Newsletter>;
    },
    onSuccess: (data: Newsletter) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
      setSelectedNewsletterId(data.id);
      setShowCreateNewsletter(false);
      toast({ title: "Campaign created" });
    },
    onError: (error) => {
      toast({ title: "Failed to create campaign", description: error.message, variant: "destructive" });
    },
  });

  const updateHtmlMutation = useMutation({
    mutationFn: async (html: string) => {
      const res = await apiRequest("PATCH", `/api/newsletters/${selectedNewsletterId}`, { 
        documentJson: { html } 
      });
      return res.json();
    },
    onSuccess: async () => {
      await refetchNewsletter();
      toast({ title: "Saved" });
    },
  });

  const restoreVersionMutation = useMutation({
    mutationFn: async (versionId: string) => {
      const res = await apiRequest("POST", `/api/newsletters/${selectedNewsletterId}/restore/${versionId}`);
      return res.json();
    },
    onSuccess: async () => {
      await refetchNewsletter();
      toast({ title: "Version restored" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await apiRequest("PATCH", `/api/newsletters/${selectedNewsletterId}`, { status });
      return res.json();
    },
    onSuccess: async () => {
      await refetchNewsletter();
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
      toast({ title: "Status updated" });
    },
    onError: (error) => {
      toast({ title: "Failed to update status", description: error.message, variant: "destructive" });
    },
  });

  const updateNotesMutation = useMutation({
    mutationFn: async (internalNotes: string) => {
      const res = await apiRequest("PATCH", `/api/newsletters/${selectedNewsletterId}`, { internalNotes });
      return res.json();
    },
    onSuccess: async () => {
      await refetchNewsletter();
      toast({ title: "Notes saved" });
    },
    onError: (error) => {
      toast({ title: "Failed to save notes", description: error.message, variant: "destructive" });
    },
  });

  const handleExportHtml = async () => {
    if (!selectedNewsletterId) return;
    try {
      const response = await fetch(`/api/newsletters/${selectedNewsletterId}/export`, { credentials: "include" });
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${newsletterData?.newsletter?.title || "newsletter"}.html`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {}
  };

  const handleCopyHtml = async () => {
    if (!newsletterData?.html) return;
    await navigator.clipboard.writeText(newsletterData.html);
    toast({ title: "HTML copied" });
  };

  const handlePreview = () => {
    if (!newsletterData?.html) return;
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(newsletterData.html);
      win.document.close();
    }
  };

  const handleSendForReview = async () => {
    if (!selectedNewsletterId) return;
    try {
      const res = await apiRequest("POST", `/api/newsletters/${selectedNewsletterId}/send-for-review`);
      const data = await res.json();
      if (data.reviewUrl) {
        await navigator.clipboard.writeText(data.reviewUrl);
        toast({ title: "Review link copied to clipboard", description: data.reviewUrl });
      }
    } catch {
      toast({ title: "Failed to generate review link", variant: "destructive" });
    }
  };

  if (loadingClient) {
    return (
      <div className="flex h-screen w-full bg-background">
        <div className="w-64 border-r p-4">
          <Skeleton className="h-8 w-32 mb-4" />
          <Skeleton className="h-4 w-48 mb-2" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Skeleton className="h-96 w-full max-w-2xl" />
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex h-screen w-full bg-background items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-medium mb-2">Client not found</h2>
          <Button onClick={() => setLocation("/")}>Back to Clients</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full bg-background">
      <TopNav />
      <div className="flex flex-1 overflow-hidden">
        <div className="w-64 flex-shrink-0 border-r flex flex-col">
          <div className="flex items-center gap-2 px-3 h-12 border-b">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/clients")} data-testid="button-back">
              <ChevronLeft className="w-5 h-5" />
            </Button>
            <span className="font-semibold truncate flex-1">{client.name}</span>
          </div>

        <Tabs value={sidebarTab} onValueChange={(v) => setSidebarTab(v as typeof sidebarTab)} className="flex flex-col flex-1 overflow-hidden">
          <TabsList className="mx-2 mt-2 grid grid-cols-5">
            <TabsTrigger value="campaigns" className="text-xs" data-testid="tab-campaigns">
              Campaigns
            </TabsTrigger>
            <TabsTrigger value="orders" className="text-xs" data-testid="tab-orders">
              Orders
            </TabsTrigger>
            <TabsTrigger value="emails" className="text-xs" data-testid="tab-emails">
              Emails
            </TabsTrigger>
            <TabsTrigger value="notes" className="text-xs" data-testid="tab-notes">
              Notes
            </TabsTrigger>
            <TabsTrigger value="info" className="text-xs" data-testid="tab-info">
              Info
            </TabsTrigger>
          </TabsList>

          <TabsContent value="campaigns" className="flex-1 overflow-hidden m-0">
            <ScrollArea className="h-full">
              <div className="p-2">
                <div className="flex items-center justify-between px-2 py-1 mb-1">
                  <span className="text-xs text-muted-foreground font-medium">Newsletters</span>
                  <Button variant="ghost" size="sm" onClick={() => setShowCreateNewsletter(true)} data-testid="button-new-campaign">
                    <Plus className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {(!newsletters || newsletters.length === 0) ? (
                  <div className="text-center py-8">
                    <FileText className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                    <p className="text-sm text-muted-foreground mb-3">No campaigns yet</p>
                    <Button variant="outline" size="sm" onClick={() => setShowCreateNewsletter(true)}>
                      Create First
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {newsletters.map((nl) => (
                      <div
                        key={nl.id}
                        onClick={() => setSelectedNewsletterId(nl.id)}
                        className={`p-2 rounded-md cursor-pointer transition-colors ${
                          nl.id === selectedNewsletterId ? "bg-primary/10" : "hover:bg-muted/50"
                        }`}
                        data-testid={`campaign-${nl.id}`}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => e.key === "Enter" && setSelectedNewsletterId(nl.id)}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-medium text-sm truncate">{nl.title}</span>
                          <StatusPill status={nl.status} size="sm" />
                        </div>
                        {nl.expectedSendDate && (
                          <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                            <Calendar className="w-3 h-3" />
                            {format(new Date(nl.expectedSendDate), "MMM d")}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="orders" className="flex-1 overflow-hidden m-0">
            <ScrollArea className="h-full">
              <div className="p-2">
                <div className="flex items-center justify-between px-2 py-1 mb-1">
                  <span className="text-xs text-muted-foreground font-medium">Orders</span>
                  <Button variant="ghost" size="sm" onClick={() => setLocation("/invoices")} data-testid="button-view-orders">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </Button>
                </div>

                {clientOrders.length === 0 ? (
                  <div className="text-center py-8">
                    <Receipt className="w-8 h-8 mx-auto text-muted-foreground/40 mb-2" />
                    <p className="text-sm text-muted-foreground">No orders yet</p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    {clientOrders.map((order) => (
                      <div
                        key={order.id}
                        onClick={() => setLocation("/invoices")}
                        className="p-2 rounded-md hover:bg-muted/50 cursor-pointer"
                        data-testid={`order-${order.id}`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-medium">${Number(order.amount).toFixed(0)}</span>
                          <Badge variant={order.status === "paid" ? "default" : "outline"} className="text-xs">
                            {order.status}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {format(new Date(order.createdAt), "MMM d, yyyy")}
                        </p>
                      </div>
                    ))}
                  </div>
                )}

                <div className="mt-4 px-2">
                  <div className="flex items-center justify-between py-1 mb-1">
                    <span className="text-xs text-muted-foreground font-medium">Subscriptions</span>
                    <Button variant="ghost" size="sm" onClick={() => setShowAddSubscription(true)} data-testid="button-add-subscription">
                      <Plus className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                  {subscriptions.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-2">No active subscriptions</p>
                  ) : (
                    <div className="space-y-1">
                      {subscriptions.map((sub) => (
                        <div key={sub.id} className="p-2 rounded-md bg-muted/30 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="capitalize">{sub.frequency}</span>
                            <span className="text-muted-foreground">${Number(sub.amount).toFixed(0)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="emails" className="flex-1 overflow-hidden m-0">
            <ScrollArea className="h-full">
              <div className="p-2">
                <div className="px-2 py-1 mb-1">
                  <span className="text-xs text-muted-foreground font-medium">Email History</span>
                </div>
                <ClientEmailsList clientId={clientId} />
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="notes" className="flex-1 overflow-hidden m-0">
            <ScrollArea className="h-full">
              <div className="p-2">
                <ClientNotesPanel clientId={clientId} />
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="info" className="flex-1 overflow-hidden m-0">
            <ScrollArea className="h-full">
              <div className="p-3 space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground font-medium">Client Info</span>
                  {!isEditingInfo ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setEditedClient({
                          name: client.name,
                          primaryEmail: client.primaryEmail,
                          phone: client.phone || "",
                          locationCity: client.locationCity || "",
                          locationRegion: client.locationRegion || "",
                          newsletterFrequency: client.newsletterFrequency || "monthly",
                        });
                        setIsEditingInfo(true);
                      }}
                      data-testid="button-edit-info"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => updateClientMutation.mutate(editedClient)}
                        disabled={updateClientMutation.isPending}
                        data-testid="button-save-info"
                      >
                        <Check className="w-4 h-4 text-green-600" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => setIsEditingInfo(false)}
                        data-testid="button-cancel-edit"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </div>
                  )}
                </div>

                {isEditingInfo ? (
                  <div className="space-y-3">
                    <div>
                      <Label className="text-xs">Name</Label>
                      <Input
                        value={editedClient.name || ""}
                        onChange={(e) => setEditedClient({ ...editedClient, name: e.target.value })}
                        className="h-8 text-sm"
                        data-testid="input-client-name"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Email</Label>
                      <Input
                        value={editedClient.primaryEmail || ""}
                        onChange={(e) => setEditedClient({ ...editedClient, primaryEmail: e.target.value })}
                        className="h-8 text-sm"
                        data-testid="input-client-email"
                      />
                    </div>
                    <div>
                      <Label className="text-xs">Phone</Label>
                      <Input
                        value={editedClient.phone || ""}
                        onChange={(e) => setEditedClient({ ...editedClient, phone: e.target.value })}
                        className="h-8 text-sm"
                        data-testid="input-client-phone"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <Label className="text-xs">City</Label>
                        <Input
                          value={editedClient.locationCity || ""}
                          onChange={(e) => setEditedClient({ ...editedClient, locationCity: e.target.value })}
                          className="h-8 text-sm"
                          data-testid="input-client-city"
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Region</Label>
                        <Input
                          value={editedClient.locationRegion || ""}
                          onChange={(e) => setEditedClient({ ...editedClient, locationRegion: e.target.value })}
                          className="h-8 text-sm"
                          data-testid="input-client-region"
                        />
                      </div>
                    </div>
                    <div>
                      <Label className="text-xs">Newsletter Frequency</Label>
                      <Select
                        value={editedClient.newsletterFrequency || "monthly"}
                        onValueChange={(v) => setEditedClient({ ...editedClient, newsletterFrequency: v as "weekly" | "biweekly" | "monthly" })}
                      >
                        <SelectTrigger className="h-8 text-sm" data-testid="select-frequency">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="weekly">Weekly</SelectItem>
                          <SelectItem value="biweekly">Bi-Weekly</SelectItem>
                          <SelectItem value="monthly">Monthly</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2 text-sm">
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Mail className="w-3.5 h-3.5" />
                      <span className="truncate">{client.primaryEmail}</span>
                    </div>
                    {client.phone && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <Phone className="w-3.5 h-3.5" />
                        <span>{client.phone}</span>
                      </div>
                    )}
                    {(client.locationCity || client.locationRegion) && (
                      <div className="flex items-center gap-2 text-muted-foreground">
                        <MapPin className="w-3.5 h-3.5" />
                        <span>{[client.locationCity, client.locationRegion].filter(Boolean).join(", ")}</span>
                      </div>
                    )}
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="w-3.5 h-3.5" />
                      <span className="capitalize">{client.newsletterFrequency || "Monthly"} newsletters</span>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>

        <div className="p-3 border-t">
          <Button className="w-full" onClick={() => setShowCreateNewsletter(true)} data-testid="button-new-campaign-bottom">
            <Plus className="w-4 h-4 mr-2" />
            New Campaign
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        {selectedNewsletterId && (
          <header className="flex items-center justify-between px-4 h-12 border-b">
            <span className="font-medium truncate">{newsletterData?.newsletter?.title}</span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handlePreview} data-testid="button-preview">
                <ExternalLink className="w-4 h-4 mr-1" />
                Preview
              </Button>
              <Button variant="ghost" size="sm" onClick={handleCopyHtml} data-testid="button-copy">
                <Copy className="w-4 h-4 mr-1" />
                Copy
              </Button>
              <Button variant="ghost" size="sm" onClick={handleExportHtml} data-testid="button-export">
                <Download className="w-4 h-4 mr-1" />
                Export
              </Button>
              <Button size="sm" onClick={handleSendForReview} data-testid="button-send-review">
                <Send className="w-4 h-4 mr-1" />
                Get Review Link
              </Button>
            </div>
          </header>
        )}

        {!selectedNewsletterId ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center max-w-md">
              <FileText className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
              <h2 className="text-lg font-medium mb-2">Select a Campaign</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Choose a newsletter from the sidebar or create a new one.
              </p>
              <Button onClick={() => setShowCreateNewsletter(true)} data-testid="button-create-campaign-empty">
                <Plus className="w-4 h-4 mr-2" />
                New Campaign
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0">
            <HTMLPreviewFrame
              html={newsletterData?.html || ""}
              isLoading={loadingNewsletter}
              title={newsletterData?.newsletter?.title}
              onHtmlChange={(html) => updateHtmlMutation.mutate(html)}
              onCreateCampaign={() => setShowCreateNewsletter(true)}
            />
          </div>
        )}
      </div>

      {selectedNewsletterId && newsletterData && (
        <div className="w-56 flex-shrink-0 border-l">
          <RightPanel
            newsletterId={selectedNewsletterId}
            status={newsletterData.newsletter?.status || "not_started"}
            onStatusChange={(status: string) => updateStatusMutation.mutate(status)}
          />
        </div>
      )}

      <CreateNewsletterDialog
        open={showCreateNewsletter}
        onClose={() => setShowCreateNewsletter(false)}
        onSubmit={async (data) => {
          await createNewsletterMutation.mutateAsync(data);
        }}
        isSubmitting={createNewsletterMutation.isPending}
        clientName={client.name}
        clientFrequency={client.newsletterFrequency as "weekly" | "biweekly" | "monthly"}
        lastSendDate={newsletters?.length 
          ? [...newsletters].sort((a, b) => 
              new Date(b.expectedSendDate || 0).getTime() - new Date(a.expectedSendDate || 0).getTime()
            )[0]?.expectedSendDate 
          : null}
      />

      <Dialog open={showAddSubscription} onOpenChange={setShowAddSubscription}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Subscription</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Frequency</Label>
              <Select
                value={newSubscription.frequency}
                onValueChange={(v) => setNewSubscription({ ...newSubscription, frequency: v as "weekly" | "biweekly" | "monthly" })}
              >
                <SelectTrigger data-testid="select-new-sub-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Bi-Weekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Amount per Period ($)</Label>
              <Input
                type="number"
                placeholder="99.00"
                value={newSubscription.pricePerPeriod}
                onChange={(e) => setNewSubscription({ ...newSubscription, pricePerPeriod: e.target.value })}
                data-testid="input-new-sub-amount"
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setShowAddSubscription(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createSubscriptionMutation.mutate({ 
                frequency: newSubscription.frequency, 
                amount: newSubscription.pricePerPeriod 
              })}
              disabled={!newSubscription.pricePerPeriod || createSubscriptionMutation.isPending}
              data-testid="button-save-subscription"
            >
              Add Subscription
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      </div>
    </div>
  );
}
