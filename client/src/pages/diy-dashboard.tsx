import { useMemo } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { format } from "date-fns";
import { TopNav } from "@/components/TopNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { Newsletter } from "@shared/schema";

type NewsletterWithClient = Newsletter & {
  client?: { id: string; name: string };
};

type AnalyticsSummary = {
  sentCount: number;
  uniqueOpens: number;
  uniqueClicks: number;
  openRate: number;
  clickRate: number;
};

type DiyOnboardingStatus = {
  serviceMode: "diy_active" | "dfy_requested" | "dfy_active" | "hybrid";
  billingStatus: string;
  onboardingCompleted: boolean;
  steps: {
    senderVerified: boolean;
    contactsImported: boolean;
    brandKitCompleted: boolean;
  };
};

type DiyFunnelSummary = {
  completedSteps: number;
  totalSteps: number;
  minutesToFirstSend: number | null;
  kpis: {
    senderVerified: boolean;
    contactsImported: boolean;
    generatedNewsletter: boolean;
    sentTest: boolean;
    scheduledFirstSend: boolean;
    completedFirstSend: boolean;
  };
};

export default function DiyDashboardPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const clientId = (user as any)?.diyClientId as string | undefined;

  const { data: newsletters = [] } = useQuery<NewsletterWithClient[]>({
    queryKey: ["/api/newsletters"],
  });

  const { data: contacts = [] } = useQuery<any[]>({
    queryKey: ["/api/clients", clientId, "contacts", "active"],
    enabled: !!clientId,
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/contacts?view=active`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const nextNewsletter = useMemo(() => {
    return [...newsletters]
      .filter((item) => item.status !== "sent" && item.expectedSendDate)
      .sort((a, b) => new Date(a.expectedSendDate as string).getTime() - new Date(b.expectedSendDate as string).getTime())[0];
  }, [newsletters]);

  const lastSentNewsletter = useMemo(() => {
    return [...newsletters]
      .sort((a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime())
      .find((item) => item.status === "sent") || null;
  }, [newsletters]);

  const { data: lastAnalytics } = useQuery<AnalyticsSummary>({
    queryKey: ["/api/newsletters", lastSentNewsletter?.id, "analytics"],
    enabled: !!lastSentNewsletter?.id,
  });

  const { data: onboardingStatus } = useQuery<DiyOnboardingStatus>({
    queryKey: ["/api/auth/diy/onboarding-status"],
  });

  const { data: funnelSummary } = useQuery<DiyFunnelSummary>({
    queryKey: ["/api/diy/funnel-summary"],
  });

  const hireUsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/diy/hire-us", {});
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/diy/onboarding-status"] });
      toast({
        title: "Request received",
        description: "Your done-for-you request was sent to our team.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not request service",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const serviceMode = onboardingStatus?.serviceMode || "diy_active";
  const canRequestDfy = serviceMode === "diy_active" || serviceMode === "hybrid";
  const serviceModeLabel =
    serviceMode === "dfy_requested"
      ? "DFY requested"
      : serviceMode === "dfy_active"
        ? "DFY active"
        : serviceMode === "hybrid"
          ? "Hybrid"
          : "DIY";

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Client Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Your fast lane: contacts at a glance, analytics, and the next suggested send.
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline">Mode: {serviceModeLabel}</Badge>
            {canRequestDfy && (
              <Button
                variant="outline"
                onClick={() => hireUsMutation.mutate()}
                disabled={hireUsMutation.isPending}
                data-testid="button-request-dfy-handoff"
              >
                {hireUsMutation.isPending ? "Requesting..." : "Hire us to run it"}
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Next suggested send</CardDescription>
              <CardTitle className="text-lg">
                {nextNewsletter?.expectedSendDate
                  ? format(new Date(nextNewsletter.expectedSendDate), "MMM d, yyyy")
                  : "Not scheduled"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {nextNewsletter ? (
                <Button variant="outline" size="sm" onClick={() => setLocation(`/newsletters/${nextNewsletter.id}`)}>
                  Open next campaign
                </Button>
              ) : (
                <Button size="sm" onClick={() => setLocation("/newsletters")}>
                  Make your first newsletter
                </Button>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Recent analytics</CardDescription>
              <CardTitle className="text-lg">{lastSentNewsletter ? "Last campaign" : "No sends yet"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm text-muted-foreground">
              <div>Opens: {lastAnalytics?.uniqueOpens ?? 0}</div>
              <div>Clicks: {lastAnalytics?.uniqueClicks ?? 0}</div>
              <div>
                Open rate: {typeof lastAnalytics?.openRate === "number" ? `${Math.round(lastAnalytics.openRate * 100)}%` : "0%"}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardDescription>Contacts at a glance</CardDescription>
              <CardTitle className="text-lg">{contacts.length} active</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Badge variant="outline">$49/mo · up to 2000 contacts/send</Badge>
              <div>
                <Button variant="outline" size="sm" onClick={() => setLocation("/audience")}>
                  Open contacts
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Required onboarding steps</CardTitle>
            <CardDescription>Before production sending, complete all three checks.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="rounded-xl border border-border/60 p-4">
                <div className="text-sm font-medium">Verify sending email</div>
                <div className="text-xs text-muted-foreground mt-1">One-click inbox verification.</div>
                <Badge className="mt-3" variant={onboardingStatus?.steps.senderVerified ? "default" : "secondary"}>
                  {onboardingStatus?.steps.senderVerified ? "Complete" : "Pending"}
                </Badge>
              </div>
              <div className="rounded-xl border border-border/60 p-4">
                <div className="text-sm font-medium">Brand kit completion</div>
                <div className="text-xs text-muted-foreground mt-1">Set company and brand colors.</div>
                <Badge className="mt-3" variant={onboardingStatus?.steps.brandKitCompleted ? "default" : "secondary"}>
                  {onboardingStatus?.steps.brandKitCompleted ? "Complete" : "Pending"}
                </Badge>
              </div>
              <div className="rounded-xl border border-border/60 p-4">
                <div className="text-sm font-medium">Contacts list import</div>
                <div className="text-xs text-muted-foreground mt-1">Import at least one audience contact.</div>
                <Badge className="mt-3" variant={onboardingStatus?.steps.contactsImported ? "default" : "secondary"}>
                  {onboardingStatus?.steps.contactsImported ? "Complete" : "Pending"}
                </Badge>
              </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setLocation("/brand")}>
                Open brand
              </Button>
              <Button variant="outline" size="sm" onClick={() => setLocation("/audience")}>
                Open contacts
              </Button>
              <Button size="sm" onClick={() => setLocation("/newsletters")}>
                Open newsletters
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Launch Funnel (30d)</CardTitle>
            <CardDescription>Tracks first-send activation so onboarding stays under 15 minutes.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div>
              Steps completed: {funnelSummary?.completedSteps ?? 0}/{funnelSummary?.totalSteps ?? 6}
            </div>
            <div>
              Time to first send: {typeof funnelSummary?.minutesToFirstSend === "number" ? `${funnelSummary.minutesToFirstSend} min` : "Not completed"}
            </div>
            <div className="flex items-center gap-2 flex-wrap pt-1">
              <Badge variant={funnelSummary?.kpis?.senderVerified ? "default" : "secondary"}>Sender</Badge>
              <Badge variant={funnelSummary?.kpis?.contactsImported ? "default" : "secondary"}>Contacts</Badge>
              <Badge variant={funnelSummary?.kpis?.generatedNewsletter ? "default" : "secondary"}>Newsletter</Badge>
              <Badge variant={funnelSummary?.kpis?.sentTest ? "default" : "secondary"}>Test</Badge>
              <Badge variant={funnelSummary?.kpis?.scheduledFirstSend ? "default" : "secondary"}>Scheduled</Badge>
              <Badge variant={funnelSummary?.kpis?.completedFirstSend ? "default" : "secondary"}>Sent</Badge>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
