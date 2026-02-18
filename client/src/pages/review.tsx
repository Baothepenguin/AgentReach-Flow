import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  CheckCircle2, 
  MessageSquare, 
  AlertCircle, 
  Loader2, 
  Monitor, 
  Smartphone, 
  CheckSquare,
  Paperclip,
  X,
  Image as ImageIcon,
  FileText,
  Download,
  Send,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import type { ReviewComment } from "@shared/schema";

interface ReviewData {
  newsletter: {
    id: string;
    title: string;
    clientName: string;
  };
  html: string;
  expired: boolean;
}

interface UploadedFile {
  name: string;
  objectPath: string;
  type: string;
}

export default function ReviewPage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const [comment, setComment] = useState("");
  const [approved, setApproved] = useState(false);
  const [deviceMode, setDeviceMode] = useState<"desktop" | "mobile">("desktop");
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const FLOWPATH_PREFIX = "flowpath:";

  const getAttachmentUrl = (path: string) => {
    if (!path) return "#";
    const withoutQuery = path.split("?")[0] || path;

    // Prefer the serverless-friendly /api/objects route on Vercel.
    if (withoutQuery.startsWith("/api/objects/")) {
      return token
        ? `${withoutQuery}?reviewToken=${encodeURIComponent(token)}`
        : withoutQuery;
    }
    if (withoutQuery.startsWith("/objects/")) {
      const suffix = withoutQuery.slice("/objects/".length);
      const apiPath = `/api/objects/${suffix}`;
      return token
        ? `${apiPath}?reviewToken=${encodeURIComponent(token)}`
        : apiPath;
    }

    // Fallback for unexpected formats (absolute URLs, etc).
    return withoutQuery;
  };

  const buildFlowInlinePath = (element: Element): string => {
    const parts: string[] = [];
    let current: Element | null = element;
    while (current && current.tagName.toLowerCase() !== "html") {
      const parentEl: HTMLElement | null = current.parentElement;
      if (!parentEl) break;
      const tag = current.tagName.toLowerCase();
      const sameTagSiblings: Element[] = (Array.from(parentEl.children) as Element[]).filter(
        (child: Element) => child.tagName.toLowerCase() === tag
      );
      const index = sameTagSiblings.indexOf(current);
      if (index < 0) break;
      parts.push(`${tag}[${index}]`);
      current = parentEl;
    }
    parts.push("html[0]");
    return parts.reverse().join("/");
  };

  const getElementByFlowInlinePath = (doc: Document, sectionId: string): HTMLElement | null => {
    const rawPath = sectionId.startsWith(FLOWPATH_PREFIX)
      ? sectionId.slice(FLOWPATH_PREFIX.length)
      : sectionId;
    const parts = rawPath.split("/").filter(Boolean);
    if (parts.length === 0) return null;

    let current: Element | null = doc.documentElement;
    // First segment should be html[0]; skip it.
    for (let i = 1; i < parts.length; i++) {
      const match = parts[i].match(/^([a-z0-9]+)\[(\d+)\]$/i);
      if (!match) return null;
      const tag = match[1].toLowerCase();
      const index = Number(match[2]);
      if (!Number.isFinite(index) || index < 0) return null;
      if (!current) return null;
      const currentEl = current;
      const sameTagChildren: Element[] = (Array.from(currentEl.children) as Element[]).filter(
        (child: Element) => child.tagName.toLowerCase() === tag
      );
      const nextEl: Element | undefined = sameTagChildren[index];
      if (!nextEl) return null;
      current = nextEl;
    }
    return current as HTMLElement | null;
  };

  const applyInlineSelectedClass = (element: HTMLElement) => {
    if (element.tagName.toLowerCase() === "tr") {
      const cells = Array.from(element.children).filter((child) => {
        const tag = child.tagName.toLowerCase();
        return tag === "td" || tag === "th";
      }) as HTMLElement[];
      if (cells.length > 0) {
        cells.forEach((cell) => cell.classList.add("flow-inline-selected"));
        return;
      }
    }
    element.classList.add("flow-inline-selected");
  };

  const { data, isLoading, error } = useQuery<ReviewData>({
    queryKey: ["/api/review", token],
    enabled: !!token,
    retry: false,
  });

  const { data: existingComments = [], refetch: refetchComments } = useQuery<ReviewComment[]>({
    queryKey: ["/api/review", token, "comments"],
    queryFn: async () => {
      const res = await fetch(`/api/review/${token}/comments`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!token && !approved,
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/review/${token}/approve`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to approve");
      return res.json();
    },
    onSuccess: () => {
      setApproved(true);
      toast({ title: "Newsletter approved!" });
    },
  });

  const addCommentMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/review/${token}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          content: comment,
          sectionId: selectedSectionId || null,
          commentType: selectedSectionId ? "content" : "general",
          attachments: attachments.map(a => a.objectPath),
        }),
      });
      if (!res.ok) throw new Error("Failed to submit");
      return res.json();
    },
    onSuccess: () => {
      setComment("");
      setAttachments([]);
      setSelectedSectionId(null);
      refetchComments();
      toast({ title: "Feedback submitted" });
    },
  });

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    let clickHandler: ((event: MouseEvent) => void) | null = null;

    const attachHandlers = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;

      if (!doc.getElementById("flow-review-inline-style")) {
        const style = doc.createElement("style");
        style.id = "flow-review-inline-style";
        style.textContent = `
          [data-block-id] { cursor: pointer; }
          .flow-inline-selected { outline: 2px solid rgba(244, 114, 36, 0.85); outline-offset: -2px; }
        `;
        doc.head.appendChild(style);
      }

      if (clickHandler) {
        doc.removeEventListener("click", clickHandler);
      }

      clickHandler = (event: MouseEvent) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;

        // Prefer stable block IDs when available (Flow block editor output).
        const block = target.closest("[data-block-id]") as HTMLElement | null;
        if (block) {
          const blockId = block.getAttribute("data-block-id");
          if (!blockId) return;
          event.preventDefault();
          setSelectedSectionId(blockId);
          return;
        }

        // Fallback for imported HTML: compute a deterministic DOM path.
        const td = target.closest("td, th") as HTMLElement | null;
        const tr = target.closest("tr") as HTMLElement | null;
        const table = target.closest("table") as HTMLElement | null;
        const anchor = td || tr || table;
        if (!anchor || anchor === doc.body || anchor === doc.documentElement) return;
        const path = buildFlowInlinePath(anchor);
        if (!path) return;
        event.preventDefault();
        setSelectedSectionId(`${FLOWPATH_PREFIX}${path}`);
      };

      doc.addEventListener("click", clickHandler);
    };

    iframe.addEventListener("load", attachHandlers);
    if (iframe.contentDocument?.readyState === "complete") {
      attachHandlers();
    }

    return () => {
      iframe.removeEventListener("load", attachHandlers);
      if (clickHandler && iframe.contentDocument) {
        iframe.contentDocument.removeEventListener("click", clickHandler);
      }
    };
  }, [data?.html]);

  useEffect(() => {
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    doc.querySelectorAll(".flow-inline-selected").forEach((node) => {
      node.classList.remove("flow-inline-selected");
    });
    if (!selectedSectionId) return;

    let selectedElement: HTMLElement | null = null;
    if (selectedSectionId.startsWith(FLOWPATH_PREFIX)) {
      selectedElement = getElementByFlowInlinePath(doc, selectedSectionId);
    } else {
      try {
        const escaped = typeof (globalThis as any).CSS?.escape === "function"
          ? (globalThis as any).CSS.escape(selectedSectionId)
          : selectedSectionId;
        selectedElement = doc.querySelector(`[data-block-id="${escaped}"]`) as HTMLElement | null;
      } catch {
        selectedElement = doc.querySelector(`[data-block-id="${selectedSectionId}"]`) as HTMLElement | null;
      }
    }

    if (selectedElement) {
      applyInlineSelectedClass(selectedElement);
    }
  }, [selectedSectionId, data?.html]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (!token) {
      toast({ title: "Missing review token", variant: "destructive" });
      return;
    }

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const urlRes = await fetch(`/api/review/${token}/uploads/request-url`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: file.name,
            size: file.size,
            contentType: file.type || "application/octet-stream",
          }),
        });

        if (!urlRes.ok) {
          toast({ title: "Failed to prepare upload", variant: "destructive" });
          continue;
        }

        const { uploadURL, objectPath } = await urlRes.json();

        const uploadRes = await fetch(uploadURL, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });

        if (!uploadRes.ok) {
          toast({ title: "Failed to upload file", variant: "destructive" });
          continue;
        }

        setAttachments(prev => [...prev, { name: file.name, objectPath, type: file.type }]);
      }
    } finally {
      setUploading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments(prev => prev.filter((_, i) => i !== index));
  };

  const getFileIcon = (type: string) => {
    if (type.startsWith("image/")) {
      return <ImageIcon className="w-3 h-3" />;
    }
    return <FileText className="w-3 h-3" />;
  };

  const getAttachmentFileName = (path: string) => {
    const parts = path.split("/");
    return parts[parts.length - 1] || `Attachment`;
  };

  const pendingComments = existingComments.filter(c => !c.isCompleted);
  const completedComments = existingComments.filter(c => c.isCompleted);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted/30 flex items-center justify-center">
        <Skeleton className="h-[80vh] w-[600px] rounded-lg" />
      </div>
    );
  }

  if (error || data?.expired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
        <Card className="p-8 text-center max-w-md">
          <AlertCircle className="w-12 h-12 mx-auto text-destructive mb-4" />
          <h1 className="text-xl font-semibold mb-2">Link Expired or Invalid</h1>
          <p className="text-sm text-muted-foreground">
            This review link is no longer valid. Please contact your agent for a new link.
          </p>
        </Card>
      </div>
    );
  }

  if (approved) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
        <Card className="p-8 text-center max-w-md">
          <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-4" />
          <h1 className="text-xl font-semibold mb-2">Thank You!</h1>
          <p className="text-sm text-muted-foreground">
            Your newsletter has been approved. You can close this page.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-screen bg-muted/30 flex overflow-hidden">
      <div className="flex-1 flex items-center justify-center p-4 relative">
        <div 
          className={`bg-white shadow-2xl overflow-hidden ${
            deviceMode === "mobile" ? "rounded-[40px] border-4 border-gray-700" : "w-full h-full"
          }`}
          style={{ 
            width: deviceMode === "mobile" ? "375px" : "100%",
            height: deviceMode === "mobile" ? "667px" : "100%",
          }}
        >
          <iframe
            ref={iframeRef}
            srcDoc={data?.html}
            title="Newsletter Preview"
            className="w-full h-full border-0"
            sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
            data-testid="iframe-review-preview"
          />
        </div>

        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-background/95 backdrop-blur-sm rounded-full p-1 shadow-lg border">
          <Button
            size="icon"
            variant={deviceMode === "desktop" ? "secondary" : "ghost"}
            onClick={() => setDeviceMode("desktop")}
            className="rounded-full"
            data-testid="button-device-desktop"
          >
            <Monitor className="w-4 h-4" />
          </Button>
          <Button
            size="icon"
            variant={deviceMode === "mobile" ? "secondary" : "ghost"}
            onClick={() => setDeviceMode("mobile")}
            className="rounded-full"
            data-testid="button-device-mobile"
          >
            <Smartphone className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="w-80 bg-background border-l flex flex-col">
        <div className="p-4 border-b">
          <h1 className="font-semibold" data-testid="text-newsletter-title">{data?.newsletter.title}</h1>
          <p className="text-sm text-muted-foreground" data-testid="text-client-name">{data?.newsletter.clientName}</p>
        </div>

        <div className="p-3 border-b">
          <div className="flex items-center gap-2 text-sm font-medium">
            <MessageSquare className="w-4 h-4" />
            Feedback
            {pendingComments.length > 0 && (
              <Badge variant="secondary" className="text-xs">{pendingComments.length}</Badge>
            )}
          </div>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            {existingComments.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                No feedback yet. Use the box below to leave a comment.
              </div>
            ) : (
              <>
                {pendingComments.map((c) => (
                  <div
                    key={c.id}
                    className="p-2 rounded-md bg-muted/30 border border-amber-500/40"
                    data-testid={`comment-${c.id}`}
                  >
                    <p className="text-sm">{c.content}</p>
                    {c.sectionId && (
                      <p className="text-xs text-amber-700 mt-1">Inline: {c.sectionId}</p>
                    )}
                    {c.attachments && c.attachments.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {c.attachments.map((path, i) => (
                          <a
                            key={i}
                            href={getAttachmentUrl(path)}
                            target="_blank"
                            rel="noopener noreferrer"
                            download
                            className="flex items-center gap-1 px-2 py-0.5 text-xs bg-background rounded border"
                            data-testid={`link-attachment-${c.id}-${i}`}
                          >
                            <Download className="w-3 h-3" />
                            <span className="max-w-[100px] truncate">{getAttachmentFileName(path)}</span>
                          </a>
                        ))}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      {format(new Date(c.createdAt), "MMM d, yyyy 'at' h:mm a")}
                    </p>
                  </div>
                ))}

                {completedComments.length > 0 && (
                  <div className="pt-2">
                    <div className="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-1">
                      <CheckSquare className="w-3 h-3" />
                      Resolved ({completedComments.length})
                    </div>
                    {completedComments.map((c) => (
                      <div
                        key={c.id}
                        className="p-2 rounded-md bg-muted/20 mb-2"
                        data-testid={`comment-${c.id}`}
                      >
                        <p className="text-sm line-through text-muted-foreground">{c.content}</p>
                        {c.sectionId && (
                          <p className="text-xs text-muted-foreground mt-1">Inline: {c.sectionId}</p>
                        )}
                        {c.attachments && c.attachments.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-2">
                            {c.attachments.map((path, i) => (
                              <a
                                key={i}
                                href={getAttachmentUrl(path)}
                                target="_blank"
                                rel="noopener noreferrer"
                                download
                                className="flex items-center gap-1 px-2 py-0.5 text-xs bg-background rounded border"
                                data-testid={`link-attachment-${c.id}-${i}`}
                              >
                                <Download className="w-3 h-3" />
                                <span className="max-w-[100px] truncate">{getAttachmentFileName(path)}</span>
                              </a>
                            ))}
                          </div>
                        )}
                        <p className="text-xs text-muted-foreground mt-1">
                          {format(new Date(c.createdAt), "MMM d, yyyy 'at' h:mm a")}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>

        <div className="border-t p-3 space-y-3">
          <div className="space-y-2">
            {selectedSectionId && (
              <div className="flex items-center justify-between rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5">
                <p className="text-xs text-amber-800" data-testid="text-selected-inline-section">
                  Commenting on section: {selectedSectionId}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setSelectedSectionId(null)}
                  data-testid="button-clear-inline-section"
                >
                  <X className="w-3 h-3" />
                </Button>
              </div>
            )}
            <Textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Describe the change you'd like..."
              className="min-h-[80px] text-sm"
              data-testid="input-review-comment"
            />

            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {attachments.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-1 px-2 py-1 text-xs bg-muted/50 rounded border"
                  >
                    {getFileIcon(file.type)}
                    <span className="max-w-[100px] truncate">{file.name}</span>
                    <button
                      type="button"
                      onClick={() => removeAttachment(index)}
                      className="text-muted-foreground"
                      data-testid={`button-remove-attachment-${index}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between gap-2">
              <div>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,.pdf,.doc,.docx"
                  onChange={handleFileSelect}
                  className="hidden"
                  data-testid="input-file-attachment"
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  data-testid="button-attach-file"
                >
                  {uploading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Paperclip className="w-4 h-4" />
                  )}
                </Button>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => addCommentMutation.mutate()}
                disabled={!comment.trim() || addCommentMutation.isPending || uploading}
                data-testid="button-submit-comment"
              >
                {addCommentMutation.isPending ? (
                  <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                ) : (
                  <Send className="w-3 h-3 mr-1" />
                )}
                Request Changes
              </Button>
            </div>
          </div>

          <Button
            className="w-full"
            onClick={() => approveMutation.mutate()}
            disabled={approveMutation.isPending}
            data-testid="button-approve"
          >
            {approveMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4 mr-2" />
            )}
            Approve Newsletter
          </Button>
        </div>
      </div>
    </div>
  );
}
