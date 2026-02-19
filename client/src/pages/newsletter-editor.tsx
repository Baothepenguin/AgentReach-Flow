import { useState, useRef, useCallback } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
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
import { Sheet, SheetContent } from "@/components/ui/sheet";
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
  FileText,
  Clock3,
  Send,
  Monitor,
  Smartphone,
  UserSquare2,
  Bot,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type {
  Newsletter,
  NewsletterVersion,
  NewsletterDocument,
  Client,
  TasksFlags,
  Invoice,
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
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [rightRailMode, setRightRailMode] = useState<"ai" | "client">("client");
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
    invoice?: Invoice | null;
  }>({
    queryKey: ["/api/newsletters", newsletterId],
  });

  const newsletter = newsletterData?.newsletter;
  const client = newsletter?.client;

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

  const openRightRail = (mode: "ai" | "client", options?: { openClientSheet?: boolean }) => {
    setRightRailMode(mode);
    if (mode === "ai") {
      setShowClientPanel(false);
      setChatCollapsed(false);
    } else {
      setChatCollapsed(true);
      if (options?.openClientSheet) {
        setShowClientPanel(true);
      }
    }

    if (typeof window !== "undefined" && window.innerWidth < 1024) {
      setMobileRailOpen(true);
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
      if (!data.reviewUrl) {
        throw new Error("No review link returned");
      }

      window.open(data.reviewUrl, "_blank");
      try {
        await navigator.clipboard.writeText(data.reviewUrl);
        toast({ title: "Review link copied and opened" });
      } catch {
        toast({ title: "Review link opened", description: data.reviewUrl });
      }
    } catch (error: any) {
      toast({
        title: "Failed to generate review link",
        description: error?.message || "Try again.",
        variant: "destructive",
      });
    }
  };

  const handleSendTestEmail = async () => {
    const toEmail = window.prompt("Send test email to:");
    if (!toEmail) return;
    try {
      const res = await fetch(`/api/newsletters/${newsletterId}/send-test`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toEmail }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const blockerMessage = Array.isArray(data?.blockers) && data.blockers.length > 0
          ? data.blockers[0]?.message
          : null;
        throw new Error(blockerMessage || data?.error || "Failed to send test email");
      }

      const warnings = Array.isArray(data?.warnings) ? data.warnings : [];
      const warningText = warnings.length > 0
        ? `Sent to ${toEmail}. Warning: ${warnings[0]?.message || "Review QA warnings."}`
        : `Sent to ${toEmail}`;
      toast({ title: "Test email sent", description: warningText });
    } catch (error: any) {
      toast({
        title: "Test email failed",
        description: error?.message || "Unable to send test email",
        variant: "destructive",
      });
    }
  };

  const handleImportHtml = () => {
    if (!importHtml.trim()) return;
    updateHtmlMutation.mutate(importHtml.trim());
    setImportHtml("");
    setShowImportDialog(false);
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
        <div className="hidden lg:block w-60 xl:w-72 flex-shrink-0 border-r bg-background">
          <RightPanel
            newsletterId={newsletterId}
            status={newsletter.status}
            onStatusChange={(status) => updateStatusMutation.mutate(status)}
            assignedToId={newsletter.assignedToId}
            onAssignedToChange={(assignedToId) => updateAssignedToMutation.mutate(assignedToId)}
          />
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="border-b bg-background px-3 sm:px-5 py-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Button
                  variant="ghost"
                  size="icon"
                  className="mt-0"
                  onClick={() => setLocation("/newsletters")}
                  data-testid="button-back"
                >
                  <ArrowLeft className="w-5 h-5" />
                </Button>

                <div className="min-w-0">
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

                    {client && (
                      <div className="inline-flex items-center gap-2">
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1"
                          onClick={() => {
                            openRightRail("client", { openClientSheet: true });
                          }}
                          data-testid="link-client-name"
                        >
                          <User className="w-3.5 h-3.5" />
                          {client.name}
                        </button>
                        {newsletterData?.invoice?.id && (
                          <span className="text-[11px] text-muted-foreground">
                            Order #{newsletterData.invoice.id.slice(0, 8)}
                          </span>
                        )}
                      </div>
                    )}

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
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-1.5 pl-1">
                <Popover open={showDatePicker} onOpenChange={setShowDatePicker}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs sm:text-sm" data-testid="button-edit-date">
                      <CalendarIcon className="w-3.5 h-3.5 mr-1.5" />
                      {newsletter.expectedSendDate
                        ? format(new Date(newsletter.expectedSendDate), "MMM d, yyyy")
                        : "Set date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="end">
                    <Calendar
                      mode="single"
                      selected={newsletter.expectedSendDate ? new Date(newsletter.expectedSendDate) : undefined}
                      onSelect={(date) => date && updateDateMutation.mutate(format(date, "yyyy-MM-dd"))}
                      data-testid="calendar-send-date"
                    />
                  </PopoverContent>
                </Popover>

                <Button
                  variant={editingHtml ? "secondary" : "outline"}
                  size="sm"
                  className="h-8 px-2.5 text-xs sm:text-sm"
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
                    <Button variant="outline" size="sm" className="h-8 px-2.5 text-xs sm:text-sm" data-testid="button-file-menu">
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
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="default" size="sm" className="h-8 px-2.5 text-xs sm:text-sm" data-testid="button-delivery-menu">
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
                    <DropdownMenuItem onClick={handleSendTestEmail} disabled={!hasContent} data-testid="button-send-test">
                      <Send className="w-4 h-4 mr-2" />
                      Send test email
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

                {client && (
                  <div className="inline-flex items-center rounded-md border border-border bg-background overflow-hidden">
                    <Button
                      size="sm"
                      variant={rightRailMode === "client" ? "secondary" : "ghost"}
                      className="h-8 rounded-none text-xs px-2.5"
                      onClick={() => {
                        openRightRail("client");
                      }}
                      data-testid="button-open-client-rail"
                    >
                      <UserSquare2 className="w-3.5 h-3.5 mr-1.5" />
                      <span className="hidden sm:inline">Client</span>
                    </Button>
                    <Button
                      size="sm"
                      variant={rightRailMode === "ai" ? "secondary" : "ghost"}
                      className="h-8 rounded-none text-xs px-2.5"
                      onClick={() => {
                        openRightRail("ai");
                      }}
                      data-testid="button-open-ai-rail"
                    >
                      <Bot className="w-3.5 h-3.5 mr-1.5" />
                      <span className="hidden sm:inline">AI</span>
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </header>

          <div className="flex-1 min-h-0 relative p-2 sm:p-4 sm:pt-3">
            {editingHtml ? (
              <div className="h-full rounded-xl border bg-card overflow-hidden flex flex-col">
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
                  <div className="h-full rounded-xl border bg-card overflow-hidden">
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
                  <div className="flex-1 rounded-xl border bg-card flex items-center justify-center">
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

        {client && (
          <div className="hidden lg:flex w-[340px] xl:w-[360px] flex-shrink-0 border-l bg-background">
            {rightRailMode === "ai" ? (
              <GeminiChatPanel
                newsletterId={newsletterId}
                clientId={client.id}
                clientName={client.name}
                collapsed={chatCollapsed}
                onToggleCollapse={() => setChatCollapsed(!chatCollapsed)}
                enableBlockSuggestions={false}
                fullWidth
                hideOuterBorder
                className="h-full"
              />
            ) : (
              <div className="w-full p-4 space-y-3">
                <div className="text-sm font-medium">Client Context</div>
                <div className="rounded-md border bg-card p-3 space-y-2">
                  <div className="text-sm font-semibold">{client.name}</div>
                  <div className="text-xs text-muted-foreground">{client.primaryEmail}</div>
                  {client.locationCity || client.locationRegion ? (
                    <div className="text-xs text-muted-foreground">
                      {[client.locationCity, client.locationRegion].filter(Boolean).join(", ")}
                    </div>
                  ) : null}
                  <div className="flex items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                      onClick={() => setShowClientPanel(true)}
                      data-testid="button-open-client-card"
                    >
                      Open Client Card
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 text-xs"
                      onClick={() => setLocation(`/clients?clientId=${client.id}`)}
                      data-testid="button-open-in-clients"
                    >
                      Open in Clients
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {client && (
        <Sheet open={mobileRailOpen} onOpenChange={setMobileRailOpen}>
          <SheetContent side="right" className="w-[94vw] max-w-[420px] p-0 lg:hidden">
            <div className="flex h-full flex-col bg-background">
              <div className="flex items-center justify-between border-b px-3 py-2">
                <div className="text-sm font-medium">{rightRailMode === "ai" ? "AI Chat" : "Client Context"}</div>
                <div className="inline-flex items-center rounded-md border border-border bg-background overflow-hidden">
                  <Button
                    size="sm"
                    variant={rightRailMode === "client" ? "secondary" : "ghost"}
                    className="h-8 rounded-none text-xs px-2.5"
                    onClick={() => openRightRail("client")}
                  >
                    <UserSquare2 className="w-3.5 h-3.5 mr-1.5" />
                    Client
                  </Button>
                  <Button
                    size="sm"
                    variant={rightRailMode === "ai" ? "secondary" : "ghost"}
                    className="h-8 rounded-none text-xs px-2.5"
                    onClick={() => openRightRail("ai")}
                  >
                    <Bot className="w-3.5 h-3.5 mr-1.5" />
                    AI
                  </Button>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                {rightRailMode === "ai" ? (
                  <GeminiChatPanel
                    newsletterId={newsletterId}
                    clientId={client.id}
                    clientName={client.name}
                    collapsed={false}
                    onToggleCollapse={() => setMobileRailOpen(false)}
                    enableBlockSuggestions={false}
                    fullWidth
                    hideOuterBorder
                    className="h-full"
                  />
                ) : (
                  <div className="p-4 space-y-3">
                    <div className="rounded-md border bg-card p-3 space-y-2">
                      <div className="text-sm font-semibold">{client.name}</div>
                      <div className="text-xs text-muted-foreground">{client.primaryEmail}</div>
                      {client.locationCity || client.locationRegion ? (
                        <div className="text-xs text-muted-foreground">
                          {[client.locationCity, client.locationRegion].filter(Boolean).join(", ")}
                        </div>
                      ) : null}
                      <div className="flex items-center gap-2 pt-1">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => {
                            setShowClientPanel(true);
                            setMobileRailOpen(false);
                          }}
                        >
                          Open Client Card
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-8 text-xs"
                          onClick={() => {
                            setMobileRailOpen(false);
                            setLocation(`/clients?clientId=${client.id}`);
                          }}
                        >
                          Open in Clients
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </SheetContent>
        </Sheet>
      )}

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
