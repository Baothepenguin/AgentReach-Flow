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
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Send,
  Download,
  Copy,
  Share2,
  ExternalLink,
  Mail,
  Phone,
  MapPin,
  Palette,
  MessageSquare,
  Building,
  Calendar,
  FileText,
  Folder,
  FolderOpen,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import type { Client, Newsletter, NewsletterVersion, NewsletterDocument, BrandingKit, Project } from "@shared/schema";
import { format } from "date-fns";

interface ClientProfilePageProps {
  clientId: string;
}

export default function ClientProfilePage({ clientId }: ClientProfilePageProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();

  const [selectedNewsletterId, setSelectedNewsletterId] = useState<string | null>(null);
  const [showCreateNewsletter, setShowCreateNewsletter] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [brandOpen, setBrandOpen] = useState(false);
  const [projectsOpen, setProjectsOpen] = useState(true);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());

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

  const { data: projects } = useQuery<Project[]>({
    queryKey: ["/api/clients", clientId, "projects"],
    enabled: !!clientId,
  });

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

  const restoreVersionMutation = useMutation({
    mutationFn: async (versionId: string) => {
      const res = await apiRequest("POST", `/api/newsletters/${selectedNewsletterId}/restore/${versionId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters", selectedNewsletterId] });
      toast({ title: "Version restored" });
    },
    onError: (error) => {
      toast({ title: "Failed to restore version", description: error.message, variant: "destructive" });
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

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  const getNewslettersForProject = (projectId: string) => {
    return newsletters?.filter((nl) => nl.projectId === projectId) || [];
  };

  const getUnassignedNewsletters = () => {
    return newsletters?.filter((nl) => !nl.projectId) || [];
  };

  const handleExportHtml = async () => {
    if (!selectedNewsletterId) return;
    try {
      const response = await fetch(`/api/newsletters/${selectedNewsletterId}/export`, {
        credentials: "include",
      });
      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${newsletterData?.newsletter?.title || "newsletter"}.html`;
        a.click();
        URL.revokeObjectURL(url);
        toast({ title: "HTML exported" });
      }
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  const handleCopyHtml = async () => {
    if (!newsletterData?.html) return;
    try {
      await navigator.clipboard.writeText(newsletterData.html);
      toast({ title: "HTML copied to clipboard" });
    } catch {
      toast({ title: "Failed to copy", variant: "destructive" });
    }
  };

  const handlePreview = () => {
    if (!newsletterData?.html) return;
    const win = window.open("", "_blank");
    if (win) {
      win.document.write(newsletterData.html);
      win.document.close();
    }
  };

  const handleSendForReview = async () => {
    if (!selectedNewsletterId) return;
    try {
      const res = await apiRequest("POST", `/api/newsletters/${selectedNewsletterId}/send-for-review`);
      const data = await res.json();
      if (data.reviewUrl) {
        await navigator.clipboard.writeText(data.reviewUrl);
        toast({ title: "Review link copied to clipboard" });
      }
    } catch {
      toast({ title: "Failed to generate review link", variant: "destructive" });
    }
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

            <Collapsible open={projectsOpen} onOpenChange={setProjectsOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between p-2 rounded-md text-sm font-medium hover-elevate" data-testid="toggle-projects">
                  <span className="text-xs uppercase tracking-wider text-muted-foreground">Projects & Campaigns</span>
                  <div className="flex items-center gap-1">
                    <Button 
                      variant="ghost" 
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowCreateNewsletter(true);
                      }} 
                      data-testid="button-new-campaign"
                    >
                      <Plus className="w-3 h-3" />
                    </Button>
                    <ChevronRight className={`w-4 h-4 transition-transform ${projectsOpen ? "rotate-90" : ""}`} />
                  </div>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="space-y-1 pt-1">
                {(!newsletters || newsletters.length === 0) && (!projects || projects.length === 0) ? (
                  <div className="text-center py-6">
                    <FileText className="w-8 h-8 mx-auto text-muted-foreground/50 mb-2" />
                    <p className="text-sm text-muted-foreground">No campaigns yet</p>
                    <Button variant="outline" size="sm" className="mt-3" onClick={() => setShowCreateNewsletter(true)}>
                      Create First
                    </Button>
                  </div>
                ) : (
                  <>
                    {projects?.map((project) => {
                      const projectNewsletters = getNewslettersForProject(project.id);
                      const isExpanded = expandedProjects.has(project.id);
                      return (
                        <div key={project.id} className="space-y-0.5">
                          <div
                            onClick={() => toggleProject(project.id)}
                            className="flex items-center gap-2 p-2 rounded-md cursor-pointer hover-elevate"
                            data-testid={`project-${project.id}`}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => e.key === "Enter" && toggleProject(project.id)}
                          >
                            {isExpanded ? (
                              <FolderOpen className="w-4 h-4 text-muted-foreground" />
                            ) : (
                              <Folder className="w-4 h-4 text-muted-foreground" />
                            )}
                            <span className="font-medium text-sm truncate flex-1">{project.name}</span>
                            <Badge variant="secondary" className="text-xs">{projectNewsletters.length}</Badge>
                          </div>
                          {isExpanded && projectNewsletters.length > 0 && (
                            <div className="pl-6 space-y-0.5">
                              {projectNewsletters.map((nl) => (
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
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {getUnassignedNewsletters().length > 0 && (
                      <div className="space-y-0.5">
                        {projects && projects.length > 0 && (
                          <div className="flex items-center gap-2 p-2 text-xs text-muted-foreground">
                            <span>Unassigned</span>
                          </div>
                        )}
                        {getUnassignedNewsletters().map((nl) => (
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
                        ))}
                      </div>
                    )}
                  </>
                )}
              </CollapsibleContent>
            </Collapsible>
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
        <header className="flex items-center justify-end gap-2 px-4 h-12 border-b bg-background/50 glass-surface">
          {selectedNewsletterId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="default" size="sm" className="glow-green-hover" data-testid="button-share">
                  <Share2 className="w-4 h-4 mr-2" />
                  Share
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handlePreview} data-testid="menu-preview">
                  <ExternalLink className="w-4 h-4 mr-2" />
                  Preview
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportHtml} data-testid="menu-export">
                  <Download className="w-4 h-4 mr-2" />
                  Export HTML
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleCopyHtml} data-testid="menu-copy-html">
                  <Copy className="w-4 h-4 mr-2" />
                  Copy HTML
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleSendForReview} data-testid="menu-send-review">
                  <Send className="w-4 h-4 mr-2" />
                  Send for Review
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
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
            onRestoreVersion={(versionId) => restoreVersionMutation.mutate(versionId)}
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
