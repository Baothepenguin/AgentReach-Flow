import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useLocation } from "wouter";
import { TopNav } from "@/components/TopNav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { NEWSLETTER_TEMPLATES, type NewsletterTemplateId } from "@/lib/newsletterTemplates";
import type { Newsletter } from "@shared/schema";

type DiyNewsletter = Newsletter;

export default function DiyNewslettersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, setLocation] = useLocation();
  const clientId = (user as any)?.diyClientId as string | undefined;
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState<NewsletterTemplateId>(NEWSLETTER_TEMPLATES[0].id);

  const { data: newsletters = [], isLoading } = useQuery<DiyNewsletter[]>({
    queryKey: ["/api/clients", clientId, "newsletters"],
    enabled: !!clientId,
    queryFn: async () => {
      const response = await fetch(`/api/clients/${clientId}/newsletters`, { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const sorted = useMemo(
    () =>
      [...newsletters].sort(
        (a, b) => new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
      ),
    [newsletters]
  );
  const hasPrevious = sorted.length > 0;

  const createMutation = useMutation({
    mutationFn: async (args: { importedHtml?: string; templateId?: string }) => {
      if (!clientId) throw new Error("DIY workspace missing");
      const res = await apiRequest("POST", `/api/clients/${clientId}/newsletters`, args);
      return res.json();
    },
    onSuccess: async (created: DiyNewsletter) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "newsletters"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
      setCreateOpen(false);
      toast({ title: "Newsletter created" });
      if (created?.id) setLocation(`/newsletters/${created.id}`);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create newsletter", description: error.message, variant: "destructive" });
    },
  });

  const createFromTemplate = () => {
    const selected = NEWSLETTER_TEMPLATES.find((item) => item.id === selectedTemplateId);
    createMutation.mutate({
      templateId: selected?.id || selectedTemplateId,
      importedHtml: selected?.html || NEWSLETTER_TEMPLATES[0].html,
    });
  };

  const copyPrevious = () => {
    createMutation.mutate({});
  };

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-5xl px-6 py-8 space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold">Newsletters</h1>
            <p className="text-sm text-muted-foreground mt-1">Create, edit, and send your campaigns with Simple Mode.</p>
          </div>
          <Button onClick={() => setCreateOpen(true)} data-testid="button-open-diy-template-picker">
            {sorted.length === 0 ? "Make your first one" : "New newsletter"}
          </Button>
        </div>

        {isLoading ? (
          <Card>
            <CardContent className="py-8 text-sm text-muted-foreground">Loading newsletters...</CardContent>
          </Card>
        ) : sorted.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Make your first newsletter</CardTitle>
              <CardDescription>Choose a style template to start the premium setup flow.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={() => setCreateOpen(true)} data-testid="button-create-first-newsletter">
                Choose template style
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {sorted.map((item) => (
              <button
                key={item.id}
                onClick={() => setLocation(`/newsletters/${item.id}`)}
                className="text-left rounded-2xl border border-border/60 p-4 hover:bg-muted/20 transition-colors"
                data-testid={`diy-newsletter-card-${item.id}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="font-medium truncate">{item.title}</div>
                  <Badge variant="outline" className="capitalize">
                    {item.status.replace("_", " ")}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {item.expectedSendDate ? format(new Date(item.expectedSendDate), "MMM d, yyyy") : "No send date"}
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>Choose your email template style</DialogTitle>
            <DialogDescription>Pick a city style to launch with a premium-looking first issue.</DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[50vh] overflow-y-auto">
            {NEWSLETTER_TEMPLATES.map((template) => {
              const selected = selectedTemplateId === template.id;
              return (
                <button
                  key={template.id}
                  className={`rounded-2xl border p-4 text-left transition-colors ${
                    selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/20"
                  }`}
                  onClick={() => setSelectedTemplateId(template.id)}
                  data-testid={`diy-template-${template.id}`}
                >
                  <div className="text-sm font-semibold">{template.name}</div>
                  <div className="text-xs text-muted-foreground mt-1">{template.tagline}</div>
                </button>
              );
            })}
          </div>

          <DialogFooter className="flex items-center justify-between gap-2 sm:justify-between">
            <div>
              {hasPrevious ? (
                <Button variant="outline" onClick={copyPrevious} disabled={createMutation.isPending} data-testid="button-copy-previous-newsletter">
                  Copy previous newsletter
                </Button>
              ) : null}
            </div>
            <Button onClick={createFromTemplate} disabled={createMutation.isPending} data-testid="button-create-from-template">
              {createMutation.isPending ? "Creating..." : "Start with selected template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
