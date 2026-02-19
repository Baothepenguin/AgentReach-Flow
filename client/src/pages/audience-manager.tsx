import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";
import { TopNav } from "@/components/TopNav";
import { ClientSidePanel } from "@/components/ClientSidePanel";
import { ClientAudiencePanel } from "@/components/ClientAudiencePanel";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search } from "lucide-react";
import type { Client, Contact } from "@shared/schema";

export default function AudienceManagerPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [previewClientId, setPreviewClientId] = useState<string | null>(null);
  const [, setLocation] = useLocation();
  const searchString = useSearch();

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  useEffect(() => {
    if (!clients.length) return;
    const params = new URLSearchParams(searchString);
    const queryClientId = params.get("clientId");
    if (queryClientId && clients.some((client) => client.id === queryClientId)) {
      if (selectedClientId !== queryClientId) {
        setSelectedClientId(queryClientId);
      }
      return;
    }
    if (!selectedClientId || !clients.some((client) => client.id === selectedClientId)) {
      setSelectedClientId(clients[0].id);
    }
  }, [clients, searchString, selectedClientId]);

  const selectedClient = useMemo(
    () => clients.find((client) => client.id === selectedClientId) || null,
    [clients, selectedClientId]
  );

  const filteredClients = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (!normalized) return clients;
    return clients.filter((client) => {
      return (
        client.name.toLowerCase().includes(normalized) ||
        client.primaryEmail.toLowerCase().includes(normalized) ||
        (client.locationCity || "").toLowerCase().includes(normalized) ||
        (client.locationRegion || "").toLowerCase().includes(normalized)
      );
    });
  }, [clients, searchQuery]);

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/clients", selectedClientId, "contacts"],
    enabled: !!selectedClientId,
  });

  const activeContacts = useMemo(() => contacts.filter((contact) => contact.isActive).length, [contacts]);
  const unsubscribedContacts = Math.max(0, contacts.length - activeContacts);

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      <div className="px-8 py-6">
        <div className="mb-5">
          <h1 className="text-xl font-semibold">Audience Manager</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5">
          <section className="rounded-lg border bg-background p-3 h-[calc(100vh-180px)] overflow-hidden">
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Search clients..."
                  className="h-8 text-xs pl-9"
                  data-testid="input-search-audience-clients"
                />
              </div>
              <div className="text-[11px] text-muted-foreground">
                {filteredClients.length} of {clients.length} clients
              </div>
            </div>

            <div className="mt-3 space-y-1.5 overflow-y-auto h-[calc(100%-66px)] pr-1">
              {isLoading ? (
                <div className="text-sm text-muted-foreground py-6 text-center">Loading clients...</div>
              ) : filteredClients.length === 0 ? (
                <div className="text-sm text-muted-foreground py-6 text-center">No matching clients</div>
              ) : (
                filteredClients.map((client) => {
                  const isSelected = selectedClientId === client.id;
                  return (
                    <button
                      key={client.id}
                      type="button"
                      className={`w-full rounded-md px-3 py-2 text-left transition-colors ${
                        isSelected ? "bg-muted/50" : "hover:bg-muted/25"
                      }`}
                      onClick={() => {
                        setSelectedClientId(client.id);
                        setLocation(`/audience?clientId=${client.id}`);
                      }}
                      data-testid={`button-select-audience-client-${client.id}`}
                    >
                      <div className="font-medium text-sm truncate">{client.name}</div>
                      <div className="text-xs text-muted-foreground truncate">{client.primaryEmail}</div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          <section className="rounded-lg border bg-background p-4 h-[calc(100vh-180px)] overflow-y-auto">
            {!selectedClient ? (
              <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
                Select a client to manage their list and segments
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <button
                      type="button"
                      className="text-base font-semibold hover:underline"
                      onClick={() => setPreviewClientId(selectedClient.id)}
                      data-testid="button-open-audience-client-panel"
                    >
                      {selectedClient.name}
                    </button>
                    <div className="text-sm text-muted-foreground">{selectedClient.primaryEmail}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">{contacts.length} total</Badge>
                    <Badge variant="outline" className="text-xs">
                      {activeContacts} active
                    </Badge>
                    <Badge variant="outline" className="text-xs">
                      {unsubscribedContacts} unsubscribed
                    </Badge>
                  </div>
                </div>

                <ClientAudiencePanel clientId={selectedClient.id} />
              </div>
            )}
          </section>
        </div>
      </div>

      {previewClientId && (
        <ClientSidePanel
          clientId={previewClientId}
          open={!!previewClientId}
          onClose={() => setPreviewClientId(null)}
        />
      )}
    </div>
  );
}
