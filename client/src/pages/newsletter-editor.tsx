import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { TopNav } from "@/components/TopNav";
import { RightPanel } from "@/components/RightPanel";
import { HTMLPreviewFrame } from "@/components/HTMLPreviewFrame";
import { ClientSidePanel } from "@/components/ClientSidePanel";
import { GeminiChatPanel } from "@/components/GeminiChatPanel";
import { SendConfirmDialog } from "@/components/SendConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { ToastAction } from "@/components/ui/toast";
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
  User,
  ChevronDown,
  Copy,
  Calendar as CalendarIcon,
  ExternalLink,
  Pencil,
  Check,
  X,
  Code,
  Upload,
  FileImage,
  FileText,
  Clock3,
  Send,
  AlertTriangle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type {
  BlockEditOperation,
  Newsletter,
  NewsletterVersion,
  NewsletterDocument,
  Client,
  TasksFlags,
} from "@shared/schema";
import { format } from "date-fns";

interface NewsletterEditorPageProps {
  newsletterId: string;
}

type SendReadinessPreview = {
  newsletterId: string;
  status: string;
  audienceTag: string;
  recipientsCount: number;
  blockers: Array<{ code: string; message: string }>;
  warnings: Array<{ code: string; message: string }>;
  canSend: boolean;
  subject: string;
  previewText: string;
  fromEmail: string;
};

function cloneNewsletterDocument(document: NewsletterDocument): NewsletterDocument {
  return JSON.parse(JSON.stringify(document));
}

