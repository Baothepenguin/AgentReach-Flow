import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { TopNav } from "@/components/TopNav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { NEWSLETTER_TEMPLATES, type NewsletterTemplateId } from "@/lib/newsletterTemplates";
import type { BrandingKit, Newsletter } from "@shared/schema";

type OnboardingStatus = {
  onboardingCompleted: boolean;
  billingStatus: string;
  readyForFirstSend?: boolean;
  metrics?: {
    contactCount?: number;
    newsletterCount?: number;
    postmarkProvisioned?: boolean;
  };
  steps: {
    senderVerified: boolean;
    contactsImported: boolean;
    brandKitCompleted: boolean;
    firstNewsletterCreated?: boolean;
  };
};

type ClientResponse = {
  client: {
    id: string;
    name: string;
    primaryEmail: string;
  };
};

export default function DiyOnboardingPage() {
  const { user, refreshUser } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const clientId = (user as any)?.diyClientId as string | undefined;

  const [csvContent, setCsvContent] = useState("email,firstName,lastName,tags\nbao@sansu.ca,Bao,Sun,all");
  const [templateId, setTemplateId] = useState<NewsletterTemplateId>(NEWSLETTER_TEMPLATES[0].id);
  const [brandForm, setBrandForm] = useState({
    companyName: "",
    primaryColor: "#1a5f4a",
    secondaryColor: "#000000",
  });

  const { data: status, refetch: refetchStatus } = useQuery<OnboardingStatus>({
    queryKey: ["/api/auth/diy/onboarding-status"],
  });

  const { data: clientData } = useQuery<ClientResponse>({
    queryKey: ["/api/clients", clientId],
    enabled: !!clientId,
  });

  const { data: brandingKit } = useQuery<BrandingKit | null>({
    queryKey: ["/api/clients", clientId, "branding-kit"],
    enabled: !!clientId,
  });

  const { data: newsletters = [] } = useQuery<Newsletter[]>({
    queryKey: ["/api/clients", clientId, "newsletters"],
    enabled: !!clientId,
    queryFn: async () => {
      const response = await fetch(`/api/clients/${clientId}/newsletters`, { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  useEffect(() => {
    if (!brandingKit) return;
    setBrandForm((prev) => ({
      ...prev,
      companyName: brandingKit.companyName || "",
      primaryColor: brandingKit.primaryColor || prev.primaryColor,
      secondaryColor: brandingKit.secondaryColor || prev.secondaryColor,
    }));
  }, [brandingKit]);

  const verifyMutation = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("DIY workspace missing");
      const res = await apiRequest("POST", `/api/clients/${clientId}/verify-sender`, {});
      return res.json();
    },
    onSuccess: async (data: any) => {
      toast({ title: "Verification sent", description: data?.message || "Check your inbox." });
      await refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "verification-status"] });
    },
    onError: (error: Error) => {
      toast({ title: "Verification failed", description: error.message, variant: "destructive" });
    },
  });

  const refreshVerificationMutation = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("DIY workspace missing");
      const response = await fetch(`/api/clients/${clientId}/verification-status`, { credentials: "include" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload?.error || "Unable to refresh verification status");
      }
      return payload;
    },
    onSuccess: async (payload: any) => {
      await refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "verification-status"] });
      toast({
        title: payload?.isVerified ? "Sender verified" : "Still pending",
        description: payload?.isVerified ? "You can now send newsletters." : "Open your inbox and click verify.",
      });
    },
    onError: (error: Error) => {
      toast({ title: "Status refresh failed", description: error.message, variant: "destructive" });
    },
  });

  const saveBrandMutation = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("DIY workspace missing");
      const res = await apiRequest("PUT", `/api/clients/${clientId}/branding-kit`, {
        companyName: brandForm.companyName,
        primaryColor: brandForm.primaryColor,
        secondaryColor: brandForm.secondaryColor,
      });
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Brand basics saved" });
      await refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "branding-kit"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save brand basics", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("DIY workspace missing");
      const res = await apiRequest("POST", `/api/clients/${clientId}/contacts/import-csv`, {
        csvContent,
        createSegmentsFromTags: false,
        segmentTags: [],
        importSource: "onboarding_portal",
      });
      return res.json();
    },
    onSuccess: async (data: any) => {
      toast({
        title: "Contacts imported",
        description: `${data?.summary?.importedCount || 0} imported, ${data?.summary?.updatedCount || 0} updated`,
      });
      await refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const createFirstNewsletterMutation = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("DIY workspace missing");
      const selected = NEWSLETTER_TEMPLATES.find((item) => item.id === templateId) || NEWSLETTER_TEMPLATES[0];
      const res = await apiRequest("POST", `/api/clients/${clientId}/newsletters`, {
        templateId: selected.id,
        importedHtml: selected.html,
      });
      return res.json();
    },
    onSuccess: async (created: Newsletter) => {
      toast({ title: "First newsletter ready" });
      await refetchStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "newsletters"] });
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
      if (created?.id) {
        setLocation(`/newsletters/${created.id}`);
      }
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create newsletter", description: error.message, variant: "destructive" });
    },
  });

  const completeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/auth/diy/onboarding-complete", {});
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Onboarding completed" });
      await refreshUser();
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({ title: "Cannot complete onboarding", description: error.message, variant: "destructive" });
    },
  });

  const requiredDoneCount = useMemo(() => {
    const steps = status?.steps;
    if (!steps) return 0;
    return [steps.senderVerified, steps.brandKitCompleted, steps.contactsImported].filter(Boolean).length;
  }, [status?.steps]);

  const requiredDone = requiredDoneCount === 3;
  const hasNewsletter = (status?.steps.firstNewsletterCreated || false) || newsletters.length > 0;
  const progressValue = Math.round((requiredDoneCount / 3) * 100);

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-5xl px-6 py-8 space-y-5">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Launch in under 5 minutes</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Complete three quick setup steps, then create your first newsletter from a template.
            </p>
          </div>
          <Badge variant="outline">$49 DIY · up to 2000 contacts/send</Badge>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardHeader className="pb-3">
            <CardTitle className="text-lg">Launch Checklist</CardTitle>
            <CardDescription>
              {requiredDoneCount}/3 required steps complete · {status?.metrics?.contactCount || 0} contacts · {status?.metrics?.newsletterCount || 0} newsletters
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={progressValue} className="h-2" />
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status?.steps.senderVerified ? "default" : "secondary"}>Sender verified</Badge>
              <Badge variant={status?.steps.brandKitCompleted ? "default" : "secondary"}>Brand kit complete</Badge>
              <Badge variant={status?.steps.contactsImported ? "default" : "secondary"}>Contacts imported</Badge>
              {hasNewsletter ? <Badge variant="default">First newsletter ready</Badge> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => completeMutation.mutate()}
                disabled={!requiredDone || completeMutation.isPending}
                data-testid="button-complete-onboarding"
              >
                {completeMutation.isPending ? "Completing..." : "Finish setup"}
              </Button>
              {hasNewsletter ? (
                <Button variant="outline" onClick={() => setLocation("/newsletters")}>Open newsletters</Button>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">1. Verify sending email</CardTitle>
              <CardDescription>One click in inbox. No DNS required for initial send setup.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-sm text-muted-foreground">
                {clientData?.client?.primaryEmail || (user as any)?.email || "Sender email"}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  onClick={() => verifyMutation.mutate()}
                  disabled={verifyMutation.isPending}
                  data-testid="button-send-verify-email"
                >
                  {verifyMutation.isPending ? "Sending..." : "Send verification email"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => refreshVerificationMutation.mutate()}
                  disabled={refreshVerificationMutation.isPending}
                  data-testid="button-refresh-verify-status"
                >
                  {refreshVerificationMutation.isPending ? "Refreshing..." : "Refresh status"}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">2. Brand basics</CardTitle>
              <CardDescription>Set the essentials used by your templates.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label>Company Name</Label>
                <Input
                  value={brandForm.companyName}
                  onChange={(e) => setBrandForm((prev) => ({ ...prev, companyName: e.target.value }))}
                  placeholder="Suncoast Homes"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5">
                  <Label>Primary Color</Label>
                  <Input
                    value={brandForm.primaryColor}
                    onChange={(e) => setBrandForm((prev) => ({ ...prev, primaryColor: e.target.value }))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Secondary Color</Label>
                  <Input
                    value={brandForm.secondaryColor}
                    onChange={(e) => setBrandForm((prev) => ({ ...prev, secondaryColor: e.target.value }))}
                  />
                </div>
              </div>
              <Button
                onClick={() => saveBrandMutation.mutate()}
                disabled={saveBrandMutation.isPending}
                data-testid="button-save-brand-basics"
              >
                {saveBrandMutation.isPending ? "Saving..." : "Save brand basics"}
              </Button>
            </CardContent>
          </Card>

          <Card className="border-border/60">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">3. Import contacts</CardTitle>
              <CardDescription>Paste CSV to import your list quickly.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                value={csvContent}
                onChange={(e) => setCsvContent(e.target.value)}
                className="min-h-[140px] font-mono text-xs"
              />
              <Button
                onClick={() => importMutation.mutate()}
                disabled={importMutation.isPending || !csvContent.trim()}
                data-testid="button-import-contacts-csv"
              >
                {importMutation.isPending ? "Importing..." : "Import contacts"}
              </Button>
            </CardContent>
          </Card>
        </div>

        <Card className="border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle>Create your first newsletter</CardTitle>
            <CardDescription>
              Pick a premium template style. You can edit text, links, images, colors, and logo in Simple Mode.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {NEWSLETTER_TEMPLATES.map((template) => {
                const selected = template.id === templateId;
                return (
                  <button
                    key={template.id}
                    type="button"
                    className={`rounded-2xl border p-4 text-left transition-colors ${
                      selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20"
                    }`}
                    onClick={() => setTemplateId(template.id)}
                    data-testid={`quickstart-template-${template.id}`}
                  >
                    <div className="text-sm font-semibold">{template.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">{template.tagline}</div>
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => createFirstNewsletterMutation.mutate()}
                disabled={createFirstNewsletterMutation.isPending}
                data-testid="button-create-first-newsletter"
              >
                {createFirstNewsletterMutation.isPending ? "Creating..." : "Create first newsletter"}
              </Button>
              {newsletters.length > 0 ? (
                <Button variant="outline" onClick={() => setLocation("/newsletters")}>Use previous newsletter</Button>
              ) : null}
              <div className="text-xs text-muted-foreground">Selected: {NEWSLETTER_TEMPLATES.find((item) => item.id === templateId)?.name}</div>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
