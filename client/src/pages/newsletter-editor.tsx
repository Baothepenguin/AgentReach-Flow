import { useState, useRef, useCallback, useEffect, type ChangeEvent } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { TopNav } from "@/components/TopNav";
import { RightPanel } from "@/components/RightPanel";
import { HTMLPreviewFrame } from "@/components/HTMLPreviewFrame";
import { GeminiChatPanel } from "@/components/GeminiChatPanel";
import { SendConfirmDialog } from "@/components/SendConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
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
  Send,
  Monitor,
  Smartphone,
  Bot,
  PanelLeftOpen,
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

export default function NewsletterEditorPage({ newsletterId }: NewsletterEditorPageProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [mobileRailOpen, setMobileRailOpen] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [leftRailCollapsed, setLeftRailCollapsed] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editedTitle, setEditedTitle] = useState("");
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [editingHtml, setEditingHtml] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [htmlDraft, setHtmlDraft] = useState("");
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importHtml, setImportHtml] = useState("");
  const [importHtmlFileName, setImportHtmlFileName] = useState("");
  const importHtmlInputRef = useRef<HTMLInputElement | null>(null);
  const saveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const saveStatusTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { data: newsletterData, isLoading: loadingNewsletter, refetch: refetchNewsletter } = useQuery<{
    newsletter: Newsletter & { client?: Client };
    client?: Client;
    document: NewsletterDocument;
    versions: NewsletterVersion[];
    flags: TasksFlags[];
    html: string;
    invoice?: Invoice | null;
  }>({
    queryKey: ["/api/newsletters", newsletterId],
    refetchInterval: (query) => {
      if (typeof document !== "undefined" && document.visibilityState !== "visible") {
        return false;
      }
      const status = (query.state.data as any)?.newsletter?.status;
      return status === "in_review" || status === "changes_requested" ? 15000 : false;
    },
    refetchOnWindowFocus: true,
  });

  const newsletter = newsletterData?.newsletter;
  const client = newsletterData?.client || newsletter?.client || null;
  const isDiySimpleMode = (user as any)?.accountType === "diy_customer";

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
      if (saveStatusTimerRef.current) {
        clearTimeout(saveStatusTimerRef.current);
      }
      saveStatusTimerRef.current = setTimeout(() => setSaveStatus("idle"), 2000);
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

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
      }
      if (saveStatusTimerRef.current) {
        clearTimeout(saveStatusTimerRef.current);
      }
    };
  }, []);

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

  const openAiRail = () => {
    setChatCollapsed(false);
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

  const handleImportHtml = () => {
    if (!importHtml.trim()) return;
    updateHtmlMutation.mutate(importHtml.trim());
    setImportHtml("");
    setImportHtmlFileName("");
    setShowImportDialog(false);
  };

  const handleImportHtmlFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    if (!file) return;
    const fileName = file.name.toLowerCase();
    const hasHtmlExtension = /\.(html?|xhtml)$/i.test(fileName);
    const hasHtmlMime =
      !file.type ||
      ["text/html", "text/plain", "application/xhtml+xml"].includes(file.type.toLowerCase());
    if (!hasHtmlExtension && !hasHtmlMime) {
      toast({
        title: "Invalid file",
        description: "Please upload an HTML file.",
        variant: "destructive",
      });
      event.currentTarget.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === "string" ? reader.result : "";
      if (!text.trim()) {
        toast({
          title: "Empty file",
          description: "This file has no HTML content.",
          variant: "destructive",
        });
        return;
      }
      setImportHtml(text);
      setImportHtmlFileName(file.name);
      setShowImportDialog(true);
    };
    reader.onerror = () => {
      toast({
        title: "Upload failed",
        description: "Could not read the HTML file.",
        variant: "destructive",
      });
    };
    reader.readAsText(file);
    event.currentTarget.value = "";
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

  const formattedSendDate = newsletter.expectedSendDate
    ? format(new Date(newsletter.expectedSendDate), "MMM d, yyyy")
    : "No send date";
  const clientId = client?.id || newsletter.clientId;
  const clientName = client?.name || "Client";
  const desktopRailWidthClass = chatCollapsed
    ? "w-14"
    : leftRailCollapsed
      ? "w-[420px] xl:w-[520px]"
      : "w-[360px] lg:w-[420px] xl:w-[500px]";
  const topControlButtonClass = "h-9 px-3 text-sm font-medium rounded-full border-0 bg-muted/35 hover:bg-muted/55 shadow-none";
  const topIconButtonClass = "h-9 w-9 rounded-full border-0 bg-muted/35 hover:bg-muted/55";
  const topSegmentClass = "inline-flex items-center rounded-full bg-muted/30 p-0.5";

  return (
    <div className="flex flex-col h-screen w-full bg-background">
      <TopNav />
      <div className="flex flex-1 overflow-hidden bg-background">
        {!isDiySimpleMode && (
          <div
            className={`hidden lg:flex flex-shrink-0 bg-background/70 flex-col pb-3 transition-all ${
              leftRailCollapsed ? "w-14 px-2" : "w-60 xl:w-64 px-3"
            }`}
          >
            <div className="pt-3 pb-2 flex items-center justify-between gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 w-8 justify-center px-0 rounded-full"
                onClick={() => setLocation("/newsletters")}
                data-testid="button-back"
              >
                <ArrowLeft className="w-4 h-4" />
              </Button>
              {leftRailCollapsed ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 justify-center px-0 rounded-full"
                  onClick={() => setLeftRailCollapsed(false)}
                  data-testid="button-toggle-left-rail"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </Button>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 rounded-full px-3 text-xs font-medium"
                  onClick={() => setLeftRailCollapsed(true)}
                  data-testid="button-toggle-left-rail"
                >
                  Menu
                </Button>
              )}
            </div>

            {leftRailCollapsed ? (
              <div className="flex-1 min-h-0" />
            ) : (
              <div className="flex-1 min-h-0 rounded-lg bg-background/70">
                <RightPanel
                  newsletterId={newsletterId}
                  status={newsletter.status}
                  onStatusChange={(status) => updateStatusMutation.mutate(status)}
                  assignedToId={newsletter.assignedToId}
                  onAssignedToChange={(assignedToId) => updateAssignedToMutation.mutate(assignedToId)}
                />
              </div>
            )}
          </div>
        )}

        <div className="flex-1 flex flex-col min-w-0">
          <header className="bg-background px-4 lg:px-5 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <div className="flex min-w-0 items-center gap-2 lg:hidden">
                  <Button
                    variant="ghost"
                    size="icon"
                    className={topIconButtonClass}
                    onClick={() => setLocation("/newsletters")}
                    data-testid="button-back-mobile"
                  >
                    <ArrowLeft className="w-4 h-4" />
                  </Button>
                  {isEditingTitle ? (
                    <div className="flex items-center gap-1">
                      <Input
                        value={editedTitle}
                        onChange={(e) => setEditedTitle(e.target.value)}
                        className="h-9 w-56 text-base"
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
                        className={topIconButtonClass}
                        onClick={() => editedTitle.trim() && updateTitleMutation.mutate(editedTitle.trim())}
                        data-testid="button-save-title"
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className={topIconButtonClass}
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
                      className="text-base font-semibold tracking-tight truncate hover:underline cursor-pointer flex items-center gap-1.5 group"
                      data-testid="button-edit-title"
                    >
                      {newsletter.title}
                      <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                    </button>
                  )}
                </div>

                <Popover open={showDatePicker} onOpenChange={setShowDatePicker}>
                  <PopoverTrigger asChild>
                    <Button variant="ghost" size="sm" className={topControlButtonClass} data-testid="button-edit-date">
                      <CalendarIcon className="w-3.5 h-3.5 mr-1.5" />
                      {formattedSendDate}
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

                <Button
                  variant={editingHtml ? "secondary" : "ghost"}
                  size="sm"
                  className={topControlButtonClass}
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

                <div className={topSegmentClass}>
                  <Button
                    size="icon"
                    variant={previewDevice === "desktop" ? "secondary" : "ghost"}
                    className="h-8 w-8 rounded-full"
                    onClick={() => setPreviewDevice("desktop")}
                    data-testid="button-device-desktop-topbar"
                  >
                    <Monitor className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant={previewDevice === "mobile" ? "secondary" : "ghost"}
                    className="h-8 w-8 rounded-full"
                    onClick={() => setPreviewDevice("mobile")}
                    data-testid="button-device-mobile-topbar"
                  >
                    <Smartphone className="w-3.5 h-3.5" />
                  </Button>
                </div>

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
                {isDiySimpleMode && (
                  <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                    Simple Mode
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-end gap-1.5 pl-1">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" className={topControlButtonClass} data-testid="button-file-menu">
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
                    {!isDiySimpleMode && (
                      <DropdownMenuItem onClick={handleGetReviewLink} disabled={!hasContent} data-testid="button-review-link">
                        <ExternalLink className="w-4 h-4 mr-2" />
                        Get review link
                      </DropdownMenuItem>
                    )}
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

                <Button
                  variant="default"
                  size="sm"
                  className="h-9 px-3 text-sm font-medium rounded-full"
                  onClick={() => setSendDialogOpen(true)}
                  disabled={!hasContent}
                  data-testid="button-open-delivery-panel"
                >
                  <Send className="w-4 h-4 mr-1" />
                  Delivery
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className={`${topControlButtonClass} lg:hidden`}
                  onClick={openAiRail}
                  data-testid="button-open-ai-chat-mobile"
                >
                  <Bot className="w-4 h-4 mr-1" />
                  AI
                </Button>

              </div>
            </div>
          </header>

          <div className="flex-1 min-h-0 relative p-2 sm:p-4 sm:pt-2">
            {editingHtml ? (
              <div className="h-full rounded-xl bg-card/80 overflow-hidden flex flex-col shadow-sm">
                <div className="h-10 px-4 bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Raw HTML editor</span>
                  <span>Use this for full control over imported Postcards code.</span>
                </div>
                <Textarea
                  value={htmlDraft}
                  onChange={(e) => setHtmlDraft(e.target.value)}
                  className="flex-1 font-mono text-xs resize-none rounded-none border-0 focus-visible:ring-0 bg-card"
                  data-testid="textarea-html-editor"
                />
                <div className="flex items-center justify-between gap-2 p-3 bg-background/90">
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
                  <div className="h-full rounded-2xl overflow-hidden">
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
                  <div className="flex-1 rounded-2xl bg-background flex items-center justify-center">
                    <div className="flex flex-col items-center justify-center text-center p-12 max-w-md space-y-3">
                      <div className="w-14 h-14 rounded-full bg-muted/35 flex items-center justify-center">
                        <Code className="w-7 h-7 text-muted-foreground" />
                      </div>
                      <p className="text-lg font-medium">Get started</p>
                      <p className="text-sm text-muted-foreground max-w-sm">
                        Import HTML from Postcards, then edit directly in preview.
                      </p>
                      <Button
                        onClick={() => setShowImportDialog(true)}
                        className="rounded-full px-5"
                        data-testid="button-import-html"
                      >
                        <Upload className="w-4 h-4 mr-2" />
                        Import HTML
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

	        <div className={`hidden md:flex ${desktopRailWidthClass} flex-shrink-0 bg-background/80 transition-all`}>
	          <GeminiChatPanel
	            newsletterId={newsletterId}
	            clientId={clientId}
	            clientName={clientName}
	            collapsed={chatCollapsed}
	            onToggleCollapse={() => setChatCollapsed(!chatCollapsed)}
	            enableBlockSuggestions={false}
              allowPromptEditing={false}
	            fullWidth
	            hideOuterBorder
	            className="h-full"
	          />
	        </div>
	      </div>

	      <Sheet open={mobileRailOpen} onOpenChange={setMobileRailOpen}>
	        <SheetContent side="right" className="w-[94vw] max-w-[420px] p-0 md:hidden">
	          <div className="flex h-full flex-col bg-background">
	            <div className="flex items-center justify-between border-b px-3 py-2">
	              <div className="text-sm font-medium">AI Chat</div>
	            </div>
	            <div className="flex-1 min-h-0">
	              <GeminiChatPanel
	                newsletterId={newsletterId}
	                clientId={clientId}
	                clientName={clientName}
	                collapsed={false}
	                onToggleCollapse={() => setMobileRailOpen(false)}
	                enableBlockSuggestions={false}
                  allowPromptEditing={false}
	                fullWidth
	                hideOuterBorder
	                className="h-full"
	              />
	            </div>
	          </div>
	        </SheetContent>
	      </Sheet>

      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Import HTML</DialogTitle>
            <DialogDescription>
              Paste your newsletter HTML code below, or upload an .html file.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                ref={importHtmlInputRef}
                type="file"
                accept=".html,.htm,text/html"
                onChange={handleImportHtmlFileChange}
                className="hidden"
                id="import-html-file-input"
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => importHtmlInputRef.current?.click()}
                className="gap-2"
                data-testid="button-upload-html-file"
              >
                <Upload className="w-4 h-4" />
                Upload HTML File
              </Button>
              {importHtmlFileName && (
                <span className="text-xs text-muted-foreground truncate" title={importHtmlFileName}>
                  {importHtmlFileName}
                </span>
              )}
            </div>
            <Textarea
              value={importHtml}
              onChange={(e) => {
                setImportHtml(e.target.value);
                if (importHtmlFileName) setImportHtmlFileName("");
              }}
              placeholder="Paste HTML here..."
              className="min-h-[200px] font-mono text-xs"
              data-testid="textarea-import-html"
            />
          </div>
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
