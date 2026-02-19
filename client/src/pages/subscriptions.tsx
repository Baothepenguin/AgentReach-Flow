import { useState, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TopNav } from "@/components/TopNav";
import { ClientSidePanel } from "@/components/ClientSidePanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { RefreshCw, X, Plus, Save } from "lucide-react";
import { format } from "date-fns";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Subscription, Client } from "@shared/schema";

type SubscriptionWithClient = Subscription & { client: Client };
type StripeProductRow = {
  id: string;
  name?: string | null;
  price_id?: string | null;
  unit_amount?: number | null;
  currency?: string | null;
};
type StripePriceOption = StripeProductRow & { productName: string };

function StatusDot({ color }: { color: string }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />;
}

function getStatusIndicator(status: string) {
  switch (status) {
    case "active":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
          <StatusDot color="bg-blue-500" />
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
  linkedInvoices,
  linkedNewsletterCount,
  onClose,
  onUpdated,
  onOpenClientCard,
}: {
  subscription: SubscriptionWithClient;
  linkedInvoices: any[];
  linkedNewsletterCount: number;
  onClose: () => void;
  onUpdated: () => void;
  onOpenClientCard: (clientId: string) => void;
}) {
  const { toast } = useToast();
  const [isEditing, setIsEditing] = useState(false);

  const [editFrequency, setEditFrequency] = useState(subscription.frequency);
  const [editAmount, setEditAmount] = useState(String(subscription.amount));
  const [editStatus, setEditStatus] = useState(subscription.status);
  const [editStartDate, setEditStartDate] = useState(subscription.startDate || "");
  const [editEndDate, setEditEndDate] = useState(subscription.endDate || "");

  const updateMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("PATCH", `/api/subscriptions/${subscription.id}`, {
        frequency: editFrequency,
        amount: editAmount,
        status: editStatus,
        startDate: editStartDate || null,
        endDate: editEndDate || null,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] });
      toast({ title: "Subscription updated" });
      setIsEditing(false);
      onUpdated();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="w-96 border-l border-border/50 bg-background h-full overflow-y-auto">
      <div className="p-4 border-b border-border/50 flex items-center justify-between gap-2 sticky top-0 bg-background z-50">
        <div className="flex items-center gap-2">
          {getStatusIndicator(subscription.status)}
          <h3 className="font-semibold">{subscription.client.name}</h3>
        </div>
        <div className="flex items-center gap-1">
          {!isEditing ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-xs"
              onClick={() => setIsEditing(true)}
              data-testid="button-edit-subscription-preview"
            >
              Edit
            </Button>
          ) : null}
          <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-preview">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {isEditing ? (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Frequency</Label>
                <Select value={editFrequency} onValueChange={(v) => setEditFrequency(v as typeof editFrequency)}>
                  <SelectTrigger data-testid="select-edit-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="biweekly">Biweekly</SelectItem>
                    <SelectItem value="monthly">Monthly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Amount</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editAmount}
                  onChange={(e) => setEditAmount(e.target.value)}
                  data-testid="input-edit-amount"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Status</Label>
                <Select value={editStatus} onValueChange={(v) => setEditStatus(v as typeof editStatus)}>
                  <SelectTrigger data-testid="select-edit-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="paused">Paused</SelectItem>
                    <SelectItem value="canceled">Canceled</SelectItem>
                    <SelectItem value="past_due">Past Due</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Start Date</Label>
                <Input
                  type="date"
                  value={editStartDate}
                  onChange={(e) => setEditStartDate(e.target.value)}
                  data-testid="input-edit-start-date"
                />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs text-muted-foreground">End Date</Label>
                <Input
                  type="date"
                  value={editEndDate}
                  onChange={(e) => setEditEndDate(e.target.value)}
                  data-testid="input-edit-end-date"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
                data-testid="button-save-subscription"
              >
                <Save className="w-4 h-4 mr-1.5" />
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button
                variant="ghost"
                onClick={() => setIsEditing(false)}
                className="text-xs"
                data-testid="button-cancel-subscription-edit"
              >
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <div className="rounded-md bg-muted/25 p-3">
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="text-muted-foreground">Frequency</div>
              <div>{formatFrequency(subscription.frequency)}</div>
              <div className="text-muted-foreground">Amount</div>
              <div>{subscription.currency} ${Number(subscription.amount).toFixed(2)}</div>
              <div className="text-muted-foreground">Status</div>
              <div className="capitalize">{subscription.status.replace("_", " ")}</div>
              <div className="text-muted-foreground">Start</div>
              <div>{subscription.startDate ? format(new Date(subscription.startDate), "MMM d, yyyy") : "-"}</div>
              <div className="text-muted-foreground">End</div>
              <div>{subscription.endDate ? format(new Date(subscription.endDate), "MMM d, yyyy") : "-"}</div>
            </div>
          </div>
        )}

        <div className="rounded-md bg-muted/25 p-3">
          <h4 className="text-xs font-medium text-muted-foreground mb-2">Connected</h4>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
            <div className="text-muted-foreground">Orders</div>
            <div>{linkedInvoices.length}</div>
            <div className="text-muted-foreground">Newsletters</div>
            <div>{linkedNewsletterCount}</div>
          </div>
          {linkedInvoices.length > 0 && (
            <div className="mt-2 space-y-1">
              {linkedInvoices.slice(0, 4).map((invoice) => (
                <div key={invoice.id} className="text-[11px] text-muted-foreground">
                  #{invoice.id.slice(0, 8)} · {invoice.status}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="pt-4 border-t border-border/30">
          <h4 className="text-xs font-medium text-muted-foreground mb-3">Client</h4>
          <div className="py-2 space-y-2">
            <div
              className="cursor-pointer hover-elevate rounded-md px-2 py-1.5"
              onClick={() => onOpenClientCard(subscription.client.id)}
              data-testid={`link-client-${subscription.client.id}`}
            >
              <p className="font-medium">{subscription.client.name}</p>
              <p className="text-sm text-muted-foreground">{subscription.client.primaryEmail}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SubscriptionsPage() {
  const [selectedSubscription, setSelectedSubscription] = useState<SubscriptionWithClient | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const { toast } = useToast();

  const { data: subscriptions = [], isLoading } = useQuery<SubscriptionWithClient[]>({
    queryKey: ["/api/subscriptions"],
  });
  const { data: stripeProductsData } = useQuery<{ data: StripeProductRow[] }>({
    queryKey: ["/api/stripe/products"],
    enabled: false,
  });
  const stripeProducts = stripeProductsData?.data || [];
  const [stripeFilterProductId, setStripeFilterProductId] = useState("");
  const [stripeFilterPriceId, setStripeFilterPriceId] = useState("");
  const [stripeManualProductId, setStripeManualProductId] = useState("");
  const [stripeManualPriceId, setStripeManualPriceId] = useState("");
  const [stripeFilterCustomerEmail, setStripeFilterCustomerEmail] = useState("");
  const [stripeFilterFromDate, setStripeFilterFromDate] = useState("");
  const [stripeFilterToDate, setStripeFilterToDate] = useState("");
  const [showStripePullPanel, setShowStripePullPanel] = useState(false);

  const stripeProductOptions = useMemo(() => {
    const grouped = new Map<string, { id: string; name: string; prices: StripeProductRow[] }>();
    for (const row of stripeProducts) {
      if (!row.id) continue;
      if (!grouped.has(row.id)) {
        grouped.set(row.id, {
          id: row.id,
          name: row.name || row.id,
          prices: [],
        });
      }
      if (row.price_id) {
        grouped.get(row.id)!.prices.push(row);
      }
    }
    return Array.from(grouped.values());
  }, [stripeProducts]);

  const stripePriceOptions = useMemo(() => {
    const allPrices: StripePriceOption[] = stripeProductOptions.flatMap((product) =>
      product.prices.map((price) => ({ ...price, productName: product.name || product.id }))
    );

    const uniqueByPriceId = new Map<string, StripePriceOption>();
    for (const price of allPrices) {
      const key = price.price_id || `${price.id}-${price.unit_amount}-${price.currency}`;
      if (!uniqueByPriceId.has(key)) {
        uniqueByPriceId.set(key, price);
      }
    }

    if (!stripeFilterProductId) {
      return Array.from(uniqueByPriceId.values());
    }

    return Array.from(uniqueByPriceId.values()).filter((price) => price.id === stripeFilterProductId);
  }, [stripeProductOptions, stripeFilterProductId]);

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });
  const { data: invoices = [] } = useQuery<any[]>({
    queryKey: ["/api/invoices"],
  });

  const [newClientId, setNewClientId] = useState("");
  const [newFrequency, setNewFrequency] = useState("monthly");
  const [newAmount, setNewAmount] = useState("");
  const [newCurrency, setNewCurrency] = useState("USD");
  const [newStatus, setNewStatus] = useState("active");

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/subscriptions", {
        clientId: newClientId,
        frequency: newFrequency,
        amount: newAmount,
        currency: newCurrency,
        status: newStatus,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] });
      toast({ title: "Subscription created" });
      setCreateOpen(false);
      setNewClientId("");
      setNewFrequency("monthly");
      setNewAmount("");
      setNewCurrency("USD");
      setNewStatus("active");
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create", description: error.message, variant: "destructive" });
    },
  });

  const pullStripeSubscriptionsMutation = useMutation({
    mutationFn: async () => {
      if (
        stripeFilterFromDate &&
        stripeFilterToDate &&
        stripeFilterFromDate > stripeFilterToDate
      ) {
        throw new Error("From date must be on or before To date");
      }

      const effectiveProductId = stripeManualProductId.trim() || stripeFilterProductId;
      const effectivePriceId = stripeManualPriceId.trim() || stripeFilterPriceId;
      const payload: Record<string, string> = {};
      if (effectiveProductId) payload.productId = effectiveProductId;
      if (effectivePriceId) payload.priceId = effectivePriceId;
      if (stripeFilterCustomerEmail.trim()) payload.customerEmail = stripeFilterCustomerEmail.trim();
      if (stripeFilterFromDate) payload.fromDate = stripeFilterFromDate;
      if (stripeFilterToDate) payload.toDate = stripeFilterToDate;
      const res = await apiRequest("POST", "/api/stripe/pull-subscriptions", payload);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      const created = data?.createdCount ?? 0;
      const updated = data?.updatedCount ?? 0;
      const filteredOut = data?.filteredOutCount ?? 0;
      toast({
        title: "Stripe subscriptions synced",
        description: `Created ${created}, updated ${updated} (${filteredOut} filtered out).`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Stripe sync failed", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      <div className="flex h-[calc(100vh-56px)]">
        <div className="flex-1 px-8 py-6 overflow-auto">
          <div className="flex items-center justify-between gap-2 mb-6">
            <h1 className="text-xl font-semibold">Subscriptions</h1>
            <Button onClick={() => setCreateOpen(true)} data-testid="button-new-subscription">
              <Plus className="w-4 h-4 mr-1.5" />
              New Subscription
            </Button>
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
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">Client</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">Frequency</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">Amount</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">Status</th>
                    <th className="text-center p-3 text-xs font-medium text-muted-foreground">Orders</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">Start Date</th>
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
                      <td className="p-3">
                        <button
                          type="button"
                          className="font-medium hover:underline"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedClientId(sub.client.id);
                          }}
                        >
                          {sub.client.name}
                        </button>
                      </td>
                      <td className="p-3 text-muted-foreground">{formatFrequency(sub.frequency)}</td>
                      <td className="p-3 text-right">{sub.currency} ${Number(sub.amount).toFixed(2)}</td>
                      <td className="p-3">{getStatusIndicator(sub.status)}</td>
                      <td className="p-3 text-center text-muted-foreground">
                        {invoices.filter((invoice) => invoice.subscriptionId === sub.id).length}
                      </td>
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
            key={selectedSubscription.id}
            subscription={selectedSubscription}
            linkedInvoices={invoices.filter((invoice) => invoice.subscriptionId === selectedSubscription.id)}
            linkedNewsletterCount={invoices
              .filter((invoice) => invoice.subscriptionId === selectedSubscription.id)
              .reduce(
                (count, invoice) =>
                  count + (Array.isArray(invoice.newsletters) ? invoice.newsletters.length : 0),
                0
              )}
            onClose={() => setSelectedSubscription(null)}
            onUpdated={() => setSelectedSubscription(null)}
            onOpenClientCard={setSelectedClientId}
          />
        )}
      </div>

      {selectedClientId && (
        <ClientSidePanel
          clientId={selectedClientId}
          open={!!selectedClientId}
          onClose={() => setSelectedClientId(null)}
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Subscription</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Client</Label>
              <Select value={newClientId} onValueChange={setNewClientId}>
                <SelectTrigger data-testid="select-new-client">
                  <SelectValue placeholder="Select a client" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Frequency</Label>
              <Select value={newFrequency} onValueChange={setNewFrequency}>
                <SelectTrigger data-testid="select-new-frequency">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="weekly">Weekly</SelectItem>
                  <SelectItem value="biweekly">Biweekly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Amount</Label>
              <Input
                type="number"
                step="0.01"
                placeholder="0.00"
                value={newAmount}
                onChange={(e) => setNewAmount(e.target.value)}
                data-testid="input-new-amount"
              />
            </div>
            <div className="space-y-1">
              <Label>Currency</Label>
              <Input
                value={newCurrency}
                onChange={(e) => setNewCurrency(e.target.value)}
                data-testid="input-new-currency"
              />
            </div>
            <div className="space-y-1">
              <Label>Status</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger data-testid="select-new-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="paused">Paused</SelectItem>
                  <SelectItem value="canceled">Canceled</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-create">
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!newClientId || !newAmount || createMutation.isPending}
              data-testid="button-confirm-create-subscription"
            >
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
