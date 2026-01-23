import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { TopNav } from "@/components/TopNav";
import { RightPanel } from "@/components/RightPanel";
import { HTMLPreviewFrame } from "@/components/HTMLPreviewFrame";
import { CreateNewsletterDialog } from "@/components/CreateNewsletterDialog";
import { ClientSidePanel } from "@/components/ClientSidePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ArrowLeft,
  Plus,
  User,
  Send,
  Download,
  Copy,
  Trash2,
  Calendar as CalendarIcon,
  ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Newsletter, NewsletterVersion, NewsletterDocument, Client, TasksFlags } from "@shared/schema";
import { format } from "date-fns";

interface NewsletterEditorPageProps {
  newsletterId: string;
}

export default function NewsletterEditorPage({ newsletterId }: NewsletterEditorPageProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showCreateNewsletter, setShowCreateNewsletter] = useState(false);
  const [showClientPanel, setShowClientPanel] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);

  const { data: newsletterData, isLoading: loadingNewsletter, refetch: refetchNewsletter } = useQuery<{
    newsletter: Newsletter & { client?: Client };
    document: NewsletterDocument;
    versions: NewsletterVersion[];
    flags: TasksFlags[];
    html: string;
  }>({
    queryKey: ["/api/newsletters", newsletterId],
  });

  const newsletter = newsletterData?.newsletter;
  const client = newsletter?.client;

  const updateHtmlMutation = useMutation({
    mutationFn: async (html: string) => {
      const res = await apiRequest("PATCH", `/api/newsletters/${newsletterId}`, { 
        documentJson: { html } 
      });
      return res.json();
    },
    onSuccess: async () => {
      await refetchNewsletter();
      toast({ title: "Saved" });
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      const res = await apiRequest("PATCH", `/api/newsletters/${newsletterId}`, { status });
      return res.json();
    },
    onSuccess: async () => {
      await refetchNewsletter();
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
      toast({ title: "Status updated" });
    },
    onError: (error) => {
      toast({ title: "Failed to update status", description: error.message, variant: "destructive" });
    },
  });

  const updateNotesMutation = useMutation({
    mutationFn: async (internalNotes: string) => {
      const res = await apiRequest("PATCH", `/api/newsletters/${newsletterId}`, { internalNotes });
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

  const updateDateMutation = useMutation({
    mutationFn: async (expectedSendDate: string) => {
      const res = await apiRequest("PATCH", `/api/newsletters/${newsletterId}`, { expectedSendDate });
      return res.json();
    },
    onSuccess: async () => {
      await refetchNewsletter();
      setShowDatePicker(false);
      toast({ title: "Send date updated" });
    },
  });

  const deleteNewsletterMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/newsletters/${newsletterId}`);
    },
    onSuccess: () => {
      toast({ title: "Newsletter deleted" });
      setLocation("/newsletters");
    },
    onError: (error) => {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    },
  });

  const handleExportHtml = async () => {
    if (!newsletterData?.html) return;
    try {
      const response = await fetch(`/api/newsletters/${newsletterId}/export`, { credentials: "include" });
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${newsletter?.title || "newsletter"}.html`;
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

  const handleGetReviewLink = async () => {
    try {
      const res = await apiRequest("POST", `/api/newsletters/${newsletterId}/send-for-review`);
      const data = await res.json();
      if (data.reviewUrl) {
        window.open(data.reviewUrl, "_blank");
        await navigator.clipboard.writeText(data.reviewUrl);
        toast({ title: "Review link copied and opened" });
      }
    } catch {
      toast({ title: "Failed to generate review link", variant: "destructive" });
    }
  };

  const handleDelete = () => {
    if (confirm("Are you sure you want to delete this newsletter? This cannot be undone.")) {
      deleteNewsletterMutation.mutate();
    }
  };

  if (loadingNewsletter) {
    return (
      <div className="flex flex-col h-screen w-full bg-background">
        <TopNav />
        <div className="flex flex-1 overflow-hidden">
          <div className="flex-1 flex items-center justify-center">
            <Skeleton className="h-96 w-full max-w-2xl" />
          </div>
        </div>
      </div>
    );
  }

  if (!newsletter) {
    return (
      <div className="flex flex-col h-screen w-full bg-background">
        <TopNav />
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <h2 className="text-lg font-medium mb-2">Newsletter not found</h2>
            <Button onClick={() => setLocation("/newsletters")}>Back to Newsletters</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen w-full bg-background">
      <TopNav />
      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 flex flex-col min-w-0">
          <header className="flex items-center justify-between px-4 h-12 border-b bg-background/95 backdrop-blur">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setLocation("/newsletters")} data-testid="button-back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-2">
                <span className="font-medium truncate">{newsletter.title}</span>
                <Popover open={showDatePicker} onOpenChange={setShowDatePicker}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className="text-muted-foreground" data-testid="button-edit-date">
                      <CalendarIcon className="w-3.5 h-3.5 mr-1.5" />
                      {newsletter.expectedSendDate 
                        ? format(new Date(newsletter.expectedSendDate), "MMM d, yyyy")
                        : "Set date"
                      }
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={newsletter.expectedSendDate ? new Date(newsletter.expectedSendDate) : undefined}
                      onSelect={(date) => date && updateDateMutation.mutate(format(date, "yyyy-MM-dd"))}
                      data-testid="calendar-send-date"
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="icon" onClick={() => setShowCreateNewsletter(true)} data-testid="button-new">
                <Plus className="w-4 h-4" />
              </Button>
              {client && (
                <Button variant="ghost" size="icon" onClick={() => setShowClientPanel(true)} data-testid="button-client">
                  <User className="w-4 h-4" />
                </Button>
              )}
              <div className="w-px h-5 bg-border mx-1" />
              <Button variant="ghost" size="sm" onClick={handleCopyHtml} data-testid="button-copy">
                <Copy className="w-4 h-4 mr-1" />
                Copy
              </Button>
              <Button variant="ghost" size="sm" onClick={handleExportHtml} data-testid="button-export">
                <Download className="w-4 h-4 mr-1" />
                Export
              </Button>
              <Button size="sm" onClick={handleGetReviewLink} data-testid="button-review-link">
                <ExternalLink className="w-4 h-4 mr-1" />
                Get Review Link
              </Button>
              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" onClick={handleDelete} data-testid="button-delete">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </header>

          <div className="flex-1 min-h-0">
            <HTMLPreviewFrame
              html={newsletterData?.html || ""}
              isLoading={loadingNewsletter}
              title={newsletter.title}
              onHtmlChange={(html) => updateHtmlMutation.mutate(html)}
              onCreateCampaign={() => setShowCreateNewsletter(true)}
              fullWidth
            />
          </div>
        </div>

        <div className="w-56 flex-shrink-0 border-l">
          <RightPanel
            newsletterId={newsletterId}
            status={newsletter.status}
            internalNotes={newsletter.internalNotes}
            onStatusChange={(status) => updateStatusMutation.mutate(status)}
            onInternalNotesChange={(notes) => updateNotesMutation.mutate(notes)}
          />
        </div>
      </div>

      {client && (
        <ClientSidePanel
          clientId={client.id}
          open={showClientPanel}
          onClose={() => setShowClientPanel(false)}
        />
      )}

      <CreateNewsletterDialog
        open={showCreateNewsletter}
        onClose={() => setShowCreateNewsletter(false)}
        onSubmit={async (data) => {
          const res = await apiRequest("POST", `/api/clients/${client?.id}/newsletters`, data);
          const newNewsletter = await res.json();
          queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
          setLocation(`/newsletters/${newNewsletter.id}`);
          setShowCreateNewsletter(false);
        }}
        isSubmitting={false}
        clientName={client?.name}
        clientFrequency={client?.newsletterFrequency as "weekly" | "biweekly" | "monthly" | undefined}
      />
    </div>
  );
}
