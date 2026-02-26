import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TopNav } from "@/components/TopNav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import type { BrandingKit, Client } from "@shared/schema";

type FollowUpBossStatus = {
  provider: "follow_up_boss";
  connected: boolean;
  accountLabel: string | null;
  lastSyncedAt: string | null;
  lastSyncStatus: "idle" | "success" | "error";
  lastSyncMessage: string | null;
  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes?: number;
  appUrl: string;
};

export default function DiyBrandPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const clientId = (user as any)?.diyClientId as string | undefined;

  const { data: clientData } = useQuery<{ client: Client }>({
    queryKey: ["/api/clients", clientId],
    enabled: !!clientId,
  });

  const { data: kit } = useQuery<BrandingKit | null>({
    queryKey: ["/api/clients", clientId, "branding-kit"],
    enabled: !!clientId,
  });

  const { data: verification } = useQuery<any>({
    queryKey: ["/api/clients", clientId, "verification-status"],
    enabled: !!clientId,
  });

  const { data: crmStatus, refetch: refetchCrmStatus } = useQuery<FollowUpBossStatus>({
    queryKey: ["/api/clients", clientId, "crm", "follow-up-boss"],
    enabled: !!clientId,
    queryFn: async () => {
      const response = await fetch(`/api/clients/${clientId}/crm/follow-up-boss/status`, {
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error("Failed to load CRM status");
      }
      return response.json();
    },
  });

  const [clientForm, setClientForm] = useState({
    name: "",
    primaryEmail: "",
    phone: "",
    locationCity: "",
    locationRegion: "",
  });

  const [kitForm, setKitForm] = useState({
    companyName: "",
    primaryColor: "#1a5f4a",
    secondaryColor: "#000000",
    website: "",
    instagram: "",
    facebook: "",
    linkedin: "",
  });
  const [followUpBossApiKey, setFollowUpBossApiKey] = useState("");

  useEffect(() => {
    if (!clientData?.client) return;
    const c = clientData.client;
    setClientForm({
      name: c.name || "",
      primaryEmail: c.primaryEmail || "",
      phone: c.phone || "",
      locationCity: c.locationCity || "",
      locationRegion: c.locationRegion || "",
    });
  }, [clientData]);

  useEffect(() => {
    if (!kit) return;
    setKitForm({
      companyName: kit.companyName || "",
      primaryColor: kit.primaryColor || "#1a5f4a",
      secondaryColor: kit.secondaryColor || "#000000",
      website: kit.website || "",
      instagram: kit.instagram || "",
      facebook: kit.facebook || "",
      linkedin: kit.linkedin || "",
    });
  }, [kit]);

  const locationLabel = useMemo(
    () => [clientForm.locationCity, clientForm.locationRegion].filter(Boolean).join(", "),
    [clientForm.locationCity, clientForm.locationRegion]
  );

  const saveClientMutation = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("DIY client not found");
      const res = await apiRequest("PATCH", `/api/clients/${clientId}`, clientForm);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
      toast({ title: "Settings saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save settings", description: error.message, variant: "destructive" });
    },
  });

  const saveBrandMutation = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("DIY client not found");
      const res = await apiRequest("PUT", `/api/clients/${clientId}/branding-kit`, kitForm);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "branding-kit"] });
      toast({ title: "Branding saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save branding", description: error.message, variant: "destructive" });
    },
  });

  const verifySenderMutation = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("DIY client not found");
      const res = await apiRequest("POST", `/api/clients/${clientId}/verify-sender`, {});
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "verification-status"] });
      toast({ title: "Verification email sent", description: data?.message || "Check your inbox to confirm sender." });
    },
    onError: (error: Error) => {
      toast({ title: "Could not send verification", description: error.message, variant: "destructive" });
    },
  });

  const connectFollowUpBossMutation = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("DIY client not found");
      if (!followUpBossApiKey.trim()) throw new Error("Follow Up Boss API key is required");
      const response = await apiRequest("POST", `/api/clients/${clientId}/crm/follow-up-boss/connect`, {
        apiKey: followUpBossApiKey.trim(),
      });
      return response.json();
    },
    onSuccess: async () => {
      setFollowUpBossApiKey("");
      await refetchCrmStatus();
      toast({ title: "Follow Up Boss connected" });
    },
    onError: (error: Error) => {
      toast({ title: "Connection failed", description: error.message, variant: "destructive" });
    },
  });

  const syncFollowUpBossMutation = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("DIY client not found");
      const response = await apiRequest("POST", `/api/clients/${clientId}/crm/follow-up-boss/sync-contacts`, {});
      return response.json();
    },
    onSuccess: async (data: any) => {
      await refetchCrmStatus();
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contact-import-jobs"] });
      const summary = data?.summary || {};
      toast({
        title: "Follow Up Boss sync complete",
        description: `${summary.importedCount || 0} new, ${summary.updatedCount || 0} updated`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Sync failed", description: error.message, variant: "destructive" });
    },
  });

  const disconnectFollowUpBossMutation = useMutation({
    mutationFn: async () => {
      if (!clientId) throw new Error("DIY client not found");
      await apiRequest("DELETE", `/api/clients/${clientId}/crm/follow-up-boss/connect`, {});
    },
    onSuccess: async () => {
      await refetchCrmStatus();
      toast({ title: "Follow Up Boss disconnected" });
    },
    onError: (error: Error) => {
      toast({ title: "Disconnect failed", description: error.message, variant: "destructive" });
    },
  });

  const toggleFollowUpBossAutoSyncMutation = useMutation({
    mutationFn: async (autoSyncEnabled: boolean) => {
      if (!clientId) throw new Error("DIY client not found");
      const response = await apiRequest("PATCH", `/api/clients/${clientId}/crm/follow-up-boss/settings`, {
        autoSyncEnabled,
      });
      return response.json();
    },
    onSuccess: async () => {
      await refetchCrmStatus();
      toast({ title: "Auto-sync updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update auto-sync", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-5xl px-6 py-8 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">Brand</h1>
          <p className="text-sm text-muted-foreground mt-1">Sender verification and brand kit completion for onboarding.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Sender Verification</CardTitle>
            <CardDescription>One-click sender verification from your inbox.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={verification?.isVerified ? "default" : "secondary"}>
                {verification?.isVerified ? "Verified" : "Pending"}
              </Badge>
              {locationLabel ? <Badge variant="outline">{locationLabel}</Badge> : null}
            </div>
            {verification?.senderRequirementMessage ? (
              <div className="text-xs text-amber-700">{verification.senderRequirementMessage}</div>
            ) : null}
            <Button onClick={() => verifySenderMutation.mutate()} disabled={verifySenderMutation.isPending}>
              {verifySenderMutation.isPending ? "Sending..." : "Verify sender email"}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Brand Basics</CardTitle>
            <CardDescription>Used by the default DIY newsletter template.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input value={clientForm.name} onChange={(e) => setClientForm((prev) => ({ ...prev, name: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input
                value={clientForm.primaryEmail}
                onChange={(e) => setClientForm((prev) => ({ ...prev, primaryEmail: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input value={clientForm.phone} onChange={(e) => setClientForm((prev) => ({ ...prev, phone: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Company Name</Label>
              <Input
                value={kitForm.companyName}
                onChange={(e) => setKitForm((prev) => ({ ...prev, companyName: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Primary Color</Label>
              <Input
                value={kitForm.primaryColor}
                onChange={(e) => setKitForm((prev) => ({ ...prev, primaryColor: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Secondary Color</Label>
              <Input
                value={kitForm.secondaryColor}
                onChange={(e) => setKitForm((prev) => ({ ...prev, secondaryColor: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Website</Label>
              <Input value={kitForm.website} onChange={(e) => setKitForm((prev) => ({ ...prev, website: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Instagram</Label>
              <Input
                value={kitForm.instagram}
                onChange={(e) => setKitForm((prev) => ({ ...prev, instagram: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Facebook</Label>
              <Input value={kitForm.facebook} onChange={(e) => setKitForm((prev) => ({ ...prev, facebook: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>LinkedIn</Label>
              <Input value={kitForm.linkedin} onChange={(e) => setKitForm((prev) => ({ ...prev, linkedin: e.target.value }))} />
            </div>
            <div className="md:col-span-2 flex items-center gap-2 pt-1">
              <Button onClick={() => saveClientMutation.mutate()} disabled={saveClientMutation.isPending}>
                {saveClientMutation.isPending ? "Saving..." : "Save contact basics"}
              </Button>
              <Button variant="outline" onClick={() => saveBrandMutation.mutate()} disabled={saveBrandMutation.isPending}>
                {saveBrandMutation.isPending ? "Saving..." : "Save branding"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Follow Up Boss</CardTitle>
            <CardDescription>Connect once, then sync your CRM contacts into Flow.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant={crmStatus?.connected ? "default" : "secondary"}>
                {crmStatus?.connected ? "Connected" : "Not connected"}
              </Badge>
              {crmStatus?.accountLabel ? <Badge variant="outline">{crmStatus.accountLabel}</Badge> : null}
              {crmStatus?.connected ? (
                <Badge variant="outline">
                  Auto-sync {crmStatus.autoSyncEnabled ? "on" : "off"}
                </Badge>
              ) : null}
            </div>
            {crmStatus?.lastSyncMessage ? (
              <div className="text-xs text-muted-foreground">
                {crmStatus.lastSyncMessage}
              </div>
            ) : null}
            <div className="space-y-1.5">
              <Label>Follow Up Boss API Key</Label>
              <Input
                type="password"
                value={followUpBossApiKey}
                onChange={(event) => setFollowUpBossApiKey(event.target.value)}
                placeholder={crmStatus?.connected ? "Connected (enter new key to rotate)" : "fub_api_key..."}
              />
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <Button
                onClick={() => connectFollowUpBossMutation.mutate()}
                disabled={connectFollowUpBossMutation.isPending || !followUpBossApiKey.trim()}
              >
                {connectFollowUpBossMutation.isPending ? "Connecting..." : crmStatus?.connected ? "Rotate Key" : "Connect"}
              </Button>
              <Button
                variant="outline"
                onClick={() => syncFollowUpBossMutation.mutate()}
                disabled={syncFollowUpBossMutation.isPending || !crmStatus?.connected}
              >
                {syncFollowUpBossMutation.isPending ? "Syncing..." : "Sync contacts now"}
              </Button>
              {crmStatus?.connected ? (
                <Button
                  variant="outline"
                  onClick={() => toggleFollowUpBossAutoSyncMutation.mutate(!crmStatus.autoSyncEnabled)}
                  disabled={toggleFollowUpBossAutoSyncMutation.isPending}
                >
                  {toggleFollowUpBossAutoSyncMutation.isPending
                    ? "Saving..."
                    : crmStatus.autoSyncEnabled
                      ? "Turn auto-sync off"
                      : "Turn auto-sync on"}
                </Button>
              ) : null}
              {crmStatus?.connected ? (
                <Button
                  variant="ghost"
                  onClick={() => disconnectFollowUpBossMutation.mutate()}
                  disabled={disconnectFollowUpBossMutation.isPending}
                >
                  {disconnectFollowUpBossMutation.isPending ? "Disconnecting..." : "Disconnect"}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
