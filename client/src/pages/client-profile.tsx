import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { RightPanel } from "@/components/RightPanel";
import { HTMLPreviewFrame } from "@/components/HTMLPreviewFrame";
import { NewsletterCard } from "@/components/NewsletterCard";
import { ModuleEditor } from "@/components/ModuleEditor";
import { CreateNewsletterDialog } from "@/components/CreateNewsletterDialog";
import { AICommandBox } from "@/components/AICommandBox";
import { ThemeToggle } from "@/components/ThemeToggle";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sparkles,
  Plus,
  LogOut,
  User,
  ChevronDown,
  ChevronLeft,
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
  DollarSign,
  FileText,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Client, Newsletter, NewsletterModule, NewsletterVersion, AiDraft, TasksFlags, AIDraftSource, NewsletterDocument, BrandingKit } from "@shared/schema";
import { format } from "date-fns";

interface ClientProfilePageProps {
  clientId: string;
}

export default function ClientProfilePage({ clientId }: ClientProfilePageProps) {
  const { user, logout } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [selectedNewsletterId, setSelectedNewsletterId] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [editingModule, setEditingModule] = useState<NewsletterModule | null>(null);
  const [showCreateNewsletter, setShowCreateNewsletter] = useState(false);
  const [showAICommand, setShowAICommand] = useState(false);
  const [aiResponse, setAiResponse] = useState<{ type: "success" | "clarification" | "error"; message: string; options?: string[] } | null>(null);

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
    flags: TasksFlags[];
    aiDrafts: AiDraft[];
    html: string;
  }>({
    queryKey: ["/api/newsletters", selectedNewsletterId],
    enabled: !!selectedNewsletterId,
  });

  const createNewsletterMutation = useMutation({
    mutationFn: async (data: { expectedSendDate: string }) => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/newsletters`, data);
      return res.json() as Promise<Newsletter>;
    },
    onSuccess: (data: Newsletter) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId] });
      setSelectedNewsletterId(data.id);
      setShowCreateNewsletter(false);
      toast({ title: "Newsletter created" });
    },
    onError: (error) => {
      toast({ title: "Failed to create newsletter", description: error.message, variant: "destructive" });
    },
  });

  const updateModuleMutation = useMutation({
    mutationFn: (module: NewsletterModule) =>
      apiRequest("PATCH", `/api/newsletters/${selectedNewsletterId}/modules/${module.id}`, module),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", selectedNewsletterId] });
      setEditingModule(null);
      toast({ title: "Module updated" });
    },
  });

  const aiCommandMutation = useMutation({
    mutationFn: async (command: string) => {
      const res = await apiRequest("POST", `/api/newsletters/${selectedNewsletterId}/ai-command`, {
        command,
        selectedModuleId,
      });
      return res.json() as Promise<{ type: string; message: string; options?: string[] }>;
    },
    onSuccess: (response) => {
      if (response.type === "success") {
        queryClient.invalidateQueries({ queryKey: ["/api/newsletters", selectedNewsletterId] });
        setAiResponse({ type: "success", message: response.message });
      } else if (response.type === "clarification") {
        setAiResponse({ type: "clarification", message: response.message, options: response.options });
      } else {
        setAiResponse({ type: "error", message: response.message });
      }
    },
    onError: (error) => {
      setAiResponse({ type: "error", message: error.message });
    },
  });

  const sources: AIDraftSource[] = newsletterData?.aiDrafts?.flatMap((d) => d.sourcesJson || []) || [];

  const getClientLocation = () => {
    if (client?.locationCity && client?.locationRegion) {
      return `${client.locationCity}, ${client.locationRegion}`;
    }
    return client?.locationCity || client?.locationRegion || null;
  };

  if (loadingClient) {
    return (
      <div className="flex h-screen w-full bg-background">
        <div className="w-80 border-r p-6">
          <Skeleton className="h-8 w-32 mb-6" />
          <Skeleton className="h-4 w-48 mb-3" />
          <Skeleton className="h-4 w-36 mb-3" />
          <Skeleton className="h-4 w-40" />
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
      <div className="w-80 flex-shrink-0 border-r flex flex-col">
        <div className="flex items-center gap-2 px-4 h-14 border-b">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back-to-clients"
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
          <span className="font-semibold truncate">{client.name}</span>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4 space-y-6">
            <div className="space-y-3">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Contact
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  <Mail className="w-4 h-4 text-muted-foreground" />
                  <span className="truncate">{client.primaryEmail}</span>
                </div>
                {client.phone && (
                  <div className="flex items-center gap-2">
                    <Phone className="w-4 h-4 text-muted-foreground" />
                    <span>{client.phone}</span>
                  </div>
                )}
                {getClientLocation() && (
                  <div className="flex items-center gap-2">
                    <MapPin className="w-4 h-4 text-muted-foreground" />
                    <span>{getClientLocation()}</span>
                  </div>
                )}
              </div>
            </div>

            <Separator />

            <div className="space-y-3">
              <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Subscription
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Status</span>
                  <Badge variant="secondary" className="capitalize text-xs">
                    {client.subscriptionStatus}
                  </Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-muted-foreground">Frequency</span>
                  <span className="capitalize">{client.newsletterFrequency}</span>
                </div>
              </div>
            </div>

            {brandingKit && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Brand DNA
                  </h3>
                  <div className="space-y-2 text-sm">
                    {brandingKit.companyName && (
                      <div className="flex items-center gap-2">
                        <Building className="w-4 h-4 text-muted-foreground" />
                        <span className="truncate">{brandingKit.companyName}</span>
                      </div>
                    )}
                    {brandingKit.primaryColor && (
                      <div className="flex items-center gap-2">
                        <Palette className="w-4 h-4 text-muted-foreground" />
                        <div
                          className="w-4 h-4 rounded border"
                          style={{ backgroundColor: brandingKit.primaryColor }}
                        />
                        <span className="font-mono text-xs">{brandingKit.primaryColor}</span>
                      </div>
                    )}
                    {brandingKit.tone && (
                      <div className="flex items-start gap-2">
                        <MessageSquare className="w-4 h-4 text-muted-foreground mt-0.5" />
                        <span className="capitalize">{brandingKit.tone}</span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            <Separator />

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Campaigns
                </h3>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowCreateNewsletter(true)}
                  data-testid="button-new-campaign"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              <div className="space-y-2">
                {newsletters?.length === 0 ? (
                  <div className="text-center py-6">
                    <FileText className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                    <p className="text-sm text-muted-foreground">No campaigns yet</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => setShowCreateNewsletter(true)}
                    >
                      Create First
                    </Button>
                  </div>
                ) : (
                  newsletters?.map((nl) => (
                    <div
                      key={nl.id}
                      onClick={() => setSelectedNewsletterId(nl.id)}
                      className={`p-3 rounded-lg cursor-pointer transition-colors ${
                        nl.id === selectedNewsletterId
                          ? "bg-primary/10"
                          : "hover-elevate"
                      }`}
                      data-testid={`button-campaign-${nl.id}`}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && setSelectedNewsletterId(nl.id)}
                    >
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="font-medium text-sm truncate">{nl.title}</span>
                        <StatusPill status={nl.status} size="sm" />
                      </div>
                      {nl.expectedSendDate && (
                        <div className="flex items-center gap-1 text-xs text-muted-foreground">
                          <Calendar className="w-3 h-3" />
                          {format(new Date(nl.expectedSendDate), "MMM d, yyyy")}
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between gap-4 px-4 h-14 border-b bg-background">
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
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAICommand(true)}
                  data-testid="button-ai-command"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  AI Command
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm">
                      <MoreHorizontal className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem data-testid="menu-send-review">
                      <Send className="w-4 h-4 mr-2" />
                      Send for Review
                    </DropdownMenuItem>
                    <DropdownMenuItem data-testid="menu-export-html">
                      <Download className="w-4 h-4 mr-2" />
                      Export HTML
                    </DropdownMenuItem>
                    <DropdownMenuItem data-testid="menu-copy-html">
                      <Copy className="w-4 h-4 mr-2" />
                      Copy HTML
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
            <ThemeToggle />
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
              <Button onClick={() => setShowCreateNewsletter(true)} data-testid="button-create-campaign-empty">
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
            />
          </div>
        )}
      </div>

      {selectedNewsletterId && newsletterData && (
        <div className="w-80 flex-shrink-0">
          <RightPanel
            modules={newsletterData.document?.modules || []}
            sources={sources}
            flags={newsletterData.flags || []}
            versions={newsletterData.versions || []}
            aiDrafts={newsletterData.aiDrafts || []}
            currentVersionId={newsletterData.newsletter?.currentVersionId}
            selectedModuleId={selectedModuleId}
            onSelectModule={setSelectedModuleId}
            onEditModule={(id) => {
              const mod = newsletterData.document?.modules.find((m) => m.id === id);
              if (mod) setEditingModule(mod);
            }}
            onDeleteModule={(id) => {
              toast({ title: "Delete module", description: `Would delete ${id}` });
            }}
            onReorderModules={() => {}}
            onAddModule={() => {
              toast({ title: "Add module", description: "Coming soon" });
            }}
            onRestoreVersion={(versionId) => {
              toast({ title: "Restore version", description: `Would restore ${versionId}` });
            }}
            onResolveFlag={(flagId) => {
              toast({ title: "Resolve flag", description: `Would resolve ${flagId}` });
            }}
            onApplyAIDraft={(draftId) => {
              toast({ title: "Apply draft", description: `Would apply ${draftId}` });
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

      <ModuleEditor
        module={editingModule}
        open={!!editingModule}
        onClose={() => setEditingModule(null)}
        onSave={(mod) => updateModuleMutation.mutate(mod)}
      />

      <AICommandBox
        open={showAICommand}
        onOpenChange={setShowAICommand}
        onSubmit={async (cmd) => {
          setAiResponse(null);
          await aiCommandMutation.mutateAsync(cmd);
        }}
        selectedModuleId={selectedModuleId}
        isProcessing={aiCommandMutation.isPending}
        response={aiResponse}
      />
    </div>
  );
}
