import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useAuth } from "@/contexts/AuthContext";
import { ClientSidebar } from "@/components/ClientSidebar";
import { RightPanel } from "@/components/RightPanel";
import { HTMLPreviewFrame } from "@/components/HTMLPreviewFrame";
import { NewsletterCard } from "@/components/NewsletterCard";
import { ModuleEditor } from "@/components/ModuleEditor";
import { CreateClientDialog } from "@/components/CreateClientDialog";
import { CreateNewsletterDialog } from "@/components/CreateNewsletterDialog";
import { AICommandBox } from "@/components/AICommandBox";
import { ThemeToggle } from "@/components/ThemeToggle";
import { StatusPill } from "@/components/StatusPill";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
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
  FileText,
  Send,
  Download,
  Copy,
  MoreHorizontal,
  ArrowRight,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Client, Newsletter, NewsletterModule, NewsletterVersion, AiDraft, TasksFlags, AIDraftSource, NewsletterDocument } from "@shared/schema";

export default function DashboardPage() {
  const { user, logout } = useAuth();
  const { toast } = useToast();

  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [selectedNewsletterId, setSelectedNewsletterId] = useState<string | null>(null);
  const [selectedModuleId, setSelectedModuleId] = useState<string | null>(null);
  const [editingModule, setEditingModule] = useState<NewsletterModule | null>(null);
  const [showCreateClient, setShowCreateClient] = useState(false);
  const [showCreateNewsletter, setShowCreateNewsletter] = useState(false);
  const [showAICommand, setShowAICommand] = useState(false);
  const [aiResponse, setAiResponse] = useState<{ type: "success" | "clarification" | "error"; message: string; options?: string[] } | null>(null);

  const { data: clients } = useQuery<Client[]>({ queryKey: ["/api/clients"] });
  const selectedClient = clients?.find((c) => c.id === selectedClientId);

  const { data: newsletters, isLoading: loadingNewsletters } = useQuery<Newsletter[]>({
    queryKey: ["/api/clients", selectedClientId, "newsletters"],
    enabled: !!selectedClientId,
  });

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

  const createClientMutation = useMutation({
    mutationFn: (data: Partial<Client>) => apiRequest("POST", "/api/clients", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients"] });
      setShowCreateClient(false);
      toast({ title: "Client created" });
    },
    onError: (error) => {
      toast({ title: "Failed to create client", description: error.message, variant: "destructive" });
    },
  });

  const createNewsletterMutation = useMutation({
    mutationFn: async (data: { title: string; periodStart: string }) => {
      const res = await apiRequest("POST", `/api/clients/${selectedClientId}/newsletters`, data);
      return res.json() as Promise<Newsletter>;
    },
    onSuccess: (data: Newsletter) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", selectedClientId, "newsletters"] });
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
    onSuccess: (response: { type: string; message: string; options?: string[] }) => {
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

  return (
    <div className="flex h-screen w-full bg-background">
      <div className="w-72 flex-shrink-0">
        <ClientSidebar
          selectedClientId={selectedClientId}
          onSelectClient={(id) => {
            setSelectedClientId(id);
            setSelectedNewsletterId(null);
          }}
          onCreateClient={() => setShowCreateClient(true)}
        />
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between gap-4 px-4 h-14 border-b bg-background">
          <div className="flex items-center gap-3 min-w-0">
            {selectedClient ? (
              <span className="font-semibold truncate">{selectedClient.name}</span>
            ) : (
              <span className="text-muted-foreground truncate">Select a client</span>
            )}
          </div>
          <div className="flex items-center gap-2">
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

        <div className="flex-1 flex min-h-0">
          {!selectedClientId ? (
            <div className="flex-1 flex items-center justify-center p-8">
              <div className="text-center max-w-md">
                <FileText className="w-12 h-12 mx-auto text-muted-foreground/50 mb-4" />
                <h2 className="text-lg font-medium mb-2">Select a Client</h2>
                <p className="text-sm text-muted-foreground mb-4">
                  Choose a client from the sidebar to view and manage their newsletters.
                </p>
                <Button onClick={() => setShowCreateClient(true)} data-testid="button-create-first-client">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Your First Client
                </Button>
              </div>
            </div>
          ) : !selectedNewsletterId ? (
            <div className="flex-1 flex flex-col p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-lg font-semibold">{selectedClient?.name}</h2>
                  <p className="text-sm text-muted-foreground">
                    {newsletters?.length || 0} newsletter{newsletters?.length !== 1 ? "s" : ""}
                  </p>
                </div>
                <Button onClick={() => setShowCreateNewsletter(true)} data-testid="button-create-newsletter">
                  <Plus className="w-4 h-4 mr-2" />
                  New Newsletter
                </Button>
              </div>
              <ScrollArea className="flex-1">
                {loadingNewsletters ? (
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <Skeleton key={i} className="h-20 w-full" />
                    ))}
                  </div>
                ) : newsletters?.length === 0 ? (
                  <div className="text-center py-12">
                    <FileText className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-sm text-muted-foreground">No newsletters yet</p>
                    <Button
                      variant="outline"
                      className="mt-4"
                      onClick={() => setShowCreateNewsletter(true)}
                    >
                      Create First Newsletter
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {newsletters?.map((nl) => (
                      <NewsletterCard
                        key={nl.id}
                        newsletter={nl}
                        isSelected={nl.id === selectedNewsletterId}
                        onClick={() => setSelectedNewsletterId(nl.id)}
                      />
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          ) : (
            <div className="flex-1 flex flex-col min-w-0">
              <div className="flex items-center justify-between gap-4 px-4 py-3 border-b bg-card">
                <div className="flex items-center gap-3 min-w-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedNewsletterId(null)}
                  >
                    <ArrowRight className="w-4 h-4 rotate-180 mr-1" />
                    Back
                  </Button>
                  <div className="min-w-0">
                    <h3 className="font-medium text-sm truncate">
                      {newsletterData?.newsletter?.title}
                    </h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      <StatusPill
                        status={newsletterData?.newsletter?.status || "not_started"}
                        size="sm"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
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
                      <DropdownMenuItem>
                        <Send className="w-4 h-4 mr-2" />
                        Send for Review
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Download className="w-4 h-4 mr-2" />
                        Export HTML
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <Copy className="w-4 h-4 mr-2" />
                        Copy HTML
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <HTMLPreviewFrame
                  html={newsletterData?.html || ""}
                  isLoading={loadingNewsletter}
                  title={newsletterData?.newsletter?.title}
                />
              </div>
            </div>
          )}
        </div>
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

      <CreateClientDialog
        open={showCreateClient}
        onClose={() => setShowCreateClient(false)}
        onSubmit={async (data) => {
          await createClientMutation.mutateAsync(data);
        }}
        isSubmitting={createClientMutation.isPending}
      />

      <CreateNewsletterDialog
        open={showCreateNewsletter}
        onClose={() => setShowCreateNewsletter(false)}
        onSubmit={async (data) => {
          await createNewsletterMutation.mutateAsync(data);
        }}
        isSubmitting={createNewsletterMutation.isPending}
        clientName={selectedClient?.name}
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
