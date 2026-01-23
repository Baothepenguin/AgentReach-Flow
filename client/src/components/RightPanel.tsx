import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { StickyNote, CheckSquare, Paperclip, Link2, ExternalLink, Plus, Trash2 } from "lucide-react";
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
  editorFileUrl?: string | null;
  contentChatUrl?: string | null;
  onStatusChange?: (status: string) => void;
  onEditorFileUrlChange?: (url: string) => void;
  onContentChatUrlChange?: (url: string) => void;
}

export function RightPanel({
  newsletterId,
  status,
  editorFileUrl,
  contentChatUrl,
  onStatusChange,
  onEditorFileUrlChange,
  onContentChatUrlChange,
}: RightPanelProps) {
  const [localEditorUrl, setLocalEditorUrl] = useState(editorFileUrl || "");
  const [localChatUrl, setLocalChatUrl] = useState(contentChatUrl || "");
  const [editorUrlDirty, setEditorUrlDirty] = useState(false);
  const [chatUrlDirty, setChatUrlDirty] = useState(false);
  const [newNoteContent, setNewNoteContent] = useState("");
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

  const createNoteMutation = useMutation({
    mutationFn: (content: string) =>
      apiRequest("POST", `/api/newsletters/${newsletterId}/internal-notes`, { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", newsletterId, "review-comments"] });
      setNewNoteContent("");
    },
  });

  const deleteNoteMutation = useMutation({
    mutationFn: (commentId: string) =>
      apiRequest("DELETE", `/api/review-comments/${commentId}`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", newsletterId, "review-comments"] });
    },
  });

  const handleAddNote = () => {
    if (newNoteContent.trim()) {
      createNoteMutation.mutate(newNoteContent.trim());
    }
  };

  const internalNotes = reviewComments.filter(c => c.isInternal);
  const clientFeedback = reviewComments.filter(c => !c.isInternal);
  const pendingInternalNotes = internalNotes.filter(c => !c.isCompleted);
  const completedInternalNotes = internalNotes.filter(c => c.isCompleted);
  const pendingFeedback = clientFeedback.filter(c => !c.isCompleted);
  const completedFeedback = clientFeedback.filter(c => c.isCompleted);

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

      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2 text-sm font-medium" data-testid="label-internal-notes">
            <StickyNote className="w-4 h-4" />
            Internal Notes
            {pendingInternalNotes.length > 0 && (
              <span className="text-xs text-muted-foreground">({pendingInternalNotes.length})</span>
            )}
          </div>
        </div>
        <div className="flex gap-1 mb-2">
          <Input
            placeholder="Add a note..."
            value={newNoteContent}
            onChange={(e) => setNewNoteContent(e.target.value)}
            className="h-8 text-sm"
            onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
            data-testid="input-add-note"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 flex-shrink-0"
            onClick={handleAddNote}
            disabled={!newNoteContent.trim() || createNoteMutation.isPending}
            data-testid="button-add-note"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
        <div className="space-y-1">
          {pendingInternalNotes.map((note) => (
            <div
              key={note.id}
              className="flex items-start gap-2 p-1.5 rounded bg-background group"
              data-testid={`internal-note-${note.id}`}
            >
              <Checkbox
                checked={false}
                onCheckedChange={() => toggleCompleteMutation.mutate(note.id)}
                className="mt-0.5"
                data-testid={`checkbox-note-${note.id}`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm">{note.content}</p>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(note.createdAt), "MMM d, h:mm a")}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => deleteNoteMutation.mutate(note.id)}
                data-testid={`button-delete-note-${note.id}`}
              >
                <Trash2 className="w-3 h-3 text-muted-foreground" />
              </Button>
            </div>
          ))}
          {completedInternalNotes.length > 0 && (
            <div className="pt-1">
              <div className="text-xs text-muted-foreground mb-1">Completed</div>
              {completedInternalNotes.map((note) => (
                <div
                  key={note.id}
                  className="flex items-start gap-2 p-1.5 rounded group"
                  data-testid={`internal-note-${note.id}`}
                >
                  <Checkbox
                    checked={true}
                    onCheckedChange={() => toggleCompleteMutation.mutate(note.id)}
                    className="mt-0.5"
                    data-testid={`checkbox-note-${note.id}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm line-through text-muted-foreground">{note.content}</p>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(note.createdAt), "MMM d, h:mm a")}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={() => deleteNoteMutation.mutate(note.id)}
                    data-testid={`button-delete-note-${note.id}`}
                  >
                    <Trash2 className="w-3 h-3 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Only visible to team members
        </p>
      </div>

      <div className="p-3 border-b">
        <div className="flex items-center gap-2 text-sm font-medium" data-testid="label-client-feedback">
          <CheckSquare className="w-4 h-4" />
          Client Feedback
          {pendingFeedback.length > 0 && (
            <span className="text-xs text-muted-foreground">({pendingFeedback.length} pending)</span>
          )}
        </div>
      </div>
      
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-1">
          {clientFeedback.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground" data-testid="text-no-feedback">
              No client feedback yet
            </div>
          ) : (
            <>
              {pendingFeedback.length > 0 && (
                <div className="space-y-1 mb-3">
                  {pendingFeedback.map((comment) => (
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

              {completedFeedback.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-muted-foreground px-2 py-1">
                    Completed ({completedFeedback.length})
                  </div>
                  {completedFeedback.map((comment) => (
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
