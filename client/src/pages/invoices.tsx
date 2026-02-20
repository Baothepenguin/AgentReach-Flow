import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { TopNav } from "@/components/TopNav";
import { ClientSidePanel } from "@/components/ClientSidePanel";
import { Button } from "@/components/ui/button";
import { Receipt, X, Plus, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Invoice, Client, Newsletter, Subscription } from "@shared/schema";

type OrderWithRelations = Invoice & { 
  client: Client;
  newsletters?: Newsletter[];
  subscription?: Subscription;
};

type StripeProductRow = {
  id: string;
  name?: string | null;
  price_id?: string | null;
  unit_amount?: number | null;
  currency?: string | null;
};
type StripePriceOption = StripeProductRow & { productName: string };

function getOrderStatus(order: OrderWithRelations): "new" | "in_progress" | "complete" {
  const newsletters = order.newsletters || [];
  if (newsletters.length === 0) return "new";
  const allDraft = newsletters.every(nl => nl.status === "draft");
  if (allDraft) return "new";
  const allSent = newsletters.every(nl => nl.status === "sent");
  if (allSent) return "complete";
  return "in_progress";
}

function StatusDot({ color }: { color: string }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full ${color}`} />;
}

function getOrderStatusIndicator(order: OrderWithRelations) {
  const status = getOrderStatus(order);
  switch (status) {
    case "new":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
          <StatusDot color="bg-blue-500" />
          New
        </span>
      );
    case "in_progress":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <StatusDot color="bg-amber-500" />
          In Progress
        </span>
      );
    case "complete":
      return (
        <span className="inline-flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
          <StatusDot color="bg-blue-500" />
          Complete
        </span>
      );
  }
}

function OrderPreview({ 
  order, 
  onClose,
  onCreateNewsletter,
  onOpenClientCard,
}: { 
  order: OrderWithRelations; 
  onClose: () => void;
  onCreateNewsletter: (order: OrderWithRelations) => void;
  onOpenClientCard: (clientId: string) => void;
}) {
  const [, setLocation] = useLocation();
  
  return (
    <div className="w-96 border-l border-border/50 bg-background h-full overflow-y-auto">
      <div className="p-4 border-b border-border/50 flex items-center justify-between gap-2 sticky top-0 bg-background z-50">
        <div className="flex items-center gap-2">
          {getOrderStatusIndicator(order)}
          <h3 className="font-semibold">{order.client.name}</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-preview">
          <X className="w-4 h-4" />
        </Button>
      </div>
      
      <div className="p-4 space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Order ID</span>
            <span className="font-mono text-xs">{order.id.slice(0, 8)}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Date</span>
            <span>{format(new Date(order.createdAt), "MMM d, yyyy")}</span>
          </div>
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-medium">{order.currency} ${Number(order.amount).toFixed(2)}</span>
          </div>
        </div>
        
        <div className="pt-4 border-t border-border/30">
          <h4 className="text-xs font-medium text-muted-foreground mb-3">Client</h4>
          <div className="py-2 space-y-2">
            <div onClick={() => onOpenClientCard(order.client.id)} className="cursor-pointer hover:underline">
              <p className="font-medium">{order.client.name}</p>
              <p className="text-sm text-muted-foreground">{order.client.primaryEmail}</p>
            </div>
            {order.subscription && (
              <div className="text-xs text-muted-foreground">
                Subscription: {order.subscription.frequency} · {order.subscription.status}
              </div>
            )}
          </div>
        </div>
        
        <div className="pt-4 border-t border-border/30">
          <div className="flex items-center justify-between gap-2 mb-3">
            <h4 className="text-xs font-medium text-muted-foreground">Newsletters</h4>
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={() => onCreateNewsletter(order)}
              data-testid="button-create-newsletter-from-order"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add
            </Button>
          </div>
          {(!order.newsletters || order.newsletters.length === 0) ? (
            <div className="text-center py-4 text-sm text-muted-foreground rounded-md">
              No newsletters assigned
            </div>
          ) : (
            <div className="space-y-1">
              {order.newsletters.map((newsletter) => (
                <div 
                  key={newsletter.id} 
                  className="p-3 rounded-md hover-elevate cursor-pointer"
                  onClick={() => setLocation(`/newsletters/${newsletter.id}`)}
                  data-testid={`order-newsletter-${newsletter.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p className="font-medium text-sm">{newsletter.title}</p>
                      {newsletter.expectedSendDate && (
                        <p className="text-xs text-muted-foreground">
                          Due: {format(new Date(newsletter.expectedSendDate), "MMM d, yyyy")}
                        </p>
                      )}
                    </div>
                    <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function OrdersPage() {
  const [, setLocation] = useLocation();
  const searchString = useSearch();
  const { toast } = useToast();
  const [selectedOrder, setSelectedOrder] = useState<OrderWithRelations | null>(null);
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);

  const { data: orders = [], isLoading } = useQuery<OrderWithRelations[]>({
    queryKey: ["/api/invoices"],
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

  const pullStripeOrdersMutation = useMutation({
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
      const res = await apiRequest("POST", "/api/stripe/pull-orders", payload);
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      const imported = data?.importedCount ?? 0;
      const scanned = data?.scanned ?? 0;
      const filteredOut = data?.filteredOutCount ?? 0;
      toast({
        title: "Stripe orders synced",
        description: `Imported ${imported} from ${scanned} scanned (${filteredOut} filtered out).`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Stripe sync failed", description: error.message, variant: "destructive" });
    },
  });

  useEffect(() => {
    if (searchString && orders.length > 0) {
      const params = new URLSearchParams(searchString);
      const orderId = params.get("id");
      if (orderId) {
        const order = orders.find(o => o.id === orderId);
        if (order) {
          setSelectedOrder(order);
        }
      }
    }
  }, [searchString, orders]);

  const handleCreateNewsletter = async (order: OrderWithRelations) => {
    try {
      const res = await apiRequest("POST", `/api/clients/${order.clientId}/newsletters`, {
        invoiceId: order.id,
        subscriptionId: order.subscriptionId,
        expectedSendDate: new Date().toISOString().split("T")[0],
        status: "draft",
      });
      
      if (!res.ok) throw new Error("Failed to create newsletter");
      
      const newsletter = await res.json();
      queryClient.invalidateQueries({ queryKey: ["/api/invoices"] });
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
      toast({ title: "Newsletter created" });
      setLocation(`/newsletters/${newsletter.id}`);
    } catch (error) {
      toast({ title: "Failed to create newsletter", variant: "destructive" });
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      
      <div className="flex h-[calc(100vh-56px)]">
        <div className="flex-1 px-8 py-6 overflow-auto">
          <div className="flex items-center justify-between gap-2 mb-6">
            <h1 className="text-xl font-semibold">Orders</h1>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">Loading orders...</p>
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Receipt className="w-12 h-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground">No orders yet</p>
              <p className="text-sm text-muted-foreground mt-1">Orders will appear here automatically</p>
            </div>
          ) : (
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">ID</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">Client</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">Date</th>
                    <th className="text-right p-3 text-xs font-medium text-muted-foreground">Amount</th>
                    <th className="text-center p-3 text-xs font-medium text-muted-foreground">Newsletters</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr 
                      key={order.id} 
                      className={`border-b border-border/50 cursor-pointer transition-colors ${selectedOrder?.id === order.id ? "bg-muted/30" : "hover:bg-muted/20"}`}
                      onClick={() => setSelectedOrder(order)}
                      data-testid={`order-row-${order.id}`}
                    >
                      <td className="p-3 font-mono text-xs text-muted-foreground">{order.id.slice(0, 8)}</td>
                      <td className="p-3">
                        <button
                          type="button"
                          className="font-medium hover:underline"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedClientId(order.client.id);
                          }}
                        >
                          {order.client.name}
                        </button>
                      </td>
                      <td className="p-3 text-muted-foreground">
                        {format(new Date(order.createdAt), "MMM d, yyyy")}
                      </td>
                      <td className="p-3 text-right">{order.currency} ${Number(order.amount).toFixed(2)}</td>
                      <td className="p-3 text-center text-muted-foreground">
                        {order.newsletters?.length || 0}
                      </td>
                      <td className="p-3">{getOrderStatusIndicator(order)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        
        {selectedOrder && (
          <OrderPreview 
            order={selectedOrder} 
            onClose={() => setSelectedOrder(null)}
            onCreateNewsletter={handleCreateNewsletter}
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
    </div>
  );
}
