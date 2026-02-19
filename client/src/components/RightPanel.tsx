import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Download, Paperclip, Plus, Trash2 } from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { ReviewComment } from "@shared/schema";
import { format } from "date-fns";

const NEWSLETTER_STATUSES = [
  { value: "draft", label: "Draft" },
  { value: "in_review", label: "In Review" },
  { value: "changes_requested", label: "Changes Requested" },
  { value: "approved", label: "Approved" },
  { value: "scheduled", label: "Scheduled" },
  { value: "sent", label: "Sent" },
];
const EDITABLE_NEWSLETTER_STATUSES = NEWSLETTER_STATUSES.filter(
  (status) => status.value !== "scheduled" && status.value !== "sent"
);

interface RightPanelProps {
  newsletterId: string;
  status: string;
  onStatusChange?: (status: string) => void;
  assignedToId?: string | null;
  onAssignedToChange?: (userId: string | null) => void;
}

export function RightPanel({
  newsletterId,
  status,
  onStatusChange,
  assignedToId,
  onAssignedToChange,
}: RightPanelProps) {
  const [newNoteContent, setNewNoteContent] = useState("");
  const canEditStatus = !!onStatusChange && status !== "scheduled" && status !== "sent";
  const currentStatus = NEWSLETTER_STATUSES.find(s => s.value === status) || NEWSLETTER_STATUSES[0];

  const { data: users = [] } = useQuery<any[]>({
    queryKey: ["/api/users"],
    enabled: true,
  });

  const { data: reviewComments = [] } = useQuery<ReviewComment[]>({
    queryKey: ["/api/newsletters", newsletterId, "review-comments"],
    queryFn: async () => {
      const response = await fetch(`/api/newsletters/${newsletterId}/review-comments`);
      if (!response.ok) return [];
      return response.json();
    },
    enabled: !!newsletterId,
  });

  const { data: analytics, isLoading: loadingAnalytics } = useQuery<any>({
    queryKey: ["/api/newsletters", newsletterId, "analytics"],
    queryFn: async () => {
      const response = await fetch(`/api/newsletters/${newsletterId}/analytics`, { credentials: "include" });
      if (!response.ok) return null;
      return response.json();
    },
    enabled: !!newsletterId && status === "sent",
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
  const getCommentAuthor = (comment: ReviewComment) => {
    if (comment.createdById) {
      const user = users.find((u) => u.id === comment.createdById);
      return user?.name || "Team";
    }
    return comment.isInternal ? "Team" : "Client";
  };

  const getAttachmentUrl = (path: string) => {
    if (!path) return "#";
    const withoutQuery = path.split("?")[0] || path;

    // On Vercel, /objects/* is not routed to the serverless function. Use /api/objects/*.
    if (withoutQuery.startsWith("/api/objects/")) return withoutQuery;
    if (withoutQuery.startsWith("/objects/")) {
      return `/api/objects/${withoutQuery.slice("/objects/".length)}`;
    }
    return withoutQuery;
  };

  const getAttachmentFileName = (path: string) => {
    const parts = path.split("/");
    return parts[parts.length - 1] || "Attachment";
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <div className="px-3 pt-2 pb-3">
        <label className="text-xs font-medium text-muted-foreground mb-2 block" data-testid="label-status">
          Status
        </label>
        {canEditStatus ? (
          <Select value={status} onValueChange={onStatusChange}>
            <SelectTrigger className="w-full" data-testid="select-status-trigger">
              <SelectValue placeholder="Select status" data-testid="select-status-value" />
            </SelectTrigger>
            <SelectContent align="start" data-testid="select-status-content">
              {EDITABLE_NEWSLETTER_STATUSES.map((s) => (
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

      <div className="px-3 pb-3">
        <label className="text-xs font-medium text-muted-foreground mb-2 block" data-testid="label-team-member">
          Team Member
        </label>
        {onAssignedToChange ? (
          <Select value={assignedToId || "unassigned"} onValueChange={(value) => onAssignedToChange(value === "unassigned" ? null : value)}>
            <SelectTrigger className="w-full" data-testid="select-team-member-trigger">
              <SelectValue placeholder="Select team member" data-testid="select-team-member-value" />
            </SelectTrigger>
            <SelectContent align="start" data-testid="select-team-member-content">
              <SelectItem value="unassigned" data-testid="team-member-option-unassigned">
                Unassigned
              </SelectItem>
              {users.map((user) => (
                <SelectItem key={user.id} value={user.id} data-testid={`team-member-option-${user.id}`}>
                  {user.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="px-3 py-2 rounded-md text-sm font-medium bg-muted" data-testid="text-team-member-readonly">
            {assignedToId && users.find(u => u.id === assignedToId)?.name ? users.find(u => u.id === assignedToId)?.name : "Unassigned"}
          </div>
        )}
      </div>

      {status === "sent" && (
        <div className="px-3 pb-3">
          <div className="text-xs font-medium text-muted-foreground mb-2" data-testid="label-analytics">
            Analytics
          </div>
          {loadingAnalytics ? (
            <div className="text-xs text-muted-foreground">Loading...</div>
          ) : !analytics ? (
            <div className="text-xs text-muted-foreground">No analytics yet</div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded border p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Sent</div>
                <div className="text-sm font-semibold">{analytics.sentCount ?? 0}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Failed</div>
                <div className="text-sm font-semibold">{analytics.failedCount ?? 0}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Bounced</div>
                <div className="text-sm font-semibold">{analytics.bouncedCount ?? 0}</div>
              </div>
              <div className="rounded border p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Unsub</div>
                <div className="text-sm font-semibold">{analytics.unsubscribedCount ?? 0}</div>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="px-3 py-2 space-y-2">
        <div className="flex items-center gap-2">
          <div className="text-xs font-medium text-muted-foreground" data-testid="label-internal-notes">
            Internal Notes
            {pendingInternalNotes.length > 0 && (
              <span className="text-xs text-muted-foreground normal-case tracking-normal ml-1">({pendingInternalNotes.length})</span>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          <Input
            placeholder="Add..."
            value={newNoteContent}
            onChange={(e) => setNewNoteContent(e.target.value)}
            className="h-7 text-xs"
            onKeyDown={(e) => e.key === "Enter" && handleAddNote()}
            data-testid="input-add-note"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 flex-shrink-0"
            onClick={handleAddNote}
            disabled={!newNoteContent.trim() || createNoteMutation.isPending}
            data-testid="button-add-note"
          >
            <Plus className="w-3 h-3" />
          </Button>
        </div>
        <div className="space-y-0.5 max-h-48 overflow-y-auto">
          {pendingInternalNotes.map((note) => (
            <div
              key={note.id}
              className="flex items-start gap-1.5 p-1 rounded bg-background group"
              data-testid={`internal-note-${note.id}`}
            >
              <Checkbox
                checked={false}
                onCheckedChange={() => toggleCompleteMutation.mutate(note.id)}
                className="mt-0.5 h-3 w-3"
                data-testid={`checkbox-note-${note.id}`}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs">{note.content}</p>
                <span className="text-xs text-muted-foreground">
                  {format(new Date(note.createdAt), "MMM d")} · {getCommentAuthor(note)}
                </span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                onClick={() => deleteNoteMutation.mutate(note.id)}
                data-testid={`button-delete-note-${note.id}`}
              >
                <Trash2 className="w-2.5 h-2.5 text-muted-foreground" />
              </Button>
            </div>
          ))}
          {completedInternalNotes.length > 0 && (
            <div className="pt-1">
              <div className="text-xs text-muted-foreground mb-0.5">Completed</div>
              {completedInternalNotes.map((note) => (
                <div
                  key={note.id}
                  className="flex items-start gap-1.5 p-1 rounded group"
                  data-testid={`internal-note-${note.id}`}
                >
                  <Checkbox
                    checked={true}
                    onCheckedChange={() => toggleCompleteMutation.mutate(note.id)}
                    className="mt-0.5 h-3 w-3"
                    data-testid={`checkbox-note-${note.id}`}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs line-through text-muted-foreground">{note.content}</p>
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(note.createdAt), "MMM d")} · {getCommentAuthor(note)}
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-4 w-4 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                    onClick={() => deleteNoteMutation.mutate(note.id)}
                    data-testid={`button-delete-note-${note.id}`}
                  >
                    <Trash2 className="w-2.5 h-2.5 text-muted-foreground" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="px-3 pt-1 pb-2">
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground" data-testid="label-client-feedback">
          Client Feedback
          {pendingFeedback.length > 0 && (
            <span className="text-xs text-muted-foreground normal-case tracking-normal">({pendingFeedback.length})</span>
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
                      className="p-2 rounded-md bg-amber-500/5"
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
                          {comment.attachments && comment.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {comment.attachments.map((path, idx) => (
                                <a
                                  key={idx}
                                  href={getAttachmentUrl(path)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  download
                                  className="flex items-center gap-1 px-2 py-0.5 text-xs bg-background rounded"
                                  data-testid={`review-comment-attachment-${comment.id}-${idx}`}
                                >
                                  <Download className="w-3 h-3" />
                                  <span className="max-w-[140px] truncate">{getAttachmentFileName(path)}</span>
                                </a>
                              ))}
                            </div>
                          )}
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
                      className="p-2 rounded-md"
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
                          {comment.attachments && comment.attachments.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2">
                              {comment.attachments.map((path, idx) => (
                                <a
                                  key={idx}
                                  href={getAttachmentUrl(path)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  download
                                  className="flex items-center gap-1 px-2 py-0.5 text-xs bg-background rounded"
                                  data-testid={`review-comment-attachment-${comment.id}-${idx}`}
                                >
                                  <Download className="w-3 h-3" />
                                  <span className="max-w-[140px] truncate">{getAttachmentFileName(path)}</span>
                                </a>
                              ))}
                            </div>
                          )}
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
