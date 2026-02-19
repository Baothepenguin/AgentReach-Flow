import { useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Upload, Plus, Save, Trash2 } from "lucide-react";
import type { Contact, ContactSegment } from "@shared/schema";

interface ClientAudiencePanelProps {
  clientId: string;
}

export function ClientAudiencePanel({ clientId }: ClientAudiencePanelProps) {
  const { toast } = useToast();
  const [csvContent, setCsvContent] = useState("");
  const [newContact, setNewContact] = useState({
    email: "",
    firstName: "",
    lastName: "",
    tags: "all",
  });
  const [editingContacts, setEditingContacts] = useState<Record<string, { email: string; firstName: string; lastName: string; tags: string; isActive: boolean }>>({});
  const [newSegment, setNewSegment] = useState({ name: "", tags: "all" });
  const [editingSegments, setEditingSegments] = useState<Record<string, { name: string; tags: string }>>({});

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

  const createContactMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/contacts`, {
        email: newContact.email.trim(),
        firstName: newContact.firstName.trim() || null,
        lastName: newContact.lastName.trim() || null,
        tags: newContact.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
        isActive: true,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "segments"] });
      setNewContact({ email: "", firstName: "", lastName: "", tags: "all" });
      toast({ title: "Contact added" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to add contact", description: error.message, variant: "destructive" });
    },
  });

  const updateContactMutation = useMutation({
    mutationFn: async (payload: { id: string; data: Record<string, unknown> }) => {
      const res = await apiRequest("PATCH", `/api/contacts/${payload.id}`, payload.data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "segments"] });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update contact", description: error.message, variant: "destructive" });
    },
  });

  const deleteContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      await apiRequest("DELETE", `/api/contacts/${contactId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "segments"] });
      toast({ title: "Contact removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove contact", description: error.message, variant: "destructive" });
    },
  });

  const createSegmentMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/segments`, {
        name: newSegment.name.trim(),
        tags: newSegment.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "segments"] });
      setNewSegment({ name: "", tags: "all" });
      toast({ title: "Segment created" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to create segment", description: error.message, variant: "destructive" });
    },
  });

  const updateSegmentMutation = useMutation({
    mutationFn: async (payload: { id: string; name: string; tags: string }) => {
      const res = await apiRequest("PATCH", `/api/segments/${payload.id}`, {
        name: payload.name.trim(),
        tags: payload.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "segments"] });
      toast({ title: "Segment updated" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update segment", description: error.message, variant: "destructive" });
    },
  });

  const deleteSegmentMutation = useMutation({
    mutationFn: async (segmentId: string) => {
      await apiRequest("DELETE", `/api/segments/${segmentId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "segments"] });
      toast({ title: "Segment removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove segment", description: error.message, variant: "destructive" });
    },
  });

  const displayedContacts = useMemo(() => contacts.slice(0, 25), [contacts]);

  const beginEditContact = (contact: Contact) => {
    setEditingContacts((prev) => ({
      ...prev,
      [contact.id]: {
        email: contact.email || "",
        firstName: contact.firstName || "",
        lastName: contact.lastName || "",
        tags: (contact.tags || ["all"]).join(", "),
        isActive: !!contact.isActive,
      },
    }));
  };

  const beginEditSegment = (segment: ContactSegment) => {
    setEditingSegments((prev) => ({
      ...prev,
      [segment.id]: {
        name: segment.name,
        tags: (segment.tags || ["all"]).join(", "),
      },
    }));
  };

  return (
    <div className="space-y-4">
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
        <div className="text-xs text-muted-foreground font-medium">Add Contact</div>
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={newContact.email}
            onChange={(event) => setNewContact((prev) => ({ ...prev, email: event.target.value }))}
            placeholder="Email"
            className="h-8 text-xs col-span-2"
          />
          <Input
            value={newContact.firstName}
            onChange={(event) => setNewContact((prev) => ({ ...prev, firstName: event.target.value }))}
            placeholder="First name"
            className="h-8 text-xs"
          />
          <Input
            value={newContact.lastName}
            onChange={(event) => setNewContact((prev) => ({ ...prev, lastName: event.target.value }))}
            placeholder="Last name"
            className="h-8 text-xs"
          />
          <Input
            value={newContact.tags}
            onChange={(event) => setNewContact((prev) => ({ ...prev, tags: event.target.value }))}
            placeholder="Tags (comma separated)"
            className="h-8 text-xs col-span-2"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => createContactMutation.mutate()}
          disabled={createContactMutation.isPending || !newContact.email.trim()}
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Add Contact
        </Button>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-muted-foreground font-medium">Segments</div>
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={newSegment.name}
            onChange={(event) => setNewSegment((prev) => ({ ...prev, name: event.target.value }))}
            placeholder="Segment name"
            className="h-8 text-xs"
          />
          <Input
            value={newSegment.tags}
            onChange={(event) => setNewSegment((prev) => ({ ...prev, tags: event.target.value }))}
            placeholder="Tags"
            className="h-8 text-xs"
          />
        </div>
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => createSegmentMutation.mutate()}
          disabled={createSegmentMutation.isPending || !newSegment.name.trim()}
        >
          <Plus className="w-4 h-4 mr-1.5" />
          Add Segment
        </Button>
        <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
          {segments.length === 0 && <span className="text-xs text-muted-foreground">No segments yet</span>}
          {segments.map((segment) => {
            const isDerived = segment.id.startsWith("derived-");
            const segmentDraft = editingSegments[segment.id];
            return (
              <div key={segment.id} className="rounded border p-2 space-y-1.5">
                {segmentDraft && !isDerived ? (
                  <>
                    <Input
                      value={segmentDraft.name}
                      onChange={(event) =>
                        setEditingSegments((prev) => ({
                          ...prev,
                          [segment.id]: { ...segmentDraft, name: event.target.value },
                        }))
                      }
                      className="h-7 text-xs"
                    />
                    <Input
                      value={segmentDraft.tags}
                      onChange={(event) =>
                        setEditingSegments((prev) => ({
                          ...prev,
                          [segment.id]: { ...segmentDraft, tags: event.target.value },
                        }))
                      }
                      className="h-7 text-xs"
                    />
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          updateSegmentMutation.mutate({
                            id: segment.id,
                            name: segmentDraft.name,
                            tags: segmentDraft.tags,
                          })
                        }
                      >
                        <Save className="w-3 h-3 mr-1" />
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          setEditingSegments((prev) => {
                            const next = { ...prev };
                            delete next[segment.id];
                            return next;
                          })
                        }
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-xs font-medium">{segment.name}</div>
                      <div className="text-[11px] text-muted-foreground">{(segment.tags || []).join(", ") || "all"}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      {isDerived ? (
                        <Badge variant="outline" className="text-[10px]">Derived</Badge>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => beginEditSegment(segment)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-7 w-7"
                            onClick={() => deleteSegmentMutation.mutate(segment.id)}
                          >
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="space-y-1">
        <div className="text-xs text-muted-foreground font-medium">Contacts</div>
        {displayedContacts.length === 0 && <div className="text-xs text-muted-foreground">No contacts imported yet</div>}
        <div className="space-y-1.5 max-h-64 overflow-y-auto pr-1">
          {displayedContacts.map((contact) => {
            const draft = editingContacts[contact.id];
            return (
              <div key={contact.id} className="rounded border p-2 space-y-1.5">
                {draft ? (
                  <>
                    <Input
                      value={draft.email}
                      onChange={(event) =>
                        setEditingContacts((prev) => ({
                          ...prev,
                          [contact.id]: { ...draft, email: event.target.value },
                        }))
                      }
                      className="h-7 text-xs"
                    />
                    <div className="grid grid-cols-2 gap-1.5">
                      <Input
                        value={draft.firstName}
                        onChange={(event) =>
                          setEditingContacts((prev) => ({
                            ...prev,
                            [contact.id]: { ...draft, firstName: event.target.value },
                          }))
                        }
                        className="h-7 text-xs"
                        placeholder="First"
                      />
                      <Input
                        value={draft.lastName}
                        onChange={(event) =>
                          setEditingContacts((prev) => ({
                            ...prev,
                            [contact.id]: { ...draft, lastName: event.target.value },
                          }))
                        }
                        className="h-7 text-xs"
                        placeholder="Last"
                      />
                    </div>
                    <Input
                      value={draft.tags}
                      onChange={(event) =>
                        setEditingContacts((prev) => ({
                          ...prev,
                          [contact.id]: { ...draft, tags: event.target.value },
                        }))
                      }
                      className="h-7 text-xs"
                      placeholder="tags"
                    />
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          updateContactMutation.mutate({
                            id: contact.id,
                            data: {
                              email: draft.email,
                              firstName: draft.firstName || null,
                              lastName: draft.lastName || null,
                              tags: draft.tags.split(",").map((tag) => tag.trim()).filter(Boolean),
                              isActive: draft.isActive,
                            },
                          })
                        }
                      >
                        <Save className="w-3 h-3 mr-1" />
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          setEditingContacts((prev) => {
                            const next = { ...prev };
                            delete next[contact.id];
                            return next;
                          })
                        }
                      >
                        Cancel
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-sm">
                      {contact.firstName || contact.lastName
                        ? `${contact.firstName || ""} ${contact.lastName || ""}`.trim()
                        : contact.email}
                    </div>
                    <div className="text-xs text-muted-foreground">{contact.email}</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(contact.tags || ["all"]).map((tag) => (
                        <Badge key={`${contact.id}-${tag}`} variant="outline" className="text-[10px]">
                          {tag}
                        </Badge>
                      ))}
                      {!contact.isActive && (
                        <Badge variant="secondary" className="text-[10px]">
                          Inactive
                        </Badge>
                      )}
                    </div>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() =>
                          updateContactMutation.mutate({
                            id: contact.id,
                            data: { isActive: !contact.isActive },
                          })
                        }
                      >
                        {contact.isActive ? "Deactivate" : "Activate"}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs"
                        onClick={() => beginEditContact(contact)}
                      >
                        Edit
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => deleteContactMutation.mutate(contact.id)}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
