import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { TopNav } from "@/components/TopNav";
import { Button } from "@/components/ui/button";
import { RefreshCw, X } from "lucide-react";
import { format } from "date-fns";
import type { Subscription, Client } from "@shared/schema";

type SubscriptionWithClient = Subscription & { client: Client };

function StatusDot({ color }: { color: string }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />;
}

function getStatusIndicator(status: string) {
  switch (status) {
    case "active":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
          <StatusDot color="bg-green-500" />
          Active
        </span>
      );
    case "paused":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <StatusDot color="bg-amber-500" />
          Paused
        </span>
      );
    case "canceled":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot color="bg-muted-foreground" />
          Canceled
        </span>
      );
    case "past_due":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
          <StatusDot color="bg-red-500" />
          Past Due
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot color="bg-muted-foreground" />
          {status}
        </span>
      );
  }
}

function formatFrequency(frequency: string) {
  switch (frequency) {
    case "weekly": return "Weekly";
    case "biweekly": return "Biweekly";
    case "monthly": return "Monthly";
    default: return frequency;
  }
}

function SubscriptionPreview({
  subscription,
  onClose,
}: {
  subscription: SubscriptionWithClient;
  onClose: () => void;
}) {
  const [, setLocation] = useLocation();

  return (
    <div className="w-96 border-l border-border/50 bg-background h-full overflow-y-auto">
      <div className="p-4 border-b border-border/50 flex items-center justify-between gap-2 sticky top-0 bg-background z-50">
        <div className="flex items-center gap-2">
          {getStatusIndicator(subscription.status)}
          <h3 className="font-semibold">{subscription.client.name}</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-preview">
          <X className="w-4 h-4" />
        </Button>
      </div>

      <div className="p-4 space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Frequency</span>
            <span>{formatFrequency(subscription.frequency)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-medium">{subscription.currency} ${Number(subscription.amount).toFixed(2)}</span>
          </div>
          {subscription.mrr && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">MRR</span>
              <span className="font-medium">${Number(subscription.mrr).toFixed(2)}</span>
            </div>
          )}
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Status</span>
            {getStatusIndicator(subscription.status)}
          </div>
          {subscription.startDate && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">Start Date</span>
              <span>{format(new Date(subscription.startDate), "MMM d, yyyy")}</span>
            </div>
          )}
          {subscription.endDate && (
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="text-muted-foreground">End Date</span>
              <span>{format(new Date(subscription.endDate), "MMM d, yyyy")}</span>
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-border/30">
          <h4 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">Client</h4>
          <div
            className="py-2 cursor-pointer hover-elevate rounded-md px-2"
            onClick={() => setLocation(`/clients?id=${subscription.client.id}`)}
            data-testid={`link-client-${subscription.client.id}`}
          >
            <p className="font-medium">{subscription.client.name}</p>
            <p className="text-sm text-muted-foreground">{subscription.client.primaryEmail}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SubscriptionsPage() {
  const [selectedSubscription, setSelectedSubscription] = useState<SubscriptionWithClient | null>(null);

  const { data: subscriptions = [], isLoading } = useQuery<SubscriptionWithClient[]>({
    queryKey: ["/api/subscriptions"],
  });

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      <div className="flex h-[calc(100vh-56px)]">
        <div className="flex-1 p-6 overflow-auto">
          <div className="flex items-center justify-between gap-2 mb-6">
            <h1 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Subscriptions</h1>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">Loading subscriptions...</p>
            </div>
          ) : subscriptions.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <RefreshCw className="w-12 h-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground">No subscriptions yet</p>
              <p className="text-sm text-muted-foreground mt-1">Subscriptions will appear here when clients subscribe</p>
            </div>
          ) : (
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Client</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Frequency</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Amount</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Status</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Start Date</th>
                  </tr>
                </thead>
                <tbody>
                  {subscriptions.map((sub) => (
                    <tr
                      key={sub.id}
                      className={`border-b border-border/50 cursor-pointer transition-colors ${selectedSubscription?.id === sub.id ? "bg-muted/30" : "hover:bg-muted/20"}`}
                      onClick={() => setSelectedSubscription(sub)}
                      data-testid={`subscription-row-${sub.id}`}
                    >
                      <td className="p-3 font-medium">{sub.client.name}</td>
                      <td className="p-3 text-muted-foreground">{formatFrequency(sub.frequency)}</td>
                      <td className="p-3 text-right">{sub.currency} ${Number(sub.amount).toFixed(2)}</td>
                      <td className="p-3">{getStatusIndicator(sub.status)}</td>
                      <td className="p-3 text-muted-foreground">
                        {sub.startDate ? format(new Date(sub.startDate), "MMM d, yyyy") : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {selectedSubscription && (
          <SubscriptionPreview
            subscription={selectedSubscription}
            onClose={() => setSelectedSubscription(null)}
          />
        )}
      </div>
    </div>
  );
}
