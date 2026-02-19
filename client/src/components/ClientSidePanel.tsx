import { useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Mail, Phone, MapPin, Calendar, CreditCard, Palette, FileText } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import type { Client, Subscription, BrandingKit, Invoice, Newsletter } from "@shared/schema";

interface ClientSidePanelProps {
  clientId: string;
  open: boolean;
  onClose: () => void;
}

function getStatusBadge(status: string) {
  switch (status) {
    case "active":
      return <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs">Active</Badge>;
    case "paid":
      return <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 text-xs">Paid</Badge>;
    case "pending":
      return <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs">Pending</Badge>;
    case "overdue":
      return <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 text-xs">Overdue</Badge>;
    default:
      return <Badge variant="outline" className="text-xs">{status}</Badge>;
  }
}

export function ClientSidePanel({ clientId, open, onClose }: ClientSidePanelProps) {
  const { data: clientData, isLoading } = useQuery<{
    client: Client;
    brandingKit: BrandingKit | null;
    newsletters: Newsletter[];
  }>({
    queryKey: ["/api/clients", clientId],
    enabled: open && !!clientId,
  });

  const { data: subscriptions = [] } = useQuery<Subscription[]>({
    queryKey: ["/api/clients", clientId, "subscriptions"],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/subscriptions`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && !!clientId,
  });

  const { data: invoices = [] } = useQuery<Invoice[]>({
    queryKey: ["/api/clients", clientId, "invoices"],
    queryFn: async () => {
      const res = await fetch(`/api/clients/${clientId}/invoices`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: open && !!clientId,
  });

  const client = clientData?.client;
  const brandingKit = clientData?.brandingKit;
  const newsletters = clientData?.newsletters || [];

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[400px] sm:w-[480px] p-0">
        <SheetHeader className="p-4 border-b">
          <SheetTitle className="text-left">
            {isLoading ? <Skeleton className="h-6 w-32" /> : client?.name}
          </SheetTitle>
        </SheetHeader>

        {isLoading ? (
          <div className="p-4 space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : client ? (
          <ScrollArea className="h-[calc(100vh-80px)]">
            <div className="p-4 space-y-6">
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Mail className="w-4 h-4" />
                  <span>{client.primaryEmail}</span>
                </div>
                {client.phone && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Phone className="w-4 h-4" />
                    <span>{client.phone}</span>
                  </div>
                )}
                {(client.locationCity || client.locationRegion) && (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <MapPin className="w-4 h-4" />
                    <span>{[client.locationCity, client.locationRegion].filter(Boolean).join(", ")}</span>
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Calendar className="w-4 h-4" />
                  Subscriptions
                </h3>
                {subscriptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No subscriptions</p>
                ) : (
                  <div className="space-y-2">
                    {subscriptions.map((sub) => (
                      <div key={sub.id} className="p-3 rounded-md bg-muted/30 border">
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-medium text-sm capitalize">{sub.frequency}</span>
                          {getStatusBadge(sub.status)}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          ${Number(sub.amount || 0).toFixed(2)} / {sub.frequency}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <Palette className="w-4 h-4" />
                  Branding Kit
                </h3>
                {!brandingKit ? (
                  <p className="text-sm text-muted-foreground">No branding kit configured</p>
                ) : (
                  <div className="p-3 rounded-md bg-muted/30 border space-y-2">
                    {brandingKit.primaryColor && (
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-5 h-5 rounded border" 
                          style={{ backgroundColor: brandingKit.primaryColor }}
                        />
                        <span className="text-sm">Primary: {brandingKit.primaryColor}</span>
                      </div>
                    )}
                    {brandingKit.secondaryColor && (
                      <div className="flex items-center gap-2">
                        <div 
                          className="w-5 h-5 rounded border" 
                          style={{ backgroundColor: brandingKit.secondaryColor }}
                        />
                        <span className="text-sm">Secondary: {brandingKit.secondaryColor}</span>
                      </div>
                    )}
                    {brandingKit.companyName && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Company:</span> {brandingKit.companyName}
                      </div>
                    )}
                    {brandingKit.tone && (
                      <div className="text-sm">
                        <span className="text-muted-foreground">Tone:</span> {brandingKit.tone}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <CreditCard className="w-4 h-4" />
                  Invoices
                </h3>
                {invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No invoices</p>
                ) : (
                  <div className="space-y-2">
                    {invoices.slice(0, 5).map((invoice) => (
                      <div key={invoice.id} className="p-3 rounded-md bg-muted/30 border">
                        <div className="flex items-center justify-between">
                          <span className="font-medium text-sm">
                            ${Number(invoice.amount).toFixed(2)}
                          </span>
                          {getStatusBadge(invoice.status)}
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          {format(new Date(invoice.createdAt), "MMM d, yyyy")}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h3 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <FileText className="w-4 h-4" />
                  Newsletters
                </h3>
                {newsletters.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No newsletters</p>
                ) : (
                  <div className="space-y-2">
                    {newsletters.slice(0, 5).map((nl) => (
                      <Link key={nl.id} href={`/newsletters/${nl.id}`} onClick={onClose}>
                        <div className="p-3 rounded-md bg-muted/30 border hover-elevate cursor-pointer">
                          <div className="font-medium text-sm truncate">{nl.title}</div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {nl.expectedSendDate && format(new Date(nl.expectedSendDate), "MMM d, yyyy")}
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        ) : (
          <div className="p-4 text-center text-muted-foreground">
            Client not found
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
