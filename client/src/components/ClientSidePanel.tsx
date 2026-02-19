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
import { ClientAudiencePanel } from "@/components/ClientAudiencePanel";

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
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const [isEditing, setIsEditing] = useState(false);
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

  return (
    <Sheet open={open} onOpenChange={onClose}>
      <SheetContent className="w-[400px] sm:w-[480px] p-0 [&>button]:hidden">
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
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Subscriptions
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setLocation("/subscriptions")}
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
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <Palette className="w-4 h-4" />
                    Branding Kit
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setLocation("/branding-kits")}
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
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <CreditCard className="w-4 h-4" />
                    Invoices
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setLocation("/orders")}
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
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-medium flex items-center gap-2">
                    <FileText className="w-4 h-4" />
                    Newsletters
                  </h3>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => setLocation("/newsletters")}
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

              <div>
                <h3 className="text-sm font-medium mb-3">Audience (Contacts + Segments)</h3>
                <ClientAudiencePanel clientId={client.id} />
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
