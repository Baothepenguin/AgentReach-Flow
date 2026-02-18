import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Send, Clock3, AlertTriangle, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Mode = "schedule" | "send_now";

type SendPreview = {
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

function toLocalDateTimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultScheduledAtValue(expectedSendDate?: string | null): string {
  if (expectedSendDate) {
    // Use local 9:00 AM on the expected send date.
    const date = new Date(`${expectedSendDate}T09:00:00`);
    if (!Number.isNaN(date.getTime())) return toLocalDateTimeValue(date);
  }
  const fallback = new Date();
  fallback.setHours(fallback.getHours() + 2, 0, 0, 0);
  return toLocalDateTimeValue(fallback);
}

export function SendConfirmDialog({
  open,
  mode,
  newsletterId,
  expectedSendDate,
  onClose,
}: {
  open: boolean;
  mode: Mode;
  newsletterId: string;
  expectedSendDate?: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const didInitRef = useRef(false);
  const [subject, setSubject] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [audienceTag, setAudienceTag] = useState("all");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [scheduledAtLocal, setScheduledAtLocal] = useState(() => defaultScheduledAtValue(expectedSendDate));
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      didInitRef.current = false;
      setSubmitError(null);
      setSubmitting(false);
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      setScheduledAtLocal(defaultScheduledAtValue(expectedSendDate));
    }
  }, [open, expectedSendDate]);

  const previewQuery = useQuery<SendPreview>({
    queryKey: ["/api/newsletters", newsletterId, "send-preview", audienceTag],
    enabled: open && !!newsletterId,
    queryFn: async () => {
      const res = await apiRequest("POST", `/api/newsletters/${newsletterId}/send-preview`, {
        audienceTag,
      });
      return res.json();
    },
  });

  useEffect(() => {
    if (!open) return;
    if (!previewQuery.data) return;
    if (didInitRef.current) return;

    didInitRef.current = true;
    setSubject(previewQuery.data.subject || "");
    setPreviewText(previewQuery.data.previewText || "");
    setFromEmail(previewQuery.data.fromEmail || "");
    setAudienceTag(previewQuery.data.audienceTag || "all");
  }, [open, previewQuery.data]);

  const localBlockers = useMemo(() => {
    const items: Array<{ code: string; message: string }> = [];
    if (!subject.trim()) items.push({ code: "missing_subject", message: "Subject line is required." });
    if (!fromEmail.trim()) items.push({ code: "missing_from_email", message: "From email is required." });
    return items;
  }, [subject, fromEmail]);

  const blockers = useMemo(() => {
    const serverBlockers = previewQuery.data?.blockers || [];
    const recipientsCount = previewQuery.data?.recipientsCount;
    const recipientBlocker =
      typeof recipientsCount === "number" && recipientsCount === 0
        ? [{ code: "no_recipients", message: "No active recipients found for this audience tag." }]
        : [];
    return [...serverBlockers, ...recipientBlocker, ...localBlockers];
  }, [previewQuery.data, localBlockers]);

  const warnings = previewQuery.data?.warnings || [];
  const status = previewQuery.data?.status;
  const recipientsCount = previewQuery.data?.recipientsCount;

  const canProceed = blockers.length === 0 && (status === "approved" || status === "scheduled");

  const handleConfirm = async () => {
    if (!newsletterId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const normalizedAudienceTag = audienceTag.trim() || "all";
      const normalizedTimezone = timezone.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
      const normalizedSubject = subject.trim();
      const normalizedPreviewText = previewText.trim();
      const normalizedFromEmail = fromEmail.trim();

      // Persist send settings first so server-side QA uses the same values.
      await apiRequest("PATCH", `/api/newsletters/${newsletterId}`, {
        subject: normalizedSubject,
        previewText: normalizedPreviewText || null,
        fromEmail: normalizedFromEmail,
        timezone: normalizedTimezone,
        documentJson: {
          meta: {
            subject: normalizedSubject,
            previewText: normalizedPreviewText || undefined,
            fromEmail: normalizedFromEmail,
            timezone: normalizedTimezone,
            audienceTag: normalizedAudienceTag,
          },
        },
      });

      if (mode === "schedule") {
        const dt = new Date(scheduledAtLocal);
        const scheduledAt = !Number.isNaN(dt.getTime()) ? dt.toISOString() : undefined;

        const scheduleRes = await apiRequest("POST", `/api/newsletters/${newsletterId}/schedule`, {
          timezone: normalizedTimezone,
          scheduledAt,
          audienceTag: normalizedAudienceTag,
        });
        const scheduleData = await scheduleRes.json().catch(() => null);
        toast({
          title: "Newsletter scheduled",
          description: scheduleData?.warnings?.length
            ? `${scheduleData.warnings.length} warning(s) noted`
            : "Ready for delivery",
        });
      } else {
        const sendRes = await apiRequest("POST", `/api/newsletters/${newsletterId}/send-now`, {
          audienceTag: normalizedAudienceTag,
        });
        const sendData = await sendRes.json().catch(() => null);
        const sentCount = sendData?.send?.sentCount;
        const recipientsCount = sendData?.send?.recipientsCount;
        toast({
          title: "Newsletter sent",
          description:
            typeof sentCount === "number" && typeof recipientsCount === "number"
              ? `Sent ${sentCount}/${recipientsCount}`
              : "Send workflow completed",
        });
      }

      // Refresh newsletter detail and board views.
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", newsletterId] });
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", newsletterId, "review-comments"] });

      onClose();
    } catch (error: any) {
      setSubmitError(error?.message || "Failed to send/schedule");
    } finally {
      setSubmitting(false);
    }
  };

  const title = mode === "schedule" ? "Schedule Delivery" : "Send Newsletter";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {mode === "schedule" ? <Clock3 className="w-5 h-5" /> : <Send className="w-5 h-5" />}
            {title}
          </DialogTitle>
          <DialogDescription>
            Confirm subject, preview text, audience, and run QA before delivery.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Audience Tag</div>
              <Input
                value={audienceTag}
                onChange={(e) => setAudienceTag(e.target.value)}
                placeholder='all'
                data-testid="input-send-audience-tag"
              />
              <div className="text-xs text-muted-foreground">
                Recipients:{" "}
                {previewQuery.isLoading ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" /> Loading...
                  </span>
                ) : typeof recipientsCount === "number" ? (
                  <span className="font-medium">{recipientsCount}</span>
                ) : (
                  "—"
                )}
              </div>
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Timezone</div>
              <Input
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="America/New_York"
                data-testid="input-send-timezone"
              />
              <div className="text-xs text-muted-foreground">Used for scheduling metadata.</div>
            </div>
          </div>

          {mode === "schedule" && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Schedule Time</div>
              <Input
                type="datetime-local"
                value={scheduledAtLocal}
                onChange={(e) => setScheduledAtLocal(e.target.value)}
                data-testid="input-send-scheduled-at"
              />
              <div className="text-xs text-muted-foreground">This is your local time.</div>
            </div>
          )}

          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Subject</div>
            <Input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Subject line"
              data-testid="input-send-subject"
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Preview Text</div>
            <Textarea
              value={previewText}
              onChange={(e) => setPreviewText(e.target.value)}
              placeholder="Short preview text (optional)"
              className="min-h-[72px]"
              data-testid="textarea-send-preview-text"
            />
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">From Email</div>
            <Input
              value={fromEmail}
              onChange={(e) => setFromEmail(e.target.value)}
              placeholder="from@example.com"
              data-testid="input-send-from-email"
            />
          </div>

          {status && status !== "approved" && status !== "scheduled" && (
            <div className="rounded-md border p-3 text-sm">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                Newsletter is not approved
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                Current status: <Badge variant="outline">{status}</Badge>. Set status to <Badge variant="outline">approved</Badge> before scheduling/sending.
              </div>
            </div>
          )}

          {(blockers.length > 0 || warnings.length > 0) && (
            <div className="rounded-md border p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-medium">
                <ShieldCheck className="w-4 h-4" />
                QA Report
              </div>
              {blockers.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-destructive">Blockers ({blockers.length})</div>
                  <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
                    {blockers.slice(0, 8).map((b) => (
                      <li key={`${b.code}-${b.message}`}>{b.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              {warnings.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-amber-700 dark:text-amber-400">Warnings ({warnings.length})</div>
                  <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
                    {warnings.slice(0, 8).map((w) => (
                      <li key={`${w.code}-${w.message}`}>{w.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {submitError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-xs text-destructive">
              {submitError}
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting} data-testid="button-send-cancel">
            Cancel
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={!canProceed || submitting || previewQuery.isLoading}
            data-testid="button-send-confirm"
          >
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
            {mode === "schedule" ? "Schedule" : "Send Now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
