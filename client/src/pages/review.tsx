import { useState, useRef } from "react";
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
  Plus,
  CheckSquare,
  Paperclip,
  X,
  Image as ImageIcon,
  FileText,
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
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [comment, setComment] = useState("");
  const [approved, setApproved] = useState(false);
  const [deviceMode, setDeviceMode] = useState<"desktop" | "mobile">("desktop");
  const [attachments, setAttachments] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      setShowCommentBox(false);
      refetchComments();
      toast({ title: "Comment added" });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const urlRes = await fetch("/api/uploads/request-url", {
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
          <h1 className="font-semibold">{data?.newsletter.title}</h1>
          <p className="text-sm text-muted-foreground">{data?.newsletter.clientName}</p>
        </div>

        <div className="flex-1 flex flex-col min-h-0">
          <div className="p-3 border-b">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <MessageSquare className="w-4 h-4" />
                Feedback
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowCommentBox(true)}
                className="h-7 text-xs"
                data-testid="button-add-comment"
              >
                <Plus className="w-3 h-3 mr-1" />
                Add
              </Button>
            </div>
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">
              {showCommentBox && (
                <div className="p-3 rounded-md bg-muted/50 border space-y-2">
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
                          className="flex items-center gap-1 px-2 py-1 text-xs bg-background rounded border"
                        >
                          {getFileIcon(file.type)}
                          <span className="max-w-[100px] truncate">{file.name}</span>
                          <button
                            type="button"
                            onClick={() => removeAttachment(index)}
                            className="text-muted-foreground hover:text-foreground"
                          >
                            <X className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1">
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
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={uploading}
                        data-testid="button-attach-file"
                      >
                        {uploading ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Paperclip className="w-3 h-3" />
                        )}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setShowCommentBox(false);
                          setComment("");
                          setAttachments([]);
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => addCommentMutation.mutate()}
                        disabled={!comment.trim() || addCommentMutation.isPending || uploading}
                        data-testid="button-submit-comment"
                      >
                        {addCommentMutation.isPending && (
                          <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                        )}
                        Add Comment
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {existingComments.length === 0 && !showCommentBox ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No feedback yet. Click "Add" to leave a comment.
                </div>
              ) : (
                <>
                  {pendingComments.map((c) => (
                    <div
                      key={c.id}
                      className="p-2 rounded-md bg-muted/30 border-l-2 border-amber-500"
                      data-testid={`comment-${c.id}`}
                    >
                      <p className="text-sm">{c.content}</p>
                      {c.attachments && c.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {c.attachments.map((path, i) => (
                            <a
                              key={i}
                              href={path}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1 px-2 py-0.5 text-xs bg-background rounded border hover:bg-muted"
                            >
                              <Paperclip className="w-3 h-3" />
                              Attachment {i + 1}
                            </a>
                          ))}
                        </div>
                      )}
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(new Date(c.createdAt), "MMM d, h:mm a")}
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
                          className="p-2 rounded-md bg-muted/20"
                          data-testid={`comment-${c.id}`}
                        >
                          <p className="text-sm line-through text-muted-foreground">{c.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          </ScrollArea>
        </div>

        <div className="p-4 border-t space-y-3">
          {pendingComments.length > 0 && (
            <div className="text-xs text-muted-foreground text-center">
              {pendingComments.length} pending change{pendingComments.length !== 1 ? "s" : ""} requested
            </div>
          )}
          <Button
            size="lg"
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