export default function NewsletterEditorPage({ newsletterId }: NewsletterEditorPageProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [showClientPanel, setShowClientPanel] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [sendDialogMode, setSendDialogMode] = useState<"schedule" | "send_now">("schedule");
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [aiPrompt, setAiPrompt] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(true);
  const [editingHtml, setEditingHtml] = useState(false);
  const [editorView, setEditorView] = useState<"preview">("preview");
  const [htmlDraft, setHtmlDraft] = useState("");
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importHtml, setImportHtml] = useState("");
  const [lastAiApplyBackup, setLastAiApplyBackup] = useState<{
    document: NewsletterDocument;
    summary?: string;
    createdAt: number;
  } | null>(null);
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
  const isDeliveryStage = newsletter?.status === "approved" || newsletter?.status === "scheduled";

  // Keep HTML as-is. Email builders (e.g. Postcards) rely on conditional comments (Outlook),
  // and "minifying" by stripping comments can break rendering.
  const normalizeHtmlForStorage = (html: string): string => html.trim();

  const updateHtmlMutation = useMutation({
    mutationFn: async (html: string) => {
      const normalized = normalizeHtmlForStorage(html);
      const res = await apiRequest("PATCH", `/api/newsletters/${newsletterId}`, { 
        documentJson: { html: normalized } 
      });
      return res.json();
    },
    onMutate: async (html: string) => {
      setSaveStatus("saving");
      await queryClient.cancelQueries({ queryKey: ["/api/newsletters", newsletterId] });
      const previousData = queryClient.getQueryData(["/api/newsletters", newsletterId]);
      queryClient.setQueryData(["/api/newsletters", newsletterId], (old: typeof newsletterData) => 
        old
          ? {
              ...old,
              html,
              document: {
                ...(old.document || {}),
                html,
              },
            }
          : old
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

  const updateDocumentMutation = useMutation({
    mutationFn: async (document: NewsletterDocument) => {
      const res = await apiRequest("PATCH", `/api/newsletters/${newsletterId}`, {
        documentJson: document,
      });
      return res.json();
    },
    onMutate: async (document: NewsletterDocument) => {
      setSaveStatus("saving");
      await queryClient.cancelQueries({ queryKey: ["/api/newsletters", newsletterId] });
      const previousData = queryClient.getQueryData(["/api/newsletters", newsletterId]);
      queryClient.setQueryData(["/api/newsletters", newsletterId], (old: typeof newsletterData) =>
        old
          ? {
              ...old,
              document,
            }
          : old
      );
      return { previousData };
    },
    onSuccess: async () => {
      await refetchNewsletter();
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    },
    onError: (_err, _document, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(["/api/newsletters", newsletterId], context.previousData);
      }
      setSaveStatus("idle");
      toast({ title: "Failed to save block changes", variant: "destructive" });
    },
  });

  const applyAiBlockEdits = useCallback(
    async (operations: BlockEditOperation[], summary?: string) => {
      const currentDocument = newsletterData?.document;
      if (!currentDocument) {
        throw new Error("Newsletter document is not loaded yet.");
      }
      if (!Array.isArray(operations) || operations.length === 0) {
        throw new Error("No operations to apply.");
      }

      const backupDocument = cloneNewsletterDocument(currentDocument);
      const response = await apiRequest("POST", `/api/newsletters/${newsletterId}/ai-apply-block-edits`, {
        operations,
        summary,
      });
      const payload = await response.json() as {
        document: NewsletterDocument;
        html?: string;
        appliedCount: number;
      };
      const appliedCount = Number(payload?.appliedCount || 0);
      if (appliedCount <= 0) {
        throw new Error("AI suggestions did not match current blocks.");
      }

      queryClient.setQueryData(["/api/newsletters", newsletterId], (old: typeof newsletterData) =>
        old
          ? {
              ...old,
              document: payload.document || old.document,
              html: payload.html || old.html,
            }
          : old
      );
      await refetchNewsletter();
      setLastAiApplyBackup({
        document: backupDocument,
        summary,
        createdAt: Date.now(),
      });
      toast({
        title: `Applied ${appliedCount} AI edit${appliedCount === 1 ? "" : "s"}`,
        description: summary ? summary.slice(0, 140) : undefined,
        action: (
          <ToastAction
            altText="Undo AI edits"
            onClick={() => {
              updateDocumentMutation.mutate(backupDocument, {
                onSuccess: () => {
                  setLastAiApplyBackup(null);
                  toast({ title: "AI edits reverted" });
                },
                onError: () => {
                  toast({ title: "Failed to undo AI edits", variant: "destructive" });
                },
              });
            }}
          >
            Undo
          </ToastAction>
        ),
      });
      return { appliedCount };
    },
    [newsletterData?.document, newsletterId, toast, refetchNewsletter, updateDocumentMutation]
  );

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

  const sendReadinessQuery = useQuery<SendReadinessPreview>({
    queryKey: ["/api/newsletters", newsletterId, "send-preview", "all"],
    enabled: !!newsletterId && !!isDeliveryStage,
    queryFn: async () => {
      const res = await apiRequest("POST", `/api/newsletters/${newsletterId}/send-preview`, {
        audienceTag: "all",
      });
      return res.json();
    },
    refetchInterval: 30000,
  });
  const deliveryBlockers = sendReadinessQuery.data?.blockers || [];
  const deliveryWarnings = sendReadinessQuery.data?.warnings || [];
  const unresolvedChangesWarning = deliveryWarnings.find((w) => w.code === "pending_change_requests");

  const qaCheckMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/newsletters/${newsletterId}/qa-check`);
      return res.json() as Promise<{
        blockers: Array<{ code: string; message: string }>;
        warnings: Array<{ code: string; message: string }>;
        canSend: boolean;
      }>;
    },
    onSuccess: (data) => {
      if (data.canSend) {
        toast({
          title: "QA passed",
          description: data.warnings.length > 0
            ? `${data.warnings.length} warning(s) to review`
            : "No blockers found",
        });
        return;
      }
      toast({
        title: "QA blockers found",
        description: data.blockers[0]?.message || "Fix blockers before sending",
        variant: "destructive",
      });
    },
    onError: (error) => {
      toast({ title: "QA check failed", description: error.message, variant: "destructive" });
    },
  });

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

  const aiGenerateBlocksMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/newsletters/${newsletterId}/ai-generate-blocks`, {
        prompt: aiPrompt,
      });
      return res.json();
    },
    onMutate: () => setIsGenerating(true),
    onSuccess: async (data: any) => {
      if (data?.html) {
        queryClient.setQueryData(["/api/newsletters", newsletterId], (old: typeof newsletterData) =>
          old
            ? {
                ...old,
                html: data.html,
                document: data.document || old.document,
              }
            : old
        );
      }
      setAiPrompt("");
      await refetchNewsletter();
      toast({ title: "AI draft generated" });
    },
    onSettled: () => setIsGenerating(false),
    onError: (error: any) => {
      toast({ title: "AI draft failed", description: error.message, variant: "destructive" });
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
          <header className="border-b bg-background px-4 py-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <Button variant="ghost" size="icon" onClick={() => setLocation("/newsletters")} data-testid="button-back">
                  <ArrowLeft className="w-5 h-5" />
                </Button>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  {isEditingTitle ? (
                    <div className="flex items-center gap-1">
                      <Input
                        value={editedTitle}
                        onChange={(e) => setEditedTitle(e.target.value)}
                        className="h-7 w-56"
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
                          : "Set date"}
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

              <div className="flex flex-wrap items-center justify-end gap-2">
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

                <Button
                  variant={editingHtml ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => {
                    if (!editingHtml) {
                      setHtmlDraft(newsletterData?.html || "");
                    }
                    setEditingHtml(!editingHtml);
                    setEditorView("preview");
                  }}
                  data-testid="button-edit-html"
                >
                  <Code className="w-4 h-4 mr-1" />
                  {editingHtml ? "Preview" : "Edit HTML"}
                </Button>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" data-testid="button-file-menu">
                      <Upload className="w-4 h-4 mr-1" />
                      File
                      <ChevronDown className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-52">
                    <DropdownMenuItem onClick={() => setShowImportDialog(true)} data-testid="button-import-header">
                      <Upload className="w-4 h-4 mr-2" />
                      Import HTML
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleCopyHtml} disabled={!hasContent} data-testid="button-copy-html">
                      <Copy className="w-4 h-4 mr-2" />
                      Copy HTML
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportHtml} disabled={!hasContent} data-testid="button-export-html">
                      <FileText className="w-4 h-4 mr-2" />
                      Export HTML
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportPdf} disabled={!hasContent} data-testid="button-export-pdf">
                      <FileText className="w-4 h-4 mr-2" />
                      Export PDF
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleExportPng} disabled={!hasContent} data-testid="button-export-png">
                      <FileImage className="w-4 h-4 mr-2" />
                      Export PNG
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="default" size="sm" data-testid="button-delivery-menu">
                      <Send className="w-4 h-4 mr-1" />
                      Delivery
                      <ChevronDown className="w-3.5 h-3.5 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onClick={handleGetReviewLink} disabled={!hasContent} data-testid="button-review-link">
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Get review link
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => {
                        setSendDialogMode("schedule");
                        setSendDialogOpen(true);
                      }}
                      disabled={!hasContent}
                      data-testid="button-schedule"
                    >
                      <Clock3 className="w-4 h-4 mr-2" />
                      Schedule send
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => {
                        setSendDialogMode("send_now");
                        setSendDialogOpen(true);
                      }}
                      disabled={!hasContent}
                      data-testid="button-send-now"
                    >
                      <Send className="w-4 h-4 mr-2" />
                      Send now
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          </header>

          {isDeliveryStage && (
            <div
              className="px-4 py-2 border-b bg-amber-50/70 dark:bg-amber-950/10 flex items-center justify-between gap-3"
              data-testid="delivery-action-strip"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600" />
                  Manual delivery required
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                  <span>
                    Status: <span className="font-medium">{newsletter.status === "approved" ? "Approved" : "Scheduled"}</span>
                  </span>
                  <span>
                    Recipients:{" "}
                    {sendReadinessQuery.isLoading ? "..." : (sendReadinessQuery.data?.recipientsCount ?? 0)}
                  </span>
                  <span>
                    Blockers: <span className={deliveryBlockers.length > 0 ? "text-destructive font-medium" : "font-medium"}>{deliveryBlockers.length}</span>
                  </span>
                  <span>
                    Warnings: <span className={deliveryWarnings.length > 0 ? "text-amber-700 dark:text-amber-400 font-medium" : "font-medium"}>{deliveryWarnings.length}</span>
                  </span>
                  {unresolvedChangesWarning && (
                    <span className="text-amber-700 dark:text-amber-400">
                      {unresolvedChangesWarning.message}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0 text-xs text-muted-foreground">
                Use Delivery menu for review link, schedule, and send now.
              </div>
            </div>
          )}

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
                        Import HTML from Postcards (or any builder), then make quick edits directly in preview.
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
            enableBlockSuggestions={false}
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

      <SendConfirmDialog
        open={sendDialogOpen}
        mode={sendDialogMode}
        newsletterId={newsletterId}
        expectedSendDate={newsletter.expectedSendDate}
        onClose={async () => {
          setSendDialogOpen(false);
          await refetchNewsletter();
        }}
      />
    </div>
  );
}
