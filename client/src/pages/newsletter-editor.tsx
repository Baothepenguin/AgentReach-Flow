import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { TopNav } from "@/components/TopNav";
import { RightPanel } from "@/components/RightPanel";
import { HTMLPreviewFrame } from "@/components/HTMLPreviewFrame";
import { ClientSidePanel } from "@/components/ClientSidePanel";
import { GeminiChatPanel } from "@/components/GeminiChatPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  ArrowLeft,
  ArrowUp,
  User,
  Download,
  Copy,
  Trash2,
  Calendar as CalendarIcon,
  ExternalLink,
  Pencil,
  Check,
  X,
  Sparkles,
  Loader2,
  Code,
  Upload,
  FileImage,
  FileText,
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
  const [showClientPanel, setShowClientPanel] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(true);
  const [editingHtml, setEditingHtml] = useState(false);
  const [htmlDraft, setHtmlDraft] = useState("");
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importHtml, setImportHtml] = useState("");
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);

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
    onMutate: async (html: string) => {
      setSaveStatus("saving");
      await queryClient.cancelQueries({ queryKey: ["/api/newsletters", newsletterId] });
      const previousData = queryClient.getQueryData(["/api/newsletters", newsletterId]);
      queryClient.setQueryData(["/api/newsletters", newsletterId], (old: typeof newsletterData) => 
        old ? { ...old, html, document: { html } } : old
      );
      return { previousData };
    },
    onSuccess: () => {
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
    onError: (_err, _html, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(["/api/newsletters", newsletterId], context.previousData);
      }
      setSaveStatus("idle");
      toast({ title: "Failed to save", variant: "destructive" });
    },
  });

  const updateTitleMutation = useMutation({
    mutationFn: async (title: string) => {
      const res = await apiRequest("PATCH", `/api/newsletters/${newsletterId}`, { title });
      return res.json();
    },
    onSuccess: async () => {
      await refetchNewsletter();
      setIsEditingTitle(false);
    },
  });

  const debouncedSaveHtml = useCallback((html: string) => {
    setSaveStatus("saving");
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = setTimeout(() => {
      updateHtmlMutation.mutate(html);
    }, 1500);
  }, [updateHtmlMutation]);

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

  const updateAssignedToMutation = useMutation({
    mutationFn: async (assignedToId: string | null) => {
      const res = await apiRequest("PATCH", `/api/newsletters/${newsletterId}`, { assignedToId });
      return res.json();
    },
    onSuccess: async () => {
      await refetchNewsletter();
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
      toast({ title: "Team member updated" });
    },
    onError: (error) => {
      toast({ title: "Failed to update team member", description: error.message, variant: "destructive" });
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

  const duplicateNewsletterMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/newsletters/${newsletterId}/duplicate`);
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
      toast({ title: "Newsletter duplicated" });
      setLocation("/newsletters/" + data.id);
    },
    onError: (error) => {
      toast({ title: "Failed to duplicate", description: error.message, variant: "destructive" });
    },
  });

  const hasMjml = !!(newsletter?.designJson as any)?.mjml;
  const hasContent = !!newsletterData?.html;

  const aiGenerateMutation = useMutation({
    mutationFn: async (prompt: string) => {
      const res = await apiRequest("POST", `/api/newsletters/${newsletterId}/ai-generate`, { prompt });
      return res.json();
    },
    onMutate: () => setIsGenerating(true),
    onSuccess: async (data: { type: string; html: string; mjml?: string; subject?: string }) => {
      queryClient.setQueryData(["/api/newsletters", newsletterId], (old: typeof newsletterData) =>
        old ? { ...old, html: data.html } : old
      );
      setAiPrompt("");
      await refetchNewsletter();
    },
    onSettled: () => setIsGenerating(false),
    onError: (error) => {
      toast({ title: "AI generation failed", description: error.message, variant: "destructive" });
    },
  });

  const aiEditMutation = useMutation({
    mutationFn: async (command: string) => {
      const res = await apiRequest("POST", `/api/newsletters/${newsletterId}/ai-edit`, { command });
      return res.json();
    },
    onMutate: () => setIsGenerating(true),
    onSuccess: async (data: { type: string; html: string; mjml?: string; subject?: string }) => {
      queryClient.setQueryData(["/api/newsletters", newsletterId], (old: typeof newsletterData) =>
        old ? { ...old, html: data.html } : old
      );
      setAiPrompt("");
      await refetchNewsletter();
    },
    onSettled: () => setIsGenerating(false),
    onError: (error) => {
      toast({ title: "AI edit failed", description: error.message, variant: "destructive" });
    },
  });

  const handleAiSubmit = () => {
    if (!aiPrompt.trim() || isGenerating) return;
    if (hasMjml && hasContent) {
      aiEditMutation.mutate(aiPrompt.trim());
    } else {
      aiGenerateMutation.mutate(aiPrompt.trim());
    }
  };

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

  const handleImportHtml = () => {
    if (!importHtml.trim()) return;
    updateHtmlMutation.mutate(importHtml.trim());
    setImportHtml("");
    setShowImportDialog(false);
  };

  const handleExportPdf = async () => {
    if (!newsletterData?.html) return;
    try {
      const res = await fetch(`/api/newsletters/${newsletterId}/export?format=pdf`, { credentials: "include" });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${newsletter?.title || "newsletter"}.pdf`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {}
  };

  const handleExportPng = async () => {
    if (!newsletterData?.html) return;
    try {
      const res = await fetch(`/api/newsletters/${newsletterId}/export?format=png`, { credentials: "include" });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${newsletter?.title || "newsletter"}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch {}
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
          <header className="flex items-center justify-between px-4 h-12 border-b bg-background">
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="icon" onClick={() => setLocation("/newsletters")} data-testid="button-back">
                <ArrowLeft className="w-5 h-5" />
              </Button>
              <div className="flex items-center gap-2">
                {isEditingTitle ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={editedTitle}
                      onChange={(e) => setEditedTitle(e.target.value)}
                      className="h-7 w-48"
                      autoFocus
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && editedTitle.trim()) {
                          updateTitleMutation.mutate(editedTitle.trim());
                        } else if (e.key === "Escape") {
                          setIsEditingTitle(false);
                        }
                      }}
                      data-testid="input-edit-title"
                    />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => editedTitle.trim() && updateTitleMutation.mutate(editedTitle.trim())}
                      data-testid="button-save-title"
                    >
                      <Check className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setIsEditingTitle(false)}
                      data-testid="button-cancel-title"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                ) : (
                  <button
                    onClick={() => {
                      setEditedTitle(newsletter.title);
                      setIsEditingTitle(true);
                    }}
                    className="font-medium truncate hover:underline cursor-pointer flex items-center gap-1.5 group"
                    data-testid="button-edit-title"
                  >
                    {newsletter.title}
                    <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                  </button>
                )}
                <div className="flex items-center gap-2">
                  {saveStatus === "saving" && (
                    <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" title="Saving..." data-testid="save-indicator-saving" />
                  )}
                  {saveStatus === "saved" && (
                    <div className="w-2 h-2 rounded-full bg-green-500" title="Saved" data-testid="save-indicator-saved" />
                  )}
                </div>
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
              {client && (
                <Link
                  href={`/clients/${client.id}`}
                  className="text-sm text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  data-testid="link-client-name"
                >
                  <User className="w-3.5 h-3.5" />
                  {client.name}
                </Link>
              )}
              <div className="w-px h-5 bg-border mx-1" />
              {hasContent && (
                <Button
                  variant={editingHtml ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => {
                    if (!editingHtml) {
                      setHtmlDraft(newsletterData?.html || "");
                    }
                    setEditingHtml(!editingHtml);
                  }}
                  data-testid="button-edit-html"
                >
                  <Code className="w-4 h-4 mr-1" />
                  {editingHtml ? "Preview" : "Edit HTML"}
                </Button>
              )}
              {!hasContent && (
                <Button variant="ghost" size="sm" onClick={() => setShowImportDialog(true)} data-testid="button-import-header">
                  <Upload className="w-4 h-4 mr-1" />
                  Import
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={handleCopyHtml} disabled={!hasContent} data-testid="button-copy">
                <Copy className="w-4 h-4 mr-1" />
                Copy
              </Button>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="ghost" size="sm" disabled={!hasContent} data-testid="button-export">
                    <Download className="w-4 h-4 mr-1" />
                    Export
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-40 p-1" align="end">
                  <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleExportHtml} data-testid="button-export-html">
                    <FileText className="w-4 h-4 mr-2" />
                    HTML
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleExportPdf} data-testid="button-export-pdf">
                    <FileText className="w-4 h-4 mr-2" />
                    PDF
                  </Button>
                  <Button variant="ghost" size="sm" className="w-full justify-start" onClick={handleExportPng} data-testid="button-export-png">
                    <FileImage className="w-4 h-4 mr-2" />
                    PNG
                  </Button>
                </PopoverContent>
              </Popover>
              <Button size="sm" onClick={handleGetReviewLink} data-testid="button-review-link">
                <ExternalLink className="w-4 h-4 mr-1" />
                Get Review Link
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => duplicateNewsletterMutation.mutate()}
                disabled={duplicateNewsletterMutation.isPending}
                data-testid="button-duplicate-newsletter"
              >
                <Copy className="w-4 h-4 mr-1" />
                Duplicate
              </Button>
              <Button variant="ghost" size="icon" className="text-destructive" onClick={handleDelete} data-testid="button-delete">
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </header>

          <div className="flex-1 min-h-0 relative">
            {editingHtml ? (
              <div className="h-full flex flex-col">
                <Textarea
                  value={htmlDraft}
                  onChange={(e) => setHtmlDraft(e.target.value)}
                  className="flex-1 font-mono text-xs resize-none rounded-none border-0 focus-visible:ring-0"
                  data-testid="textarea-html-editor"
                />
                <div className="flex items-center gap-2 p-2 border-t bg-background">
                  <Button
                    size="sm"
                    onClick={() => {
                      debouncedSaveHtml(htmlDraft);
                      setEditingHtml(false);
                    }}
                    data-testid="button-save-html"
                  >
                    <Check className="w-4 h-4 mr-1" />
                    Save & Preview
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setEditingHtml(false)}
                    data-testid="button-cancel-html"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {hasContent ? (
                  <HTMLPreviewFrame
                    html={newsletterData?.html || ""}
                    isLoading={loadingNewsletter}
                    title={newsletter.title}
                    onHtmlChange={debouncedSaveHtml}
                    fullWidth
                  />
                ) : (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="flex flex-col items-center justify-center text-center p-12 rounded-md border-2 border-dashed border-muted-foreground/20 max-w-md">
                      <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
                        <Code className="w-8 h-8 text-primary/60" />
                      </div>
                      <p className="text-lg font-medium mb-2">Get started</p>
                      <p className="text-sm text-muted-foreground mb-5">
                        Import HTML from your email builder or use AI to generate a newsletter
                      </p>
                      <div className="flex items-center gap-3">
                        <Button onClick={() => setShowImportDialog(true)} data-testid="button-import-html">
                          <Upload className="w-4 h-4 mr-2" />
                          Import HTML
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
                <div className="absolute bottom-4 left-1/2 -translate-x-1/2 w-full max-w-xl z-10 px-4">
                  <div className="flex items-center gap-2 bg-background/95 backdrop-blur-sm rounded-full p-1.5 pl-4 shadow-lg border">
                    <Sparkles className="w-4 h-4 text-primary/60 flex-shrink-0" />
                    <input
                      value={aiPrompt}
                      onChange={(e) => setAiPrompt(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleAiSubmit()}
                      placeholder={hasContent ? "Ask AI to edit..." : "Describe the newsletter you want to create..."}
                      className="flex-1 bg-transparent border-0 outline-none text-sm placeholder:text-muted-foreground/60"
                      disabled={isGenerating}
                      data-testid="input-ai-prompt"
                    />
                    <Button
                      size="icon"
                      className="rounded-full"
                      onClick={handleAiSubmit}
                      disabled={!aiPrompt.trim() || isGenerating}
                      data-testid="button-ai-submit"
                    >
                      {isGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowUp className="w-4 h-4" />}
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="w-56 flex-shrink-0 border-l">
          <RightPanel
            newsletterId={newsletterId}
            status={newsletter.status}
            onStatusChange={(status) => updateStatusMutation.mutate(status)}
            assignedToId={newsletter.assignedToId}
            onAssignedToChange={(assignedToId) => updateAssignedToMutation.mutate(assignedToId)}
          />
        </div>

        {client && (
          <GeminiChatPanel
            newsletterId={newsletterId}
            clientId={client.id}
            clientName={client.name}
            collapsed={chatCollapsed}
            onToggleCollapse={() => setChatCollapsed(!chatCollapsed)}
          />
        )}
      </div>

      {client && (
        <ClientSidePanel
          clientId={client.id}
          open={showClientPanel}
          onClose={() => setShowClientPanel(false)}
        />
      )}

      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import HTML</DialogTitle>
            <DialogDescription>
              Paste your newsletter HTML code below
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={importHtml}
            onChange={(e) => setImportHtml(e.target.value)}
            placeholder="Paste HTML here..."
            className="min-h-[200px] font-mono text-xs"
            data-testid="textarea-import-html"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowImportDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleImportHtml} disabled={!importHtml.trim()} data-testid="button-confirm-import">
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
