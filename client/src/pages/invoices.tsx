import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { TopNav } from "@/components/TopNav";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Receipt, X, Mail, Plus, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { Invoice, Client, Newsletter, Subscription } from "@shared/schema";

type OrderWithRelations = Invoice & { 
  client: Client;
  newsletters?: Newsletter[];
  subscription?: Subscription;
};

function getOrderStatus(order: OrderWithRelations): "new" | "in_progress" | "complete" {
  const newsletters = order.newsletters || [];
  if (newsletters.length === 0) return "new";
  const allSent = newsletters.every(nl => nl.status === "sent");
  if (allSent) return "complete";
  return "in_progress";
}

function getOrderStatusBadge(order: OrderWithRelations) {
  const status = getOrderStatus(order);
  switch (status) {
    case "new":
      return <Badge variant="outline" className="text-xs">New</Badge>;
    case "in_progress":
      return <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs">In Progress</Badge>;
    case "complete":
      return <Badge className="bg-green-500/10 text-green-600 dark:text-green-400 text-xs">Complete</Badge>;
  }
}

function getPaymentStatusBadge(status: string) {
  switch (status) {
    case "paid":
      return <Badge className="bg-green-500/10 text-green-600 dark:text-green-400 text-xs">Paid</Badge>;
    case "pending":
      return <Badge className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 text-xs">Pending</Badge>;
    case "failed":
      return <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 text-xs">Failed</Badge>;
    case "refunded":
      return <Badge className="bg-muted text-muted-foreground text-xs">Refunded</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

function OrderPreview({ 
  order, 
  onClose,
  onCreateNewsletter,
}: { 
  order: OrderWithRelations; 
  onClose: () => void;
  onCreateNewsletter: (order: OrderWithRelations) => void;
}) {
  const [, setLocation] = useLocation();
  
  return (
    <div className="w-96 border-l bg-background h-full overflow-y-auto">
      <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-background">
        <div className="flex items-center gap-2">
          {getOrderStatusBadge(order)}
          <h3 className="font-semibold">{order.client.name}</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-preview">
          <X className="w-4 h-4" />
        </Button>
      </div>
      
      <div className="p-4 space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Order ID</span>
            <span className="font-mono text-xs">{order.id.slice(0, 8)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Date</span>
            <span>{format(new Date(order.createdAt), "MMM d, yyyy")}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-medium">{order.currency} ${Number(order.amount).toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Payment</span>
            {getPaymentStatusBadge(order.status)}
          </div>
        </div>
        
        <div className="pt-4 border-t">
          <h4 className="text-sm font-medium mb-2">Client</h4>
          <Card className="p-3">
            <p className="font-medium">{order.client.name}</p>
            <p className="text-sm text-muted-foreground">{order.client.primaryEmail}</p>
          </Card>
        </div>
        
        <div className="pt-4 border-t">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium">Newsletters</h4>
            <Button 
              variant="ghost" 
              size="sm" 
              className="h-7 text-xs"
              onClick={() => onCreateNewsletter(order)}
              data-testid="button-create-newsletter-from-order"
            >
              <Plus className="w-3 h-3 mr-1" />
              Add
            </Button>
          </div>
          {(!order.newsletters || order.newsletters.length === 0) ? (
            <div className="text-center py-4 text-sm text-muted-foreground bg-muted/30 rounded-md">
              No newsletters assigned
            </div>
          ) : (
            <div className="space-y-2">
              {order.newsletters.map((newsletter) => (
                <Card 
                  key={newsletter.id} 
                  className="p-3 hover-elevate cursor-pointer"
                  onClick={() => setLocation(`/newsletters/${newsletter.id}`)}
                  data-testid={`order-newsletter-${newsletter.id}`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{newsletter.title}</p>
                      {newsletter.expectedSendDate && (
                        <p className="text-xs text-muted-foreground">
                          Due: {format(new Date(newsletter.expectedSendDate), "MMM d, yyyy")}
                        </p>
                      )}
                    </div>
                    <ExternalLink className="w-3 h-3 text-muted-foreground" />
                  </div>
                </Card>
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

  const { data: orders = [], isLoading } = useQuery<OrderWithRelations[]>({
    queryKey: ["/api/invoices"],
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
      const frequency = order.subscription?.frequency || "monthly";
      const title = `${order.client.name} - ${frequency.charAt(0).toUpperCase() + frequency.slice(1)}`;
      
      const res = await apiRequest("POST", `/api/clients/${order.clientId}/newsletters`, {
        title,
        invoiceId: order.id,
        subscriptionId: order.subscriptionId,
        expectedSendDate: new Date().toISOString().split("T")[0],
        status: "not_started",
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
        <div className="flex-1 p-6 overflow-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-semibold">Orders</h1>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">Loading orders...</p>
            </div>
          ) : orders.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Receipt className="w-12 h-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground">No orders yet</p>
              <p className="text-sm text-muted-foreground mt-1">Orders will appear here when payments are received</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left p-3 font-medium">ID</th>
                    <th className="text-left p-3 font-medium">Client</th>
                    <th className="text-left p-3 font-medium">Date</th>
                    <th className="text-right p-3 font-medium">Amount</th>
                    <th className="text-center p-3 font-medium">Newsletters</th>
                    <th className="text-left p-3 font-medium">Status</th>
                    <th className="text-left p-3 font-medium">Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr 
                      key={order.id} 
                      className={`border-t cursor-pointer transition-colors ${selectedOrder?.id === order.id ? "bg-muted" : "hover:bg-muted/30"}`}
                      onClick={() => setSelectedOrder(order)}
                      data-testid={`order-row-${order.id}`}
                    >
                      <td className="p-3 font-mono text-xs">{order.id.slice(0, 8)}</td>
                      <td className="p-3 font-medium">{order.client.name}</td>
                      <td className="p-3 text-muted-foreground">
                        {format(new Date(order.createdAt), "MMM d, yyyy")}
                      </td>
                      <td className="p-3 text-right">{order.currency} ${Number(order.amount).toFixed(2)}</td>
                      <td className="p-3 text-center">
                        <Badge variant="outline" className="text-xs">
                          {order.newsletters?.length || 0}
                        </Badge>
                      </td>
                      <td className="p-3">{getOrderStatusBadge(order)}</td>
                      <td className="p-3">{getPaymentStatusBadge(order.status)}</td>
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
          />
        )}
      </div>
    </div>
  );
}
