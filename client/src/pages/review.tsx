import { useRef, useState } from "react";
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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

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
      const normalizedContent = comment.trim() || "Requested changes";
      const res = await fetch(`/api/review/${token}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          content: normalizedContent,
          sectionId: null,
          commentType: "general",
          attachments: attachments.map(a => a.objectPath),
        }),
      });
      if (!res.ok) throw new Error("Failed to submit");
      return res.json();
    },
    onSuccess: () => {
      setComment("");
      setAttachments([]);
      refetchComments();
      toast({ title: "Feedback submitted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to submit feedback", description: error.message, variant: "destructive" });
    },
  });

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
          <CheckCircle2 className="w-12 h-12 mx-auto text-blue-500 mb-4" />
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
                disabled={(!comment.trim() && attachments.length === 0) || addCommentMutation.isPending || uploading}
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
            onClick={() => {
              const confirmed = window.confirm("Are you sure you want to approve this newsletter? This will mark it ready for delivery.");
              if (!confirmed) return;
              approveMutation.mutate();
            }}
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
