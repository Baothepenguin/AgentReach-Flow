import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { TopNav } from "@/components/TopNav";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  ArrowRight,
  User,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Client, Newsletter, Invoice, ProductionTask, User as UserType, Subscription } from "@shared/schema";
import { format, parseISO, differenceInDays, isPast, isToday } from "date-fns";
import { useState } from "react";

interface EnrichedNewsletter extends Newsletter {
  clientName?: string;
}

interface EnrichedInvoice extends Invoice {
  clientName?: string;
}

interface SubscriptionWithClient extends Subscription {
  client: Client;
}

export default function MasterDashboard() {
  const [, setLocation] = useLocation();

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: newsletters, isLoading: loadingNewsletters } = useQuery<Newsletter[]>({
    queryKey: ["/api/newsletters"],
  });

  const { data: invoices, isLoading: loadingInvoices } = useQuery<EnrichedInvoice[]>({
    queryKey: ["/api/invoices"],
  });

  const { data: subscriptions, isLoading: loadingSubscriptions } = useQuery<SubscriptionWithClient[]>({
    queryKey: ["/api/subscriptions"],
  });

  const { data: currentUser } = useQuery<UserType>({
    queryKey: ["/api/auth/me"],
  });

  const getClientName = (clientId: string) => {
    return clients?.find((c) => c.id === clientId)?.name || "Client";
  };

  const getUpcomingNewsletters = (): EnrichedNewsletter[] => {
    if (!newsletters) return [];
    return newsletters
      .filter((nl) => nl.status !== "sent" && nl.expectedSendDate)
      .map((nl) => ({ ...nl, clientName: getClientName(nl.clientId) }))
      .sort((a, b) => {
        const dateA = a.expectedSendDate ? new Date(a.expectedSendDate).getTime() : Infinity;
        const dateB = b.expectedSendDate ? new Date(b.expectedSendDate).getTime() : Infinity;
        return dateA - dateB;
      })
      .slice(0, 10);
  };

  const getRecentInvoices = (): EnrichedInvoice[] => {
    if (!invoices) return [];
    return invoices.slice(0, 8);
  };

  const getRecentSubscriptions = (): SubscriptionWithClient[] => {
    if (!subscriptions) return [];
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    return subscriptions
      .filter((sub) => {
        const created = new Date(sub.createdAt);
        return created >= sevenDaysAgo;
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  };

  const getUrgencyDot = (sendDate: string | Date | null) => {
    if (!sendDate) return null;
    const date = typeof sendDate === "string" ? parseISO(sendDate) : sendDate;
    if (isPast(date) && !isToday(date)) return "bg-red-400";
    const daysUntil = differenceInDays(date, new Date());
    if (daysUntil <= 5) return "bg-amber-400";
    return "bg-blue-400";
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      draft: "Draft",
      in_review: "In Review",
      changes_requested: "Changes Requested",
      approved: "Approved",
      scheduled: "Scheduled",
      sent: "Sent",
    };
    return labels[status] || status;
  };

  const getInvoiceStatusColor = (status: string) => {
    switch (status) {
      case "paid": return "text-blue-600 dark:text-blue-400";
      case "pending": return "text-amber-600 dark:text-amber-400";
      case "overdue": return "text-red-600 dark:text-red-400";
      default: return "text-muted-foreground";
    }
  };

  const upcomingNewsletters = getUpcomingNewsletters();
  const recentInvoices = getRecentInvoices();
  const recentSubscriptions = getRecentSubscriptions();

  const getSubscriptionStatusColor = (status: string) => {
    switch (status) {
      case "active": return "text-blue-600 dark:text-blue-400";
      case "paused": return "text-amber-600 dark:text-amber-400";
      case "canceled": return "text-muted-foreground";
      case "past_due": return "text-red-600 dark:text-red-400";
      default: return "text-muted-foreground";
    }
  };

  const formatFrequency = (frequency: string) => {
    switch (frequency) {
      case "weekly": return "Weekly";
      case "biweekly": return "Bi-Weekly";
      case "monthly": return "Monthly";
      default: return frequency;
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      <main className="px-8 py-6">
        <div className="mb-6">
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Production overview</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-muted-foreground">Upcoming Newsletters</h2>
              <button
                onClick={() => setLocation("/newsletters")}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                data-testid="button-view-all-newsletters"
              >
                View All
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            {loadingNewsletters ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : upcomingNewsletters.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No upcoming newsletters scheduled
              </div>
            ) : (
              <div className="space-y-px">
                {upcomingNewsletters.map((nl) => (
                  <div
                    key={nl.id}
                    className="flex items-center justify-between gap-4 px-3 py-3 rounded-md hover-elevate cursor-pointer"
                    onClick={() => setLocation(`/newsletters/${nl.id}`)}
                    data-testid={`newsletter-row-${nl.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getUrgencyDot(nl.expectedSendDate) || 'bg-muted'}`} />
                      <div className="min-w-0">
                        <span className="font-medium text-sm">{nl.clientName}</span>
                        <span className="text-muted-foreground text-sm ml-2">{nl.title}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {getStatusLabel(nl.status)}
                      </span>
                      {nl.expectedSendDate && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {format(parseISO(nl.expectedSendDate as string), "MMM d")}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-8">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-muted-foreground">Recent Orders</h2>
                <button
                  onClick={() => setLocation("/orders")}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  data-testid="button-view-all-orders"
                >
                  View All
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              {loadingInvoices ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : recentInvoices.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No invoices yet
                </div>
              ) : (
                <div className="space-y-px">
                  {recentInvoices.slice(0, 5).map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-md hover-elevate cursor-pointer"
                      onClick={() => setLocation(`/orders?id=${inv.id}`)}
                      data-testid={`order-row-${inv.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {inv.clientName || "Client"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          ${parseFloat(inv.amount || "0").toFixed(2)}
                        </div>
                      </div>
                      <span className={`text-xs font-medium capitalize ${getInvoiceStatusColor(inv.status)}`}>
                        {inv.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-muted-foreground" data-testid="heading-new-subscriptions">New Subscriptions</h2>
                <button
                  onClick={() => setLocation("/subscriptions")}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  data-testid="button-view-all-subscriptions"
                >
                  View All
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              {loadingSubscriptions ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : recentSubscriptions.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground" data-testid="text-no-subscriptions">
                  No new subscriptions this week
                </div>
              ) : (
                <div className="space-y-px">
                  {recentSubscriptions.map((sub) => (
                    <div
                      key={sub.id}
                      className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-md hover-elevate cursor-pointer"
                      onClick={() => setLocation("/subscriptions")}
                      data-testid={`subscription-row-${sub.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate" data-testid={`text-subscription-client-${sub.id}`}>
                          {sub.client.name}
                        </div>
                        <div className="text-xs text-muted-foreground" data-testid={`text-subscription-details-${sub.id}`}>
                          {formatFrequency(sub.frequency)} &middot; {sub.currency} ${Number(sub.amount).toFixed(2)}
                        </div>
                      </div>
                      <span className={`text-xs font-medium capitalize ${getSubscriptionStatusColor(sub.status)}`} data-testid={`text-subscription-status-${sub.id}`}>
                        {sub.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
