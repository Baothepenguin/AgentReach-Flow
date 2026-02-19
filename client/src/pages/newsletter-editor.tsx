import { useState, useRef, useCallback } from "react";
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
  Monitor,
  Smartphone,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type {
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
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [editingHtml, setEditingHtml] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
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
      <div className="flex flex-1 overflow-hidden bg-background">
        <div className="flex-1 flex flex-col min-w-0">
          <header className="border-b border-border/70 bg-background/90 backdrop-blur px-5 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  className="mt-0.5"
                  onClick={() => setLocation("/newsletters")}
                  data-testid="button-back"
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>

                <div className="min-w-0 space-y-1.5">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    {isEditingTitle ? (
                      <div className="flex items-center gap-1">
                        <Input
                          value={editedTitle}
                          onChange={(e) => setEditedTitle(e.target.value)}
                          className="h-8 w-56"
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
                          className="h-8 w-8"
                          onClick={() => editedTitle.trim() && updateTitleMutation.mutate(editedTitle.trim())}
                          data-testid="button-save-title"
                        >
                          <Check className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
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
                        className="text-[15px] font-semibold tracking-tight truncate hover:underline cursor-pointer flex items-center gap-1.5 group"
                        data-testid="button-edit-title"
                      >
                        {newsletter.title}
                        <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                      </button>
                    )}

                    <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground bg-muted/60">
                      {newsletter.status.replace("_", " ")}
                    </span>

                    {saveStatus === "saving" && (
                      <span className="inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300" data-testid="save-indicator-saving">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                        Saving
                      </span>
                    )}
                    {saveStatus === "saved" && (
                      <span className="inline-flex items-center gap-1 text-xs text-blue-700 dark:text-blue-300" data-testid="save-indicator-saved">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
                        Saved
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {client && (
                      <Link
                        href={`/clients/${client.id}`}
                        className="hover:text-foreground transition-colors inline-flex items-center gap-1"
                        data-testid="link-client-name"
                      >
                        <User className="w-3.5 h-3.5" />
                        {client.name}
                      </Link>
                    )}
                    <Popover open={showDatePicker} onOpenChange={setShowDatePicker}>
                      <PopoverTrigger asChild>
                        <Button variant="ghost" size="sm" className="h-7 px-2 text-muted-foreground" data-testid="button-edit-date">
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
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 pl-1">
                <Button
                  variant={editingHtml ? "secondary" : "outline"}
                  size="sm"
                  className="h-9"
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

                <div className="inline-flex items-center rounded-md border border-border bg-background overflow-hidden">
                  <Button
                    size="icon"
                    variant={previewDevice === "desktop" ? "secondary" : "ghost"}
                    className="h-8 w-8 rounded-none"
                    onClick={() => setPreviewDevice("desktop")}
                    data-testid="button-device-desktop-topbar"
                  >
                    <Monitor className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant={previewDevice === "mobile" ? "secondary" : "ghost"}
                    className="h-8 w-8 rounded-none"
                    onClick={() => setPreviewDevice("mobile")}
                    data-testid="button-device-mobile-topbar"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                  </Button>
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-9" data-testid="button-file-menu">
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
                    <Button variant="default" size="sm" className="h-9" data-testid="button-delivery-menu">
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
              className="mx-4 mt-3 rounded-xl border border-amber-200/80 bg-amber-50/80 px-4 py-3 flex items-center justify-between gap-3 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/20"
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
              <div className="flex items-center gap-2 flex-shrink-0 text-xs text-amber-800/90 dark:text-amber-200/80">
                Manual click required for every send.
              </div>
            </div>
          )}

          <div className="flex-1 min-h-0 relative p-4 pt-3">
            {editingHtml ? (
              <div className="h-full rounded-2xl border bg-card shadow-sm overflow-hidden flex flex-col">
                <div className="h-10 px-4 border-b bg-muted/30 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Raw HTML editor</span>
                  <span>Use this for full control over imported Postcards code.</span>
                </div>
                <Textarea
                  value={htmlDraft}
                  onChange={(e) => setHtmlDraft(e.target.value)}
                  className="flex-1 font-mono text-xs resize-none rounded-none border-0 focus-visible:ring-0 bg-card"
                  data-testid="textarea-html-editor"
                />
                <div className="flex items-center justify-between gap-2 p-3 border-t bg-background/90">
                  <p className="text-xs text-muted-foreground">Preview updates after save.</p>
                  <div className="flex items-center gap-2">
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
              </div>
            ) : (
              <>
                {hasContent ? (
                  <div className="h-full rounded-2xl border bg-card shadow-sm overflow-hidden">
                    <HTMLPreviewFrame
                      html={newsletterData?.html || ""}
                      isLoading={loadingNewsletter}
                      title={newsletter.title}
                      onHtmlChange={debouncedSaveHtml}
                      fullWidth
                      deviceMode={previewDevice}
                      onDeviceModeChange={setPreviewDevice}
                      showDeviceToggle={false}
                    />
                  </div>
                ) : (
                  <div className="flex-1 rounded-2xl border bg-card shadow-sm flex items-center justify-center">
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

        <div className="w-64 xl:w-72 flex-shrink-0 border-l bg-background/70 backdrop-blur-sm">
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
