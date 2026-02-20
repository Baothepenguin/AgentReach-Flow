import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Loader2, Send, Clock3, ShieldCheck, Mail, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Mode = "schedule" | "send_now";
type DeliveryProvider = "postmark" | "mailchimp" | "html_export";

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
  replyTo: string;
  deliveryProvider: DeliveryProvider;
  availableProviders: DeliveryProvider[];
  senderProfile?: {
    senderVerified: boolean;
    fromDomainMatchesClient: boolean;
  };
};

type TimelineSummary = {
  queued: number;
  sent: number;
  failed: number;
  bounced: number;
  unsubscribed: number;
};

type TimelineResponse = {
  newsletterId: string;
  summary: TimelineSummary;
  campaignEvents: Array<{
    id: string;
    eventType: string;
    occurredAt: string | null;
    payload: Record<string, unknown>;
  }>;
  contacts: Array<{
    email: string;
    status: string | null;
  }>;
};

const TEST_RECIPIENTS_STORAGE_KEY = "flow:test-recipient-history:v1";

function toLocalDateTimeValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function defaultScheduledAtValue(expectedSendDate?: string | null): string {
  if (expectedSendDate) {
    const date = new Date(`${expectedSendDate}T09:00:00`);
    if (!Number.isNaN(date.getTime())) return toLocalDateTimeValue(date);
  }
  const fallback = new Date();
  fallback.setHours(fallback.getHours() + 2, 0, 0, 0);
  return toLocalDateTimeValue(fallback);
}

function readSavedTestRecipients(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(TEST_RECIPIENTS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
      .filter((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value));
  } catch {
    return [];
  }
}

function saveTestRecipient(email: string): string[] {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    return readSavedTestRecipients();
  }
  const merged = [normalized, ...readSavedTestRecipients().filter((item) => item !== normalized)].slice(0, 8);
  if (typeof window !== "undefined") {
    window.localStorage.setItem(TEST_RECIPIENTS_STORAGE_KEY, JSON.stringify(merged));
  }
  return merged;
}

