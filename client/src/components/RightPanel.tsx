import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { StickyNote, Save, CheckSquare, Paperclip, Link2, ExternalLink } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { ReviewComment } from "@shared/schema";
import { format } from "date-fns";

const NEWSLETTER_STATUSES = [
  { value: "not_started", label: "Not Started" },
  { value: "in_progress", label: "In Progress" },
  { value: "internal_review", label: "Internal Review" },
  { value: "client_review", label: "Client Review" },
  { value: "revisions", label: "Revisions" },
  { value: "approved", label: "Approved" },
  { value: "sent", label: "Sent" },
];

interface RightPanelProps {
  newsletterId: string;
  status: string;
  internalNotes?: string | null;
  editorFileUrl?: string | null;
  contentChatUrl?: string | null;
  onStatusChange?: (status: string) => void;
  onInternalNotesChange?: (notes: string) => void;
  onEditorFileUrlChange?: (url: string) => void;
  onContentChatUrlChange?: (url: string) => void;
}

export function RightPanel({
  newsletterId,
  status,
  internalNotes,
  editorFileUrl,
  contentChatUrl,
  onStatusChange,
  onInternalNotesChange,
  onEditorFileUrlChange,
  onContentChatUrlChange,
}: RightPanelProps) {
  const [localNotes, setLocalNotes] = useState(internalNotes || "");
  const [notesDirty, setNotesDirty] = useState(false);
  const [localEditorUrl, setLocalEditorUrl] = useState(editorFileUrl || "");
  const [localChatUrl, setLocalChatUrl] = useState(contentChatUrl || "");
  const [editorUrlDirty, setEditorUrlDirty] = useState(false);
  const [chatUrlDirty, setChatUrlDirty] = useState(false);
  const currentStatus = NEWSLETTER_STATUSES.find(s => s.value === status) || NEWSLETTER_STATUSES[0];

  const { data: reviewComments = [] } = useQuery<ReviewComment[]>({
    queryKey: ["/api/newsletters", newsletterId, "review-comments"],
    queryFn: async () => {
      const response = await fetch(`/api/newsletters/${newsletterId}/review-comments`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!newsletterId,
  });

  const toggleCompleteMutation = useMutation({
    mutationFn: (commentId: string) => 
      apiRequest("POST", `/api/review-comments/${commentId}/toggle-complete`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", newsletterId, "review-comments"] });
    },
  });

  const handleNotesChange = (value: string) => {
    setLocalNotes(value);
    setNotesDirty(value !== (internalNotes || ""));
  };

  const handleSaveNotes = () => {
    if (onInternalNotesChange) {
      onInternalNotesChange(localNotes);
      setNotesDirty(false);
    }
  };

  const pendingComments = reviewComments.filter(c => !c.isCompleted);
  const completedComments = reviewComments.filter(c => c.isCompleted);

  const getCommentTypeLabel = (type: string) => {
    switch (type) {
      case "general": return "General";
      case "content": return "Content";
      case "design": return "Design";
      case "links": return "Links";
      default: return type;
    }
  };

  return (
    <div className="flex flex-col h-full bg-muted/30">
      <div className="p-4 border-b">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block" data-testid="label-status">
          Status
        </label>
        {onStatusChange ? (
          <Select value={status} onValueChange={onStatusChange}>
            <SelectTrigger className="w-full" data-testid="select-status-trigger">
              <SelectValue placeholder="Select status" data-testid="select-status-value" />
            </SelectTrigger>
            <SelectContent align="start" data-testid="select-status-content">
              {NEWSLETTER_STATUSES.map((s) => (
                <SelectItem key={s.value} value={s.value} data-testid={`status-option-${s.value}`}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="px-3 py-2 rounded-md text-sm font-medium bg-muted" data-testid="text-status-readonly">
            {currentStatus.label}
          </div>
        )}
      </div>

      {onEditorFileUrlChange && (
        <div className="p-3 border-b space-y-3">
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Link2 className="w-3 h-3" />
                Editor File
              </div>
              {localEditorUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-xs"
                  onClick={() => window.open(localEditorUrl, "_blank")}
                  data-testid="button-open-editor-file"
                >
                  <ExternalLink className="w-3 h-3" />
                </Button>
              )}
            </div>
            <Input
              placeholder="Paste URL..."
              value={localEditorUrl}
              onChange={(e) => {
                setLocalEditorUrl(e.target.value);
                setEditorUrlDirty(e.target.value !== (editorFileUrl || ""));
              }}
              onBlur={() => {
                if (editorUrlDirty && onEditorFileUrlChange) {
                  onEditorFileUrlChange(localEditorUrl);
                  setEditorUrlDirty(false);
                }
              }}
              className="h-8 text-xs"
              data-testid="input-editor-file-url"
            />
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Link2 className="w-3 h-3" />
                Content Chat
              </div>
              {localChatUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1.5 text-xs"
                  onClick={() => window.open(localChatUrl, "_blank")}
                  data-testid="button-open-content-chat"
                >
                  <ExternalLink className="w-3 h-3" />
                </Button>
              )}
            </div>
            <Input
              placeholder="Paste URL..."
              value={localChatUrl}
              onChange={(e) => {
                setLocalChatUrl(e.target.value);
                setChatUrlDirty(e.target.value !== (contentChatUrl || ""));
              }}
              onBlur={() => {
                if (chatUrlDirty && onContentChatUrlChange) {
                  onContentChatUrlChange(localChatUrl);
                  setChatUrlDirty(false);
                }
              }}
              className="h-8 text-xs"
              data-testid="input-content-chat-url"
            />
          </div>
        </div>
      )}

      {onInternalNotesChange && (
        <div className="p-3 border-b">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-medium" data-testid="label-internal-notes">
              <StickyNote className="w-4 h-4" />
              Internal Notes
            </div>
            {notesDirty && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={handleSaveNotes}
                data-testid="button-save-notes"
              >
                <Save className="w-3 h-3 mr-1" />
                Save
              </Button>
            )}
          </div>
          <Textarea
            placeholder="Add private notes for the team..."
            value={localNotes}
            onChange={(e) => handleNotesChange(e.target.value)}
            className="min-h-[80px] text-sm resize-none"
            data-testid="textarea-internal-notes"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Only visible to team members
          </p>
        </div>
      )}

      <div className="p-3 border-b">
        <div className="flex items-center gap-2 text-sm font-medium" data-testid="label-client-feedback">
          <CheckSquare className="w-4 h-4" />
          Client Feedback
          {pendingComments.length > 0 && (
            <span className="text-xs text-muted-foreground">({pendingComments.length} pending)</span>
          )}
        </div>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {reviewComments.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground" data-testid="text-no-feedback">
              No client feedback yet
            </div>
          ) : (
            <>
              {pendingComments.length > 0 && (
                <div className="space-y-1 mb-3">
                  {pendingComments.map((comment) => (
                    <div
                      key={comment.id}
                      className="p-2 rounded-md bg-background border border-amber-500/30"
                      data-testid={`review-comment-${comment.id}`}
                    >
                      <div className="flex items-start gap-2">
                        <Checkbox
                          checked={false}
                          onCheckedChange={() => toggleCompleteMutation.mutate(comment.id)}
                          className="mt-0.5"
                          data-testid={`checkbox-comment-${comment.id}`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{comment.content}</p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <span>{getCommentTypeLabel(comment.commentType)}</span>
                            <span>·</span>
                            <span>{format(new Date(comment.createdAt), "MMM d, h:mm a")}</span>
                            {comment.attachments && comment.attachments.length > 0 && (
                              <>
                                <span>·</span>
                                <span className="flex items-center gap-0.5">
                                  <Paperclip className="w-3 h-3" />
                                  {comment.attachments.length}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {completedComments.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground px-2 py-1">
                    Completed ({completedComments.length})
                  </div>
                  {completedComments.map((comment) => (
                    <div
                      key={comment.id}
                      className="p-2 rounded-md bg-muted/30"
                      data-testid={`review-comment-${comment.id}`}
                    >
                      <div className="flex items-start gap-2">
                        <Checkbox
                          checked={true}
                          onCheckedChange={() => toggleCompleteMutation.mutate(comment.id)}
                          className="mt-0.5"
                          data-testid={`checkbox-comment-${comment.id}`}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm line-through text-muted-foreground">{comment.content}</p>
                          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                            <span>{getCommentTypeLabel(comment.commentType)}</span>
                            <span>·</span>
                            <span>Completed {comment.completedAt && format(new Date(comment.completedAt), "MMM d")}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
