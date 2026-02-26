import { useMutation, useQuery } from "@tanstack/react-query";
import { TopNav } from "@/components/TopNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest } from "@/lib/queryClient";

type DiyPlan = {
  code: string;
  label: string;
  priceUsd: number;
  sendingLimits: {
    maxRecipientsPerSend: number;
  };
};

export default function DiyBillingPage() {
  const { toast } = useToast();
  const { user, refreshUser } = useAuth();

  const { data: plan } = useQuery<DiyPlan>({
    queryKey: ["/api/diy/plan"],
  });

  const checkoutMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/diy/billing/portal", {});
      return res.json();
    },
    onSuccess: (data: { url?: string; mode?: "portal" | "checkout" }) => {
      if (data?.url) {
        window.location.href = data.url;
        return;
      }
      toast({ title: "Billing unavailable", description: "No billing URL was returned.", variant: "destructive" });
    },
    onError: (error: Error) => {
      toast({ title: "Billing failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-4xl px-6 py-8 space-y-5">
        <div>
          <h1 className="text-2xl font-semibold">Billing & Subscription</h1>
          <p className="text-sm text-muted-foreground mt-1">DIY plan for self-serve newsletter operations.</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>{plan?.label || "DIY Monthly"}</CardTitle>
            <CardDescription>$ {plan?.priceUsd ?? 49} / month</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="outline">Status: {(user as any)?.billingStatus || "trialing"}</Badge>
              <Badge variant="secondary">Plan code: {plan?.code || "diy_49_monthly"}</Badge>
            </div>

            <div className="grid grid-cols-1 gap-2 text-sm">
              <div>Max recipients per send: {plan?.sendingLimits.maxRecipientsPerSend ?? 2000}</div>
            </div>

            <div className="pt-2 flex items-center gap-2">
              <Button onClick={() => checkoutMutation.mutate()} disabled={checkoutMutation.isPending} data-testid="button-diy-checkout">
                {checkoutMutation.isPending ? "Opening billing..." : "Manage subscription"}
              </Button>
              <Button variant="outline" onClick={() => refreshUser()}>
                Refresh status
              </Button>
            </div>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