function downloadHtml(filename: string, html: string): void {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatEventType(eventType: string): string {
  return eventType
    .split("_")
    .map((part) => (part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : ""))
    .join(" ");
}

export function SendConfirmDialog({
  open,
  mode,
  newsletterId,
  expectedSendDate,
  onClose,
}: {
  open: boolean;
  mode?: Mode;
  newsletterId: string;
  expectedSendDate?: string | null;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const didInitRef = useRef(false);

  const initialMode: Mode = mode || "send_now";
  const [actionMode, setActionMode] = useState<Mode>(initialMode);
  const [subject, setSubject] = useState("");
  const [previewText, setPreviewText] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [audienceTag, setAudienceTag] = useState("all");
  const [provider, setProvider] = useState<DeliveryProvider>("postmark");
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [scheduledAtLocal, setScheduledAtLocal] = useState(() => defaultScheduledAtValue(expectedSendDate));
  const [testEmail, setTestEmail] = useState("");
  const [savedTestRecipients, setSavedTestRecipients] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [testSending, setTestSending] = useState(false);
  const [retryingFailed, setRetryingFailed] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      didInitRef.current = false;
      setSubmitError(null);
      setSubmitting(false);
      setTestSending(false);
      setRetryingFailed(false);
      setActionMode(initialMode);
      setTimezone(Intl.DateTimeFormat().resolvedOptions().timeZone);
      setScheduledAtLocal(defaultScheduledAtValue(expectedSendDate));
      return;
    }

    setActionMode(initialMode);
    const saved = readSavedTestRecipients();
    setSavedTestRecipients(saved);
    if (saved.length > 0) {
      setTestEmail(saved[0]);
    }
  }, [open, expectedSendDate, initialMode]);

  const previewQuery = useQuery<SendPreview>({
    queryKey: ["/api/newsletters", newsletterId, "send-preview", audienceTag, provider],
    enabled: open && !!newsletterId,
    queryFn: async () => {
      const res = await apiRequest("POST", `/api/newsletters/${newsletterId}/send-preview`, {
        audienceTag,
        provider,
      });
      return res.json();
    },
  });

  const timelineQuery = useQuery<TimelineResponse>({
    queryKey: ["/api/newsletters", newsletterId, "timeline"],
    enabled: open && !!newsletterId,
    queryFn: async () => {
      const res = await fetch(`/api/newsletters/${newsletterId}/timeline`, { credentials: "include" });
      if (!res.ok) {
        throw new Error(`${res.status}: Failed to load timeline`);
      }
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
    setReplyTo(previewQuery.data.replyTo || "");
    setAudienceTag(previewQuery.data.audienceTag || "all");
    setProvider(previewQuery.data.deliveryProvider || "postmark");
  }, [open, previewQuery.data]);

  const localBlockers = useMemo(() => {
    const items: Array<{ code: string; message: string }> = [];
    if (!subject.trim()) items.push({ code: "missing_subject", message: "Subject line is required." });
    if (!fromEmail.trim()) items.push({ code: "missing_from_email", message: "From email is required." });
    if (!replyTo.trim()) items.push({ code: "missing_reply_to", message: "Reply-to email is required." });
    return items;
  }, [subject, fromEmail, replyTo]);

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
  const availableProviders = previewQuery.data?.availableProviders || ["postmark", "html_export"];
  const providerScheduleBlocked = actionMode === "schedule" && provider === "html_export";
  const canProceed =
    blockers.length === 0 &&
    !providerScheduleBlocked &&
    (status === "approved" || status === "scheduled");

  const persistDeliveryDraft = async () => {
    const normalizedAudienceTag = audienceTag.trim() || "all";
    const normalizedProvider = provider;
    const normalizedTimezone = timezone.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
    const normalizedSubject = subject.trim();
    const normalizedPreviewText = previewText.trim();
    const normalizedFromEmail = fromEmail.trim();
    const normalizedReplyTo = replyTo.trim();

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
          replyTo: normalizedReplyTo,
          timezone: normalizedTimezone,
          audienceTag: normalizedAudienceTag,
          deliveryProvider: normalizedProvider,
        },
      },
    });

    return {
      normalizedAudienceTag,
      normalizedProvider,
      normalizedTimezone,
      normalizedSubject,
      normalizedPreviewText,
      normalizedFromEmail,
      normalizedReplyTo,
    };
  };

  const handleSendTest = async (emailOverride?: string) => {
    const targetEmail = (emailOverride || testEmail).trim();
    if (!targetEmail) {
      toast({ title: "Test email required", description: "Enter an email first.", variant: "destructive" });
      return;
    }

    setTestSending(true);
    try {
      await persistDeliveryDraft();
      const res = await apiRequest("POST", `/api/newsletters/${newsletterId}/send-test`, {
        toEmail: targetEmail,
      });
      const data = await res.json().catch(() => ({}));
      const warningsList = Array.isArray(data?.warnings) ? data.warnings : [];
      const warningDescription =
        warningsList.length > 0
          ? `Sent to ${targetEmail}. ${warningsList[0]?.message || "Review QA warnings."}`
          : `Sent to ${targetEmail}`;

      setSavedTestRecipients(saveTestRecipient(targetEmail));
      setTestEmail(targetEmail);
      toast({ title: "Test email sent", description: warningDescription });
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", newsletterId, "timeline"] });
    } catch (error: any) {
      toast({
        title: "Test email failed",
        description: error?.message || "Failed to send test email",
        variant: "destructive",
      });
    } finally {
      setTestSending(false);
    }
  };

  const handleRetryFailed = async () => {
    setRetryingFailed(true);
    try {
      const normalizedAudienceTag = audienceTag.trim() || "all";
      const res = await apiRequest("POST", `/api/newsletters/${newsletterId}/retry-failed`, {
        audienceTag: normalizedAudienceTag,
        provider,
      });
      const data = await res.json().catch(() => ({}));
      toast({
        title: "Retry started",
        description:
          typeof data?.retriedCount === "number"
            ? `${data.retriedCount} failed recipient(s) re-queued`
            : "Failed deliveries were re-queued",
      });
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", newsletterId] });
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", newsletterId, "timeline"] });
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", newsletterId, "send-preview"] });
    } catch (error: any) {
      toast({ title: "Retry failed", description: error?.message || "Unable to retry", variant: "destructive" });
    } finally {
      setRetryingFailed(false);
    }
  };

  const handleConfirm = async () => {
    if (!newsletterId) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const settings = await persistDeliveryDraft();

      if (actionMode === "schedule") {
        const dt = new Date(scheduledAtLocal);
        const scheduledAt = !Number.isNaN(dt.getTime()) ? dt.toISOString() : undefined;

        const scheduleRes = await apiRequest("POST", `/api/newsletters/${newsletterId}/schedule`, {
          timezone: settings.normalizedTimezone,
          scheduledAt,
          audienceTag: settings.normalizedAudienceTag,
          provider: settings.normalizedProvider,
        });
        const scheduleData = await scheduleRes.json().catch(() => null);
        toast({
          title: "Newsletter scheduled",
          description: scheduleData?.warnings?.length
            ? `${scheduleData.warnings.length} warning(s) noted`
            : "Queued for delivery",
        });
      } else {
        const sendRes = await apiRequest("POST", `/api/newsletters/${newsletterId}/send-now`, {
          audienceTag: settings.normalizedAudienceTag,
          provider: settings.normalizedProvider,
        });
        const sendData = await sendRes.json().catch(() => null);

        if (sendData?.send?.exportOnly && typeof sendData?.send?.html === "string") {
          downloadHtml(`${subject.trim() || "newsletter"}.html`, sendData.send.html);
          toast({ title: "HTML export ready", description: "Downloaded HTML file for external send." });
        } else {
          const acceptedCount = sendData?.send?.acceptedCount;
          const queuedCount = sendData?.send?.queuedCount;
          toast({
            title: "Delivery started",
            description:
              typeof acceptedCount === "number"
                ? `Accepted ${acceptedCount}${typeof queuedCount === "number" ? ` (${queuedCount} pending callbacks)` : ""}`
                : "Send pipeline started",
          });
        }
      }

      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", newsletterId] });
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", newsletterId, "review-comments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", newsletterId, "timeline"] });

      onClose();
    } catch (error: any) {
      setSubmitError(error?.message || "Failed to run delivery action");
    } finally {
      setSubmitting(false);
    }
  };

  const timelineSummary = timelineQuery.data?.summary;
  const timelineEvents = timelineQuery.data?.campaignEvents || [];
  const hasFailed = (timelineSummary?.failed || 0) + (timelineSummary?.bounced || 0) > 0;

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Send className="w-5 h-5" />
            Delivery Panel
          </DialogTitle>
          <DialogDescription>
            Test, schedule, and send from one place. Status only flips to sent after provider confirmation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 max-h-[68vh] overflow-y-auto pr-1">
          <div className="inline-flex items-center rounded-md bg-muted/40 p-1">
            <Button
              size="sm"
              variant={actionMode === "send_now" ? "secondary" : "ghost"}
              className="h-8 text-xs"
              onClick={() => setActionMode("send_now")}
            >
              <Send className="w-3.5 h-3.5 mr-1.5" />
              Send Now
            </Button>
            <Button
              size="sm"
              variant={actionMode === "schedule" ? "secondary" : "ghost"}
              className="h-8 text-xs"
              onClick={() => setActionMode("schedule")}
            >
              <Clock3 className="w-3.5 h-3.5 mr-1.5" />
              Schedule
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Audience Tag</div>
              <Input value={audienceTag} onChange={(e) => setAudienceTag(e.target.value)} placeholder="all" data-testid="input-send-audience-tag" />
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
              <div className="text-xs font-medium text-muted-foreground">Delivery Provider</div>
              <select
                value={provider}
                onChange={(e) => setProvider(e.target.value as DeliveryProvider)}
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                data-testid="select-send-provider"
              >
                {availableProviders.map((item) => (
                  <option key={item} value={item}>
                    {item === "postmark" ? "Postmark" : item === "mailchimp" ? "Mailchimp" : "HTML Export"}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">From Email</div>
              <Input value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} placeholder="from@example.com" data-testid="input-send-from-email" />
            </div>
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Reply-To Email</div>
              <Input value={replyTo} onChange={(e) => setReplyTo(e.target.value)} placeholder="reply@example.com" data-testid="input-send-reply-to" />
            </div>
          </div>

          {actionMode === "schedule" && (
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground">Schedule Time</div>
              <Input type="datetime-local" value={scheduledAtLocal} onChange={(e) => setScheduledAtLocal(e.target.value)} data-testid="input-send-scheduled-at" />
              <div className="text-xs text-muted-foreground">Local time.</div>
            </div>
          )}

          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Timezone</div>
            <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} placeholder="America/New_York" data-testid="input-send-timezone" />
          </div>

          <div className="space-y-1">
            <div className="text-xs font-medium text-muted-foreground">Subject</div>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line" data-testid="input-send-subject" />
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

          <div className="rounded-md bg-muted/25 p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Mail className="w-4 h-4" />
              Send Test Email
            </div>
            <div className="flex items-center gap-2">
              <Input
                value={testEmail}
                onChange={(e) => setTestEmail(e.target.value)}
                placeholder="test@domain.com"
                data-testid="input-send-test-email"
              />
              <Button
                size="sm"
                onClick={() => handleSendTest()}
                disabled={testSending}
                data-testid="button-send-test-inline"
              >
                {testSending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Send Test"}
              </Button>
            </div>
            {savedTestRecipients.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                {savedTestRecipients.map((email) => (
                  <button
                    key={email}
                    type="button"
                    className="text-xs rounded-full bg-background px-2.5 py-1 hover:bg-muted"
                    onClick={() => handleSendTest(email)}
                    disabled={testSending}
                    data-testid={`button-test-recipient-${email}`}
                  >
                    {email}
                  </button>
                ))}
              </div>
            )}
          </div>

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
                    {blockers.slice(0, 10).map((item) => (
                      <li key={`${item.code}-${item.message}`}>{item.message}</li>
                    ))}
                  </ul>
                </div>
              )}
              {warnings.length > 0 && (
                <div className="space-y-1">
                  <div className="text-xs font-medium text-amber-700 dark:text-amber-400">Warnings ({warnings.length})</div>
                  <ul className="text-xs text-muted-foreground list-disc pl-4 space-y-1">
                    {warnings.slice(0, 10).map((item) => (
                      <li key={`${item.code}-${item.message}`}>{item.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}

          {providerScheduleBlocked && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
              HTML export cannot be scheduled. Switch to Send Now to generate export output.
            </div>
          )}

          <div className="rounded-md border p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="text-sm font-medium">Delivery Timeline</div>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={handleRetryFailed}
                disabled={!hasFailed || retryingFailed}
                data-testid="button-retry-failed"
              >
                {retryingFailed ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5 mr-1.5" />}
                Retry Failed
              </Button>
            </div>

            {timelineQuery.isLoading ? (
              <div className="text-xs text-muted-foreground inline-flex items-center gap-1">
                <Loader2 className="w-3 h-3 animate-spin" /> Loading timeline...
              </div>
            ) : (
              <>
                <div className="flex flex-wrap gap-2 text-xs">
                  <span className="rounded-full bg-muted px-2 py-0.5">Queued {timelineSummary?.queued || 0}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5">Sent {timelineSummary?.sent || 0}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5">Failed {timelineSummary?.failed || 0}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5">Bounced {timelineSummary?.bounced || 0}</span>
                </div>

                <div className="space-y-1 max-h-28 overflow-y-auto pr-1">
                  {timelineEvents.length === 0 ? (
                    <div className="text-xs text-muted-foreground">No delivery events yet.</div>
                  ) : (
                    timelineEvents
                      .slice()
                      .reverse()
                      .slice(0, 8)
                      .map((event) => (
                        <div key={event.id} className="text-xs flex items-center justify-between gap-2">
                          <span>{formatEventType(event.eventType)}</span>
                          <span className="text-muted-foreground">
                            {event.occurredAt ? new Date(event.occurredAt).toLocaleString() : "-"}
                          </span>
                        </div>
                      ))
                  )}
                </div>
              </>
            )}
          </div>

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
            {actionMode === "schedule" ? "Schedule" : "Send Now"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
