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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Client, Newsletter, NewsletterVersion, NewsletterDocument, BrandingKit, Project, TasksFlags } from "@shared/schema";
import { format } from "date-fns";

interface ClientProfilePageProps {
  clientId: string;
}

export default function ClientProfilePage({ clientId }: ClientProfilePageProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [selectedNewsletterId, setSelectedNewsletterId] = useState<string | null>(null);
  const [showCreateNewsletter, setShowCreateNewsletter] = useState(false);

  const { data: clientData, isLoading: loadingClient } = useQuery<{
    client: Client;
    brandingKit: BrandingKit | null;
    newsletters: Newsletter[];
  }>({
    queryKey: ["/api/clients", clientId],
  });

  const client = clientData?.client;
  const newsletters = clientData?.newsletters;

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

        <div className="p-3 border-b text-sm space-y-1">
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
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2">
            <div className="flex items-center justify-between px-2 py-1 mb-1">
              <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Campaigns</span>
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
            versions={newsletterData.versions || []}
            currentVersionId={newsletterData.newsletter?.currentVersionId || null}
            status={newsletterData.newsletter?.status || "not_started"}
            internalNotes={newsletterData.newsletter?.internalNotes}
            flags={newsletterData.flags || []}
            onRestoreVersion={(versionId) => restoreVersionMutation.mutate(versionId)}
            onStatusChange={(status) => updateStatusMutation.mutate(status)}
            onInternalNotesChange={(notes) => updateNotesMutation.mutate(notes)}
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
      </div>
    </div>
  );
}
