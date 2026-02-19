import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Mail, Phone, MapPin, Calendar, CreditCard, Palette, FileText, Pencil, Check, X, ExternalLink } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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

const SUBSCRIPTION_FREQUENCY_OPTIONS = [
  { value: "weekly", label: "Weekly" },
  { value: "biweekly", label: "Biweekly" },
  { value: "monthly", label: "Monthly" },
];

const SUBSCRIPTION_STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "past_due", label: "Past Due" },
  { value: "canceled", label: "Canceled" },
];

const INVOICE_STATUS_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "paid", label: "Paid" },
  { value: "failed", label: "Failed" },
  { value: "refunded", label: "Refunded" },
];

export function ClientSidePanel({ clientId, open, onClose }: ClientSidePanelProps) {
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isEditing, setIsEditing] = useState(false);
  const [editingSubscriptionId, setEditingSubscriptionId] = useState<string | null>(null);
  const [editingInvoiceId, setEditingInvoiceId] = useState<string | null>(null);
  const [subscriptionDrafts, setSubscriptionDrafts] = useState<
    Record<
      string,
      {
        amount: string;
        frequency: Subscription["frequency"];
        status: Subscription["status"];
        startDate: string;
        endDate: string;
      }
    >
  >({});
  const [invoiceDrafts, setInvoiceDrafts] = useState<
    Record<
      string,
      {
        amount: string;
        status: Invoice["status"];
        currency: string;
      }
    >
  >({});
  const [form, setForm] = useState({
    primaryEmail: "",
    phone: "",
    locationCity: "",
    locationRegion: "",
    website: "",
    facebook: "",
    instagram: "",
    linkedin: "",
    youtube: "",
    primaryColor: "",
    secondaryColor: "",
  });

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
  const invoicesBySubscription = invoices.reduce<Record<string, Invoice[]>>((acc, invoice) => {
    if (!invoice.subscriptionId) return acc;
    if (!acc[invoice.subscriptionId]) {
      acc[invoice.subscriptionId] = [];
    }
    acc[invoice.subscriptionId].push(invoice);
    return acc;
  }, {});
  const newslettersBySubscription = newsletters.reduce<Record<string, Newsletter[]>>((acc, newsletter) => {
    if (!newsletter.subscriptionId) return acc;
    if (!acc[newsletter.subscriptionId]) {
      acc[newsletter.subscriptionId] = [];
    }
    acc[newsletter.subscriptionId].push(newsletter);
    return acc;
  }, {});

  useEffect(() => {
    if (!open || !client) return;
    setForm({
      primaryEmail: client.primaryEmail || "",
      phone: client.phone || "",
      locationCity: client.locationCity || "",
      locationRegion: client.locationRegion || "",
      website: brandingKit?.website || "",
      facebook: brandingKit?.facebook || "",
      instagram: brandingKit?.instagram || "",
      linkedin: brandingKit?.linkedin || "",
      youtube: brandingKit?.youtube || "",
      primaryColor: brandingKit?.primaryColor || "#1a5f4a",
      secondaryColor: brandingKit?.secondaryColor || "#000000",
    });
    setIsEditing(false);
    setEditingSubscriptionId(null);
    setEditingInvoiceId(null);
    setSubscriptionDrafts({});
    setInvoiceDrafts({});
  }, [open, client, brandingKit]);

  const updateClientMutation = useMutation({
    mutationFn: async () => {
      if (!client) return;
      await apiRequest("PATCH", `/api/clients/${client.id}`, {
        primaryEmail: form.primaryEmail.trim(),
        phone: form.phone.trim() || null,
        locationCity: form.locationCity.trim() || null,
        locationRegion: form.locationRegion.trim() || null,
      });
      await apiRequest("PUT", `/api/clients/${client.id}/branding-kit`, {
        website: form.website.trim() || null,
        facebook: form.facebook.trim() || null,
        instagram: form.instagram.trim() || null,
        linkedin: form.linkedin.trim() || null,
        youtube: form.youtube.trim() || null,
        primaryColor: form.primaryColor.trim() || null,
        secondaryColor: form.secondaryColor.trim() || null,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
      setIsEditing(false);
      toast({ title: "Client card updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save client card", description: error.message, variant: "destructive" });
    },
  });

  const updateSubscriptionInlineMutation = useMutation({
    mutationFn: async (payload: {
      id: string;
      amount: string;
      frequency: Subscription["frequency"];
      status: Subscription["status"];
      startDate: string;
      endDate: string;
    }) => {
      await apiRequest("PATCH", `/api/subscriptions/${payload.id}`, {
        amount: payload.amount,
        frequency: payload.frequency,
        status: payload.status,
        startDate: payload.startDate || null,
        endDate: payload.endDate || null,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] }),
      ]);
      setEditingSubscriptionId(null);
      toast({ title: "Subscription updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update subscription", description: error.message, variant: "destructive" });
    },
  });

  const updateInvoiceInlineMutation = useMutation({
    mutationFn: async (payload: { id: string; amount: string; status: Invoice["status"]; currency: string }) => {
      await apiRequest("PATCH", `/api/invoices/${payload.id}`, {
        amount: payload.amount,
        status: payload.status,
        currency: payload.currency,
        paidAt: payload.status === "paid" ? new Date() : null,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] }),
      ]);
      setEditingInvoiceId(null);
      toast({ title: "Invoice updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update invoice", description: error.message, variant: "destructive" });
    },
  });

  const beginEditSubscription = (subscription: Subscription) => {
    if (!isEditing) return;
    setSubscriptionDrafts((prev) => ({
      ...prev,
      [subscription.id]: {
        amount: String(subscription.amount || ""),
        frequency: subscription.frequency,
        status: subscription.status,
        startDate: subscription.startDate || "",
        endDate: subscription.endDate || "",
      },
    }));
    setEditingSubscriptionId(subscription.id);
  };

  const beginEditInvoice = (invoice: Invoice) => {
    if (!isEditing) return;
    setInvoiceDrafts((prev) => ({
      ...prev,
      [invoice.id]: {
        amount: String(invoice.amount || ""),
        status: invoice.status,
        currency: invoice.currency || "USD",
      },
    }));
    setEditingInvoiceId(invoice.id);
  };

  const openWorkspacePage = (path: string) => {
    if (typeof window !== "undefined") {
      const opened = window.open(path, "_blank", "noopener,noreferrer");
      if (opened) return;
    }
    setLocation(path);
  };

  const manageButtonClass =
    "h-7 px-2 text-xs transition-opacity md:opacity-0 md:pointer-events-none md:group-hover/section:opacity-100 md:group-hover/section:pointer-events-auto";

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
    >
      <SheetContent className="w-[94vw] max-w-[420px] sm:w-[480px] p-0 [&>button]:hidden">
        <SheetHeader className="p-4 border-b">
          <div className="flex items-center justify-between gap-2">
            <SheetTitle className="text-left">
              {isLoading ? <Skeleton className="h-6 w-32" /> : client?.name}
            </SheetTitle>
            <div className="flex items-center gap-1">
              {!isLoading && client && (
                <>
                  {!isEditing ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setIsEditing(true)}
                      data-testid="button-edit-client-card"
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => updateClientMutation.mutate()}
                        disabled={updateClientMutation.isPending}
                        data-testid="button-save-client-card"
                      >
                        <Check className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => setIsEditing(false)}
                        data-testid="button-cancel-client-card"
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    </>
                  )}
                </>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={onClose}
                data-testid="button-close-client-card"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </SheetHeader>

        {isLoading ? (
          <div className="p-4 space-y-4">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : client ? (
          <ScrollArea className="h-[calc(100vh-80px)]">
            <div className="p-4 space-y-6">
              {isEditing ? (
                <div className="space-y-3 p-3 rounded-md border bg-muted/20">
                  <div className="text-xs font-medium text-muted-foreground">Quick Edit</div>
                  <div className="grid grid-cols-1 gap-2">
                    <Input
                      value={form.primaryEmail}
                      onChange={(e) => setForm((prev) => ({ ...prev, primaryEmail: e.target.value }))}
                      placeholder="Primary email"
                      className="h-8 text-sm"
                    />
                    <Input
                      value={form.phone}
                      onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                      placeholder="Phone"
                      className="h-8 text-sm"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={form.locationCity}
                        onChange={(e) => setForm((prev) => ({ ...prev, locationCity: e.target.value }))}
                        placeholder="City"
                        className="h-8 text-sm"
                      />
                      <Input
                        value={form.locationRegion}
                        onChange={(e) => setForm((prev) => ({ ...prev, locationRegion: e.target.value }))}
                        placeholder="Region"
                        className="h-8 text-sm"
                      />
                    </div>
                    <Input
                      value={form.website}
                      onChange={(e) => setForm((prev) => ({ ...prev, website: e.target.value }))}
                      placeholder="Website URL"
                      className="h-8 text-sm"
                    />
                    <Input
                      value={form.facebook}
                      onChange={(e) => setForm((prev) => ({ ...prev, facebook: e.target.value }))}
                      placeholder="Facebook URL"
                      className="h-8 text-sm"
                    />
                    <Input
                      value={form.instagram}
                      onChange={(e) => setForm((prev) => ({ ...prev, instagram: e.target.value }))}
                      placeholder="Instagram URL"
                      className="h-8 text-sm"
                    />
                    <Input
                      value={form.linkedin}
                      onChange={(e) => setForm((prev) => ({ ...prev, linkedin: e.target.value }))}
                      placeholder="LinkedIn URL"
                      className="h-8 text-sm"
                    />
                    <Input
                      value={form.youtube}
                      onChange={(e) => setForm((prev) => ({ ...prev, youtube: e.target.value }))}
                      placeholder="YouTube URL"
                      className="h-8 text-sm"
                    />
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={form.primaryColor}
                        onChange={(e) => setForm((prev) => ({ ...prev, primaryColor: e.target.value }))}
                        placeholder="Primary color"
                        className="h-8 text-sm"
                      />
                      <Input
                        value={form.secondaryColor}
                        onChange={(e) => setForm((prev) => ({ ...prev, secondaryColor: e.target.value }))}
                        placeholder="Secondary color"
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                </div>
              ) : null}

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
                <div className="group/section flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Subscriptions
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={manageButtonClass}
                    onClick={() => openWorkspacePage("/subscriptions")}
                    data-testid="button-manage-subscriptions-client-card"
                  >
                    Manage
                    <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                </div>
                {subscriptions.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No subscriptions</p>
                ) : (
                  <div className="space-y-2">
                    {subscriptions.map((sub) => (
                      <div key={sub.id} className="p-3 rounded-md bg-muted/30 border">
                        {editingSubscriptionId === sub.id ? (
                          <div className="space-y-2">
                            <div className="grid grid-cols-2 gap-2">
                              <Input
                                type="number"
                                step="0.01"
                                value={subscriptionDrafts[sub.id]?.amount ?? String(sub.amount || "")}
                                onChange={(e) =>
                                  setSubscriptionDrafts((prev) => ({
                                    ...prev,
                                    [sub.id]: {
                                      ...(prev[sub.id] || {
                                        amount: String(sub.amount || ""),
                                        frequency: sub.frequency,
                                        status: sub.status,
                                        startDate: sub.startDate || "",
                                        endDate: sub.endDate || "",
                                      }),
                                      amount: e.target.value,
                                    },
                                  }))
                                }
                                className="h-8 text-xs"
                                placeholder="Amount"
                              />
                              <select
                                className="h-8 rounded-md border bg-background px-2 text-xs"
                                value={subscriptionDrafts[sub.id]?.frequency ?? sub.frequency}
                                onChange={(e) =>
                                  setSubscriptionDrafts((prev) => ({
                                    ...prev,
                                    [sub.id]: {
                                      ...(prev[sub.id] || {
                                        amount: String(sub.amount || ""),
                                        frequency: sub.frequency,
                                        status: sub.status,
                                        startDate: sub.startDate || "",
                                        endDate: sub.endDate || "",
                                      }),
                                      frequency: e.target.value as Subscription["frequency"],
                                    },
                                  }))
                                }
                              >
                                {SUBSCRIPTION_FREQUENCY_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <select
                                className="h-8 rounded-md border bg-background px-2 text-xs"
                                value={subscriptionDrafts[sub.id]?.status ?? sub.status}
                                onChange={(e) =>
                                  setSubscriptionDrafts((prev) => ({
                                    ...prev,
                                    [sub.id]: {
                                      ...(prev[sub.id] || {
                                        amount: String(sub.amount || ""),
                                        frequency: sub.frequency,
                                        status: sub.status,
                                        startDate: sub.startDate || "",
                                        endDate: sub.endDate || "",
                                      }),
                                      status: e.target.value as Subscription["status"],
                                    },
                                  }))
                                }
                              >
                                {SUBSCRIPTION_STATUS_OPTIONS.map((option) => (
                                  <option key={option.value} value={option.value}>
                                    {option.label}
                                  </option>
                                ))}
                              </select>
                              <Input
                                type="date"
                                value={subscriptionDrafts[sub.id]?.startDate ?? sub.startDate ?? ""}
                                onChange={(e) =>
                                  setSubscriptionDrafts((prev) => ({
                                    ...prev,
                                    [sub.id]: {
                                      ...(prev[sub.id] || {
                                        amount: String(sub.amount || ""),
                                        frequency: sub.frequency,
                                        status: sub.status,
                                        startDate: sub.startDate || "",
                                        endDate: sub.endDate || "",
                                      }),
                                      startDate: e.target.value,
                                    },
                                  }))
                                }
                                className="h-8 text-xs"
                              />
                            </div>
                            <Input
                              type="date"
                              value={subscriptionDrafts[sub.id]?.endDate ?? sub.endDate ?? ""}
                              onChange={(e) =>
                                setSubscriptionDrafts((prev) => ({
                                  ...prev,
                                  [sub.id]: {
                                    ...(prev[sub.id] || {
                                      amount: String(sub.amount || ""),
                                      frequency: sub.frequency,
                                      status: sub.status,
                                      startDate: sub.startDate || "",
                                      endDate: sub.endDate || "",
                                    }),
                                    endDate: e.target.value,
                                  },
                                }))
                              }
                              className="h-8 text-xs"
                            />
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() =>
                                  updateSubscriptionInlineMutation.mutate({
                                    id: sub.id,
                                    amount: subscriptionDrafts[sub.id]?.amount ?? String(sub.amount || ""),
                                    frequency: subscriptionDrafts[sub.id]?.frequency ?? sub.frequency,
                                    status: subscriptionDrafts[sub.id]?.status ?? sub.status,
                                    startDate: subscriptionDrafts[sub.id]?.startDate ?? sub.startDate ?? "",
                                    endDate: subscriptionDrafts[sub.id]?.endDate ?? sub.endDate ?? "",
                                  })
                                }
                                disabled={updateSubscriptionInlineMutation.isPending}
                                data-testid={`button-save-subscription-inline-${sub.id}`}
                              >
                                <Check className="w-3.5 h-3.5 mr-1" />
                                Save
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setEditingSubscriptionId(null)}
                                data-testid={`button-cancel-subscription-inline-${sub.id}`}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-medium text-sm capitalize">{sub.frequency}</span>
                              {getStatusBadge(sub.status)}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              ${Number(sub.amount || 0).toFixed(2)} / {sub.frequency}
                            </div>
                            <div className="mt-2 flex justify-end">
                              {isEditing && (
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => beginEditSubscription(sub)}
                                  data-testid={`button-edit-subscription-inline-${sub.id}`}
                                >
                                  Edit
                                </Button>
                              )}
                            </div>
                            <div className="mt-2 space-y-1">
                              <div className="text-[11px] text-muted-foreground">
                                Orders linked: {(invoicesBySubscription[sub.id] || []).length}
                              </div>
                              {(invoicesBySubscription[sub.id] || []).slice(0, 3).map((invoice) => (
                                <div key={invoice.id} className="text-[11px] text-muted-foreground">
                                  #{invoice.id.slice(0, 8)} · {invoice.status}
                                </div>
                              ))}
                              <div className="text-[11px] text-muted-foreground">
                                Newsletters linked: {(newslettersBySubscription[sub.id] || []).length}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="group/section flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Palette className="w-4 h-4" />
                    Branding Kit
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={manageButtonClass}
                    onClick={() => openWorkspacePage("/branding-kits")}
                    data-testid="button-manage-branding-client-card"
                  >
                    Manage
                    <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                </div>
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
                <div className="group/section flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <CreditCard className="w-4 h-4" />
                    Invoices
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={manageButtonClass}
                    onClick={() => openWorkspacePage("/orders")}
                    data-testid="button-manage-orders-client-card"
                  >
                    Manage
                    <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                </div>
                {invoices.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No invoices</p>
                ) : (
                  <div className="space-y-2">
                    {invoices.slice(0, 5).map((invoice) => (
                      <div key={invoice.id} className="p-3 rounded-md bg-muted/30 border">
                        {editingInvoiceId === invoice.id ? (
                          <div className="space-y-2">
                            <div className="grid grid-cols-3 gap-2">
                              <Input
                                type="number"
                                step="0.01"
                                value={invoiceDrafts[invoice.id]?.amount ?? String(invoice.amount)}
                                onChange={(e) =>
                                  setInvoiceDrafts((prev) => ({
                                    ...prev,
                                    [invoice.id]: {
                                      ...(prev[invoice.id] || {
                                        amount: String(invoice.amount),
                                        status: invoice.status,
                                        currency: invoice.currency || "USD",
                                      }),
                                      amount: e.target.value,
                                    },
                                  }))
                                }
                                className="h-8 text-xs col-span-2"
                                placeholder="Amount"
                              />
                              <Input
                                value={invoiceDrafts[invoice.id]?.currency ?? invoice.currency}
                                onChange={(e) =>
                                  setInvoiceDrafts((prev) => ({
                                    ...prev,
                                    [invoice.id]: {
                                      ...(prev[invoice.id] || {
                                        amount: String(invoice.amount),
                                        status: invoice.status,
                                        currency: invoice.currency || "USD",
                                      }),
                                      currency: e.target.value.toUpperCase(),
                                    },
                                  }))
                                }
                                className="h-8 text-xs"
                                placeholder="USD"
                              />
                            </div>
                            <select
                              className="h-8 w-full rounded-md border bg-background px-2 text-xs"
                              value={invoiceDrafts[invoice.id]?.status ?? invoice.status}
                              onChange={(e) =>
                                setInvoiceDrafts((prev) => ({
                                  ...prev,
                                  [invoice.id]: {
                                    ...(prev[invoice.id] || {
                                      amount: String(invoice.amount),
                                      status: invoice.status,
                                      currency: invoice.currency || "USD",
                                    }),
                                    status: e.target.value as Invoice["status"],
                                  },
                                }))
                              }
                            >
                              {INVOICE_STATUS_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() =>
                                  updateInvoiceInlineMutation.mutate({
                                    id: invoice.id,
                                    amount: invoiceDrafts[invoice.id]?.amount ?? String(invoice.amount),
                                    status: invoiceDrafts[invoice.id]?.status ?? invoice.status,
                                    currency: invoiceDrafts[invoice.id]?.currency || invoice.currency || "USD",
                                  })
                                }
                                disabled={updateInvoiceInlineMutation.isPending}
                                data-testid={`button-save-invoice-inline-${invoice.id}`}
                              >
                                <Check className="w-3.5 h-3.5 mr-1" />
                                Save
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs"
                                onClick={() => setEditingInvoiceId(null)}
                                data-testid={`button-cancel-invoice-inline-${invoice.id}`}
                              >
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="flex items-center justify-between">
                              <span className="font-medium text-sm">
                                ${Number(invoice.amount).toFixed(2)}
                              </span>
                              {getStatusBadge(invoice.status)}
                            </div>
                            <div className="text-xs text-muted-foreground mt-1">
                              {format(new Date(invoice.createdAt), "MMM d, yyyy")}
                            </div>
                            {isEditing && (
                              <div className="mt-2 flex justify-end">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-xs"
                                  onClick={() => beginEditInvoice(invoice)}
                                  data-testid={`button-edit-invoice-inline-${invoice.id}`}
                                >
                                  Edit
                                </Button>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="group/section flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Newsletters
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={manageButtonClass}
                    onClick={() => openWorkspacePage("/newsletters")}
                    data-testid="button-manage-newsletters-client-card"
                  >
                    Manage
                    <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                </div>
                {newsletters.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No newsletters</p>
                ) : (
                  <div className="space-y-2">
                    {newsletters.slice(0, 5).map((nl) => (
                      <Link key={nl.id} href={`/newsletters/${nl.id}`}>
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

              <div>
                <div className="group/section flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium">Audience (Contacts + Segments)</h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className={manageButtonClass}
                    onClick={() => openWorkspacePage(`/audience?clientId=${client.id}`)}
                    data-testid="button-open-audience-workspace-client-card"
                  >
                    Open Workspace
                    <ExternalLink className="w-3 h-3 ml-1" />
                  </Button>
                </div>
                <div className="rounded-md border bg-muted/20 p-3 text-sm text-muted-foreground">
                  Audience tools open in Audience Manager.
                </div>
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
