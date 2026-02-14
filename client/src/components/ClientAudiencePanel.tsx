import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload } from "lucide-react";
import type { Contact, ContactSegment } from "@shared/schema";

interface ClientAudiencePanelProps {
  clientId: string;
}

export function ClientAudiencePanel({ clientId }: ClientAudiencePanelProps) {
  const { toast } = useToast();
  const [csvContent, setCsvContent] = useState("");

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/clients", clientId, "contacts"],
  });

  const { data: segments = [] } = useQuery<ContactSegment[]>({
    queryKey: ["/api/clients", clientId, "segments"],
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/contacts/import-csv`, {
        csvContent,
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "segments"] });
      setCsvContent("");
      const importedCount = data?.summary?.importedCount || 0;
      const updatedCount = data?.summary?.updatedCount || 0;
      toast({
        title: "Contacts imported",
        description: `${importedCount} new, ${updatedCount} updated`,
      });
    },
    onError: (error) => {
      toast({
        title: "CSV import failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const topContacts = useMemo(() => contacts.slice(0, 10), [contacts]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground font-medium">Audience</span>
        <span className="text-xs text-muted-foreground">{contacts.length} contacts</span>
      </div>

      <Textarea
        value={csvContent}
        onChange={(event) => setCsvContent(event.target.value)}
        placeholder={"Paste CSV with at least an email column.\nemail,first_name,last_name,tags"}
        className="min-h-[120px] text-xs font-mono"
        data-testid="textarea-audience-csv"
      />
      <Button
        size="sm"
        className="w-full"
        onClick={() => importMutation.mutate()}
        disabled={importMutation.isPending || !csvContent.trim()}
        data-testid="button-import-csv-audience"
      >
        {importMutation.isPending ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <Upload className="w-4 h-4 mr-2" />
        )}
        Import CSV
      </Button>

      <div className="space-y-2">
        <div className="text-xs text-muted-foreground font-medium">Segments</div>
        <div className="flex flex-wrap gap-1">
          {segments.length === 0 && <span className="text-xs text-muted-foreground">No segments yet</span>}
          {segments.map((segment) => (
            <Badge key={segment.id} variant="secondary" className="text-xs">
              {segment.name}
            </Badge>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground font-medium">Recent Contacts</div>
        {topContacts.length === 0 && <div className="text-xs text-muted-foreground">No contacts imported yet</div>}
        {topContacts.map((contact) => (
          <div key={contact.id} className="rounded border p-2">
            <div className="text-sm">{contact.firstName || contact.lastName ? `${contact.firstName || ""} ${contact.lastName || ""}`.trim() : contact.email}</div>
            <div className="text-xs text-muted-foreground">{contact.email}</div>
            <div className="mt-1 flex flex-wrap gap-1">
              {(contact.tags || ["all"]).map((tag) => (
                <Badge key={`${contact.id}-${tag}`} variant="outline" className="text-[10px]">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
