import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TopNav } from "@/components/TopNav";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Receipt, X, Mail, Calendar, DollarSign, CreditCard } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import type { Invoice, Client, Newsletter } from "@shared/schema";
import { Button } from "@/components/ui/button";

type InvoiceWithRelations = Invoice & { 
  client: Client;
  newsletters?: Newsletter[];
};

function getStatusBadge(status: string) {
  switch (status) {
    case "paid":
      return <Badge className="bg-green-500/10 text-green-600 dark:text-green-400">Paid</Badge>;
    case "pending":
      return <Badge className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">Pending</Badge>;
    case "failed":
      return <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">Failed</Badge>;
    case "refunded":
      return <Badge className="bg-muted text-muted-foreground">Refunded</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function InvoicePreview({ invoice, onClose }: { invoice: InvoiceWithRelations; onClose: () => void }) {
  return (
    <div className="w-96 border-l bg-background h-full overflow-y-auto">
      <div className="p-4 border-b flex items-center justify-between sticky top-0 bg-background">
        <div className="flex items-center gap-2">
          {getStatusBadge(invoice.status)}
          <h3 className="font-semibold">{invoice.client.name}</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} data-testid="button-close-preview">
          <X className="w-4 h-4" />
        </Button>
      </div>
      
      <div className="p-4 space-y-4">
        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">ID</span>
            <span className="font-mono text-xs">{invoice.id.slice(0, 8)}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Date</span>
            <span>{format(new Date(invoice.createdAt), "MMM d, yyyy 'at' h:mm a")}</span>
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-medium">{invoice.currency} ${Number(invoice.amount).toFixed(2)}</span>
          </div>
          {invoice.transactionFee && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Transaction Fee</span>
              <span>{invoice.currency} ${Number(invoice.transactionFee).toFixed(2)}</span>
            </div>
          )}
          {invoice.stripePaymentId && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Stripe ID</span>
              <span className="font-mono text-xs">{invoice.stripePaymentId}</span>
            </div>
          )}
        </div>
        
        <div className="pt-4 border-t">
          <h4 className="text-sm font-medium mb-2">Client</h4>
          <Link href={`/clients/${invoice.clientId}`}>
            <Card className="p-3 hover-elevate cursor-pointer">
              <p className="font-medium">{invoice.client.name}</p>
              <p className="text-sm text-muted-foreground">{invoice.client.primaryEmail}</p>
            </Card>
          </Link>
        </div>
        
        {invoice.newsletters && invoice.newsletters.length > 0 && (
          <div className="pt-4 border-t">
            <h4 className="text-sm font-medium mb-2">Linked Newsletter</h4>
            {invoice.newsletters.map((newsletter) => (
              <Link key={newsletter.id} href={`/clients/${invoice.clientId}?newsletter=${newsletter.id}`}>
                <Card className="p-3 hover-elevate cursor-pointer">
                  <p className="font-medium">{newsletter.title}</p>
                  <p className="text-sm text-muted-foreground">
                    Due: {format(new Date(newsletter.expectedSendDate), "MMM d, yyyy")}
                  </p>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function InvoicesPage() {
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceWithRelations | null>(null);

  const { data: invoices = [], isLoading } = useQuery<InvoiceWithRelations[]>({
    queryKey: ["/api/invoices"],
  });

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      
      <div className="flex h-[calc(100vh-56px)]">
        <div className="flex-1 p-6 overflow-auto">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-2xl font-semibold">Invoices</h1>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">Loading invoices...</p>
            </div>
          ) : invoices.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Receipt className="w-12 h-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground">No invoices yet</p>
              <p className="text-sm text-muted-foreground mt-1">Invoices will appear here when payments are received</p>
            </div>
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-muted/50">
                    <th className="text-left p-3 font-medium">ID</th>
                    <th className="text-left p-3 font-medium">Client</th>
                    <th className="text-left p-3 font-medium">Date</th>
                    <th className="text-left p-3 font-medium">Email</th>
                    <th className="text-right p-3 font-medium">Amount</th>
                    <th className="text-right p-3 font-medium">Fee</th>
                    <th className="text-left p-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((invoice) => (
                    <tr 
                      key={invoice.id} 
                      className={`border-t cursor-pointer transition-colors ${selectedInvoice?.id === invoice.id ? "bg-muted" : "hover:bg-muted/30"}`}
                      onClick={() => setSelectedInvoice(invoice)}
                      data-testid={`invoice-row-${invoice.id}`}
                    >
                      <td className="p-3 font-mono text-xs">{invoice.id.slice(0, 8)}</td>
                      <td className="p-3 font-medium">{invoice.client.name}</td>
                      <td className="p-3 text-muted-foreground">
                        {format(new Date(invoice.createdAt), "MMM d, yyyy")}
                      </td>
                      <td className="p-3 text-muted-foreground">{invoice.client.primaryEmail}</td>
                      <td className="p-3 text-right">{invoice.currency} ${Number(invoice.amount).toFixed(2)}</td>
                      <td className="p-3 text-right text-muted-foreground">
                        {invoice.transactionFee ? `$${Number(invoice.transactionFee).toFixed(2)}` : "-"}
                      </td>
                      <td className="p-3">{getStatusBadge(invoice.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        
        {selectedInvoice && (
          <InvoicePreview invoice={selectedInvoice} onClose={() => setSelectedInvoice(null)} />
        )}
      </div>
    </div>
  );
}
