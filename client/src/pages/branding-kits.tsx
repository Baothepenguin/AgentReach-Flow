import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { TopNav } from "@/components/TopNav";
import { Palette } from "lucide-react";
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
  const [, setLocation] = useLocation();

  const { data: brandingKits = [], isLoading } = useQuery<BrandingKitWithClient[]>({
    queryKey: ["/api/branding-kits"],
  });

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      <div className="flex h-[calc(100vh-56px)]">
        <div className="flex-1 p-6 overflow-auto">
          <div className="flex items-center justify-between gap-2 mb-6">
            <h1 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Branding Kits</h1>
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
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Client</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Color</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Company</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Tone</th>
                    <th className="text-left p-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">Platform</th>
                  </tr>
                </thead>
                <tbody>
                  {brandingKits.map((kit) => (
                    <tr
                      key={kit.id}
                      className="border-b border-border/50 cursor-pointer transition-colors hover:bg-muted/20"
                      onClick={() => setLocation(`/clients?id=${kit.client.id}`)}
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
    </div>
  );
}
