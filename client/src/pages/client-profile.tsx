import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { RightPanel } from "@/components/RightPanel";
import { HTMLPreviewFrame } from "@/components/HTMLPreviewFrame";
import { CreateNewsletterDialog } from "@/components/CreateNewsletterDialog";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Plus,
  LogOut,
  User,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Send,
  Download,
  Copy,
  MoreHorizontal,
  Mail,
  Phone,
  MapPin,
  Palette,
  MessageSquare,
  Building,
  Calendar,
  FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Client, Newsletter, NewsletterVersion, NewsletterDocument, BrandingKit } from "@shared/schema";
import { format } from "date-fns";

interface ClientProfilePageProps {
  clientId: string;
}

export default function ClientProfilePage({ clientId }: ClientProfilePageProps) {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [selectedNewsletterId, setSelectedNewsletterId] = useState<string | null>(null);
  const [showCreateNewsletter, setShowCreateNewsletter] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);

  const { data: clientData, isLoading: loadingClient } = useQuery<{
    client: Client;
    brandingKit: BrandingKit | null;
    newsletters: Newsletter[];
  }>({
    queryKey: ["/api/clients", clientId],
  });

  const client = clientData?.client;
  const brandingKit = clientData?.brandingKit;
  const newsletters = clientData?.newsletters;

  const { data: newsletterData, isLoading: loadingNewsletter } = useQuery<{
    newsletter: Newsletter;
    document: NewsletterDocument;
    versions: NewsletterVersion[];
    html: string;
  }>({
    queryKey: ["/api/newsletters", selectedNewsletterId],
    enabled: !!selectedNewsletterId,
  });

  const createNewsletterMutation = useMutation({
    mutationFn: async (data: { expectedSendDate: string; importedHtml?: string }) => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/newsletters`, data);
      return res.json() as Promise<Newsletter>;
    },
    onSuccess: (data: Newsletter) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
      setSelectedNewsletterId(data.id);
      setShowCreateNewsletter(false);
      toast({ title: "Campaign created" });
    },
    onError: (error) => {
      toast({ title: "Failed to create campaign", description: error.message, variant: "destructive" });
    },
  });

  const updateHtmlMutation = useMutation({
    mutationFn: async (html: string) => {
      const res = await apiRequest("PATCH", `/api/newsletters/${selectedNewsletterId}`, { 
        documentJson: { html } 
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", selectedNewsletterId] });
    },
  });

  const aiCommandMutation = useMutation({
    mutationFn: async (command: string) => {
      const res = await apiRequest("POST", `/api/newsletters/${selectedNewsletterId}/ai-command`, {
        command,
      });
      return res.json() as Promise<{ type: string; message: string }>;
    },
    onSuccess: (response) => {
      if (response.type === "success") {
        queryClient.invalidateQueries({ queryKey: ["/api/newsletters", selectedNewsletterId] });
        toast({ title: "AI updated the newsletter" });
      } else {
        toast({ title: response.message, variant: "destructive" });
      }
    },
    onError: (error) => {
      toast({ title: "AI command failed", description: error.message, variant: "destructive" });
    },
  });

  const getClientLocation = () => {
    if (client?.locationCity && client?.locationRegion) {
      return `${client.locationCity}, ${client.locationRegion}`;
    }
    return client?.locationCity || client?.locationRegion || null;
  };

  const getPlanLabel = (frequency: string) => {
    return frequency === "weekly" ? "Established (Weekly)" : "Starter (Monthly)";
  };

  if (loadingClient) {
    return (
      <div className="flex h-screen w-full bg-background">
        <div className="w-72 border-r p-6">
          <Skeleton className="h-8 w-32 mb-6" />
          <Skeleton className="h-4 w-48 mb-3" />
          <Skeleton className="h-4 w-36" />
        </div>
        <div className="flex-1 flex items-center justify-center">
          <Skeleton className="h-96 w-full max-w-2xl" />
        </div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="flex h-screen w-full bg-background items-center justify-center">
        <div className="text-center">
          <h2 className="text-lg font-medium mb-2">Client not found</h2>
          <Button onClick={() => setLocation("/")}>Back to Clients</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen w-full bg-background">
      <div className="w-72 flex-shrink-0 border-r flex flex-col bg-sidebar/30 glass-surface">
        <div className="flex items-center gap-2 px-3 h-14 border-b">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back-to-clients"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="font-semibold truncate flex-1">{client.name}</span>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-3 space-y-2">
            <Collapsible open={contactOpen} onOpenChange={setContactOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between p-2 rounded-md text-sm font-medium hover-elevate" data-testid="toggle-contact">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Contact</span>
                  <ChevronRight className={`w-4 h-4 transition-transform ${contactOpen ? "rotate-90" : ""}`} />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-2 pt-2 pl-2">
                <div className="flex items-center gap-2 text-sm">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <span className="truncate">{client.primaryEmail}</span>
                </div>
                {client.phone && (
                  <div className="flex items-center gap-2 text-sm">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <span>{client.phone}</span>
                  </div>
                )}
                {getClientLocation() && (
                  <div className="flex items-center gap-2 text-sm">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <span>{getClientLocation()}</span>
                  </div>
                )}
                <div className="flex items-center justify-between text-sm pt-1">
                  <span className="text-muted-foreground">Plan</span>
                  <span>{getPlanLabel(client.newsletterFrequency)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant="secondary" className="text-xs capitalize">{client.subscriptionStatus}</Badge>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {brandingKit && (
              <Collapsible open={brandOpen} onOpenChange={setBrandOpen}>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between p-2 rounded-md text-sm font-medium hover-elevate" data-testid="toggle-brand">
                    <span className="text-xs uppercase tracking-wider text-muted-foreground">Brand DNA</span>
                    <ChevronRight className={`w-4 h-4 transition-transform ${brandOpen ? "rotate-90" : ""}`} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pt-2 pl-2">
                  {brandingKit.companyName && (
                    <div className="flex items-center gap-2 text-sm">
                      <Building className="w-4 h-4 text-muted-foreground" />
                      <span className="truncate">{brandingKit.companyName}</span>
                    </div>
                  )}
                  {brandingKit.primaryColor && (
                    <div className="flex items-center gap-2 text-sm">
                      <Palette className="w-4 h-4 text-muted-foreground" />
                      <div className="w-4 h-4 rounded border" style={{ backgroundColor: brandingKit.primaryColor }} />
                      <span className="font-mono text-xs">{brandingKit.primaryColor}</span>
                    </div>
                  )}
                  {brandingKit.tone && (
                    <div className="flex items-center gap-2 text-sm">
                      <MessageSquare className="w-4 h-4 text-muted-foreground" />
                      <span className="capitalize">{brandingKit.tone}</span>
                    </div>
                  )}
                </CollapsibleContent>
              </Collapsible>
            )}

            <div className="pt-2">
              <div className="flex items-center justify-between p-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">Campaigns</span>
                <Button variant="ghost" size="icon" onClick={() => setShowCreateNewsletter(true)} data-testid="button-new-campaign">
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="space-y-1">
                {newsletters?.length === 0 ? (
                  <div className="text-center py-6">
                    <FileText className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                    <p className="text-sm text-muted-foreground">No campaigns yet</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowCreateNewsletter(true)}>
                      Create First
                    </Button>
                  </div>
                ) : (
                  newsletters?.map((nl) => (
                    <div
                      key={nl.id}
                      onClick={() => setSelectedNewsletterId(nl.id)}
                      className={`p-2 rounded-md cursor-pointer transition-colors ${
                        nl.id === selectedNewsletterId ? "bg-primary/10 glow-green" : "hover-elevate"
                      }`}
                      data-testid={`button-campaign-${nl.id}`}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === "Enter" && setSelectedNewsletterId(nl.id)}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-medium text-sm truncate">{nl.title}</span>
                        <StatusPill status={nl.status} size="sm" />
                      </div>
                      {nl.expectedSendDate && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(nl.expectedSendDate), "MMM d")}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </ScrollArea>

        <div className="p-3 border-t">
          <Button className="w-full glow-green-hover" onClick={() => setShowCreateNewsletter(true)} data-testid="button-new-campaign-bottom">
            <Plus className="w-4 h-4 mr-2" />
            New Campaign
          </Button>
        </div>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between gap-4 px-4 h-14 border-b bg-background/50 glass-surface">
          <div className="flex items-center gap-3 min-w-0">
            {selectedNewsletterId && newsletterData?.newsletter ? (
              <>
                <span className="font-medium truncate">{newsletterData.newsletter.title}</span>
                <StatusPill status={newsletterData.newsletter.status} size="sm" />
              </>
            ) : (
              <span className="text-muted-foreground">Select a campaign</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {selectedNewsletterId && (
              <>
                <Button variant="outline" size="sm" data-testid="button-preview">
                  Preview
                </Button>
                <Button variant="default" size="sm" data-testid="button-export-html">
                  <Download className="w-4 h-4 mr-2" />
                  Export
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" data-testid="button-more-actions">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem data-testid="menu-send-review">
                      <Send className="w-4 h-4 mr-2" />
                      Send for Review
                    </DropdownMenuItem>
                    <DropdownMenuItem data-testid="menu-copy-html">
                      <Copy className="w-4 h-4 mr-2" />
                      Copy HTML
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="gap-2" data-testid="button-user-menu">
                  <User className="w-4 h-4" />
                  <span className="hidden sm:inline">{user?.name}</span>
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled>
                  <span className="text-xs text-muted-foreground">{user?.email}</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={logout} data-testid="button-logout">
                  <LogOut className="w-4 h-4 mr-2" />
                  Sign Out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>

        {!selectedNewsletterId ? (
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="text-center max-w-md">
              <FileText className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
              <h2 className="text-lg font-medium mb-2">Select a Campaign</h2>
              <p className="text-sm text-muted-foreground mb-4">
                Choose a newsletter campaign from the sidebar or create a new one.
              </p>
              <Button onClick={() => setShowCreateNewsletter(true)} className="glow-green-hover" data-testid="button-create-campaign-empty">
                <Plus className="w-4 h-4 mr-2" />
                New Campaign
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0">
            <HTMLPreviewFrame
              html={newsletterData?.html || ""}
              isLoading={loadingNewsletter}
              title={newsletterData?.newsletter?.title}
              onHtmlChange={(html) => updateHtmlMutation.mutate(html)}
              onAiCommand={(cmd) => aiCommandMutation.mutate(cmd)}
              isAiProcessing={aiCommandMutation.isPending}
            />
          </div>
        )}
      </div>

      {selectedNewsletterId && newsletterData && (
        <div className="w-64 flex-shrink-0">
          <RightPanel
            versions={newsletterData.versions || []}
            currentVersionId={newsletterData.newsletter?.currentVersionId || null}
            status={newsletterData.newsletter?.status || "not_started"}
            onRestoreVersion={(versionId) => {
              toast({ title: "Restore version", description: `Would restore ${versionId}` });
            }}
          />
        </div>
      )}

      <CreateNewsletterDialog
        open={showCreateNewsletter}
        onClose={() => setShowCreateNewsletter(false)}
        onSubmit={async (data) => {
          await createNewsletterMutation.mutateAsync(data);
        }}
        isSubmitting={createNewsletterMutation.isPending}
        clientName={client.name}
      />
    </div>
  );
}
