import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TopNav } from "@/components/TopNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Palette, Plus, Trash2 } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import type { BrandingKit, Client } from "@shared/schema";

type BrandingKitWithClient = BrandingKit & { client: Client };

function formatPlatform(platform: string | null) {
  switch (platform) {
    case "mailchimp": return "Mailchimp";
    case "constant_contact": return "Constant Contact";
    case "other": return "Other";
    default: return platform || "-";
  }
}

export default function BrandingKitsPage() {
  const { toast } = useToast();

  const { data: brandingKits = [], isLoading } = useQuery<BrandingKitWithClient[]>({
    queryKey: ["/api/branding-kits"],
  });

  const { data: clients = [] } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editKit, setEditKit] = useState<BrandingKitWithClient | null>(null);

  const [formClientId, setFormClientId] = useState("");
  const [formPrimaryColor, setFormPrimaryColor] = useState("#1a5f4a");
  const [formCompanyName, setFormCompanyName] = useState("");
  const [formTone, setFormTone] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formPlatform, setFormPlatform] = useState("mailchimp");

  function resetForm() {
    setFormClientId("");
    setFormPrimaryColor("#1a5f4a");
    setFormCompanyName("");
    setFormTone("");
    setFormTitle("");
    setFormPlatform("mailchimp");
  }

  function openCreate() {
    resetForm();
    setCreateOpen(true);
  }

  function openEdit(kit: BrandingKitWithClient) {
    setFormClientId(kit.clientId);
    setFormPrimaryColor(kit.primaryColor || "#1a5f4a");
    setFormCompanyName(kit.companyName || "");
    setFormTone(kit.tone || "");
    setFormTitle(kit.title || "");
    setFormPlatform(kit.platform || "mailchimp");
    setEditKit(kit);
  }

  const createMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/branding-kits", {
        clientId: formClientId,
        primaryColor: formPrimaryColor,
        companyName: formCompanyName || null,
        tone: formTone || null,
        title: formTitle || null,
        platform: formPlatform,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/branding-kits"] });
      toast({ title: "Branding kit created" });
      setCreateOpen(false);
      resetForm();
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create", description: error.message, variant: "destructive" });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async () => {
      if (!editKit) return;
      await apiRequest("PATCH", `/api/branding-kits/${editKit.id}`, {
        primaryColor: formPrimaryColor,
        companyName: formCompanyName || null,
        tone: formTone || null,
        title: formTitle || null,
        platform: formPlatform,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/branding-kits"] });
      toast({ title: "Branding kit updated" });
      setEditKit(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!editKit) return;
      await apiRequest("DELETE", `/api/branding-kits/${editKit.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/branding-kits"] });
      toast({ title: "Branding kit deleted" });
      setEditKit(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete", description: error.message, variant: "destructive" });
    },
  });

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      <div className="flex h-[calc(100vh-56px)]">
        <div className="flex-1 p-6 overflow-auto">
          <div className="flex items-center justify-between gap-2 mb-6">
            <h1 className="text-xl font-semibold">Branding Kits</h1>
            <Button onClick={openCreate} data-testid="button-new-branding-kit">
              <Plus className="w-4 h-4 mr-1.5" />
              New Branding Kit
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <p className="text-muted-foreground">Loading branding kits...</p>
            </div>
          ) : brandingKits.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Palette className="w-12 h-12 text-muted-foreground/40 mb-4" />
              <p className="text-muted-foreground">No branding kits yet</p>
              <p className="text-sm text-muted-foreground mt-1">Branding kits will appear here when added to clients</p>
            </div>
          ) : (
            <div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">Client</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">Color</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">Company</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">Tone</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground">Platform</th>
                  </tr>
                </thead>
                <tbody>
                  {brandingKits.map((kit) => (
                    <tr
                      key={kit.id}
                      className="border-b border-border/50 cursor-pointer transition-colors hover:bg-muted/20"
                      onClick={() => openEdit(kit)}
                      data-testid={`branding-kit-row-${kit.id}`}
                    >
                      <td className="p-3 font-medium">{kit.client.name}</td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <span
                            className="inline-block w-4 h-4 rounded-md border border-border/50"
                            style={{ backgroundColor: kit.primaryColor || "#ccc" }}
                            data-testid={`color-swatch-${kit.id}`}
                          />
                          <span className="text-xs text-muted-foreground font-mono">{kit.primaryColor || "-"}</span>
                        </div>
                      </td>
                      <td className="p-3 text-muted-foreground">{kit.companyName || "-"}</td>
                      <td className="p-3 text-muted-foreground">{kit.tone || "-"}</td>
                      <td className="p-3 text-muted-foreground">{formatPlatform(kit.platform)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Branding Kit</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <Label>Client</Label>
              <Select value={formClientId} onValueChange={setFormClientId}>
                <SelectTrigger data-testid="select-create-client">
                  <SelectValue placeholder="Select a client" />
                </SelectTrigger>
                <SelectContent>
                  {clients.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <Label>Primary Color</Label>
              <div className="flex items-center gap-2">
                <Input
                  type="color"
                  value={formPrimaryColor}
                  onChange={(e) => setFormPrimaryColor(e.target.value)}
                  className="w-12 p-1"
                  data-testid="input-create-color"
                />
                <Input
                  value={formPrimaryColor}
                  onChange={(e) => setFormPrimaryColor(e.target.value)}
                  className="flex-1"
                  data-testid="input-create-color-text"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Company Name</Label>
              <Input
                value={formCompanyName}
                onChange={(e) => setFormCompanyName(e.target.value)}
                placeholder="Company name"
                data-testid="input-create-company"
              />
            </div>
            <div className="space-y-1">
              <Label>Title</Label>
              <Input
                value={formTitle}
                onChange={(e) => setFormTitle(e.target.value)}
                placeholder="Kit title"
                data-testid="input-create-title"
              />
            </div>
            <div className="space-y-1">
              <Label>Tone</Label>
              <Input
                value={formTone}
                onChange={(e) => setFormTone(e.target.value)}
                placeholder="e.g. Professional, Friendly"
                data-testid="input-create-tone"
              />
            </div>
            <div className="space-y-1">
              <Label>Platform</Label>
              <Select value={formPlatform} onValueChange={setFormPlatform}>
                <SelectTrigger data-testid="select-create-platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mailchimp">Mailchimp</SelectItem>
                  <SelectItem value="constant_contact">Constant Contact</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-create-kit">
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!formClientId || createMutation.isPending}
              data-testid="button-confirm-create-kit"
            >
              {createMutation.isPending ? "Creating..." : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!editKit} onOpenChange={(open) => { if (!open) setEditKit(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit Branding Kit</DialogTitle>
          </DialogHeader>
          {editKit && (
            <div className="space-y-4 py-2">
              <div className="space-y-1">
                <Label className="text-muted-foreground">Client</Label>
                <p className="text-sm font-medium">{editKit.client.name}</p>
              </div>
              <div className="space-y-1">
                <Label>Primary Color</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={formPrimaryColor}
                    onChange={(e) => setFormPrimaryColor(e.target.value)}
                    className="w-12 p-1"
                    data-testid="input-edit-color"
                  />
                  <Input
                    value={formPrimaryColor}
                    onChange={(e) => setFormPrimaryColor(e.target.value)}
                    className="flex-1"
                    data-testid="input-edit-color-text"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>Company Name</Label>
                <Input
                  value={formCompanyName}
                  onChange={(e) => setFormCompanyName(e.target.value)}
                  placeholder="Company name"
                  data-testid="input-edit-company"
                />
              </div>
              <div className="space-y-1">
                <Label>Title</Label>
                <Input
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Kit title"
                  data-testid="input-edit-title"
                />
              </div>
              <div className="space-y-1">
                <Label>Tone</Label>
                <Input
                  value={formTone}
                  onChange={(e) => setFormTone(e.target.value)}
                  placeholder="e.g. Professional, Friendly"
                  data-testid="input-edit-tone"
                />
              </div>
              <div className="space-y-1">
                <Label>Platform</Label>
                <Select value={formPlatform} onValueChange={setFormPlatform}>
                  <SelectTrigger data-testid="select-edit-platform">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mailchimp">Mailchimp</SelectItem>
                    <SelectItem value="constant_contact">Constant Contact</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
          <DialogFooter className="flex items-center justify-between gap-2">
            <Button
              variant="destructive"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
              data-testid="button-delete-branding-kit"
            >
              <Trash2 className="w-4 h-4 mr-1.5" />
              {deleteMutation.isPending ? "Deleting..." : "Delete"}
            </Button>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="outline" onClick={() => setEditKit(null)} data-testid="button-cancel-edit-kit">
                Cancel
              </Button>
              <Button
                onClick={() => updateMutation.mutate()}
                disabled={updateMutation.isPending}
                data-testid="button-save-branding-kit"
              >
                {updateMutation.isPending ? "Saving..." : "Save"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
