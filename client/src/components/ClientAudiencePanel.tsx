import { ChangeEvent, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  AUDIENCE_CSV_TEMPLATE,
  parseAudienceCsv,
  triggerCsvDownload,
} from "@/lib/audienceCsv";
import { useToast } from "@/hooks/use-toast";
import { Download, FileUp, Loader2, Upload } from "lucide-react";
import type { Contact } from "@shared/schema";

interface ClientAudiencePanelProps {
  clientId: string;
}

interface ContactImportJobItem {
  id: string;
  status: "running" | "completed" | "failed";
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  errors: string[];
  createdAt: string;
  importedByLabel?: string | null;
}

const PRESET_TAGS = ["all", "referral partners", "past clients"] as const;

function normalizeTag(value: string | null | undefined): string {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized || "all";
}

function toTitleCase(value: string): string {
  return value
    .split(/\s+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function ClientAudiencePanel({ clientId }: ClientAudiencePanelProps) {
  const { toast } = useToast();
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);

  const [showImportPanel, setShowImportPanel] = useState(false);
  const [showImportHistory, setShowImportHistory] = useState(false);
  const [csvContent, setCsvContent] = useState("");
  const [csvFileName, setCsvFileName] = useState("");
  const [lastImportInvalidRowsCsv, setLastImportInvalidRowsCsv] = useState("");

  const [contactSearch, setContactSearch] = useState("");
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);

  const [newContact, setNewContact] = useState({
    email: "",
    firstName: "",
    lastName: "",
    tag: "all",
  });

  const [editingContacts, setEditingContacts] = useState<
    Record<
      string,
      {
        email: string;
        firstName: string;
        lastName: string;
        tag: string;
        isActive: boolean;
      }
    >
  >({});

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/clients", clientId, "contacts"],
  });

  const { data: importJobs = [] } = useQuery<ContactImportJobItem[]>({
    queryKey: ["/api/clients", clientId, "contact-import-jobs"],
  });

  const existingEmailSet = useMemo(
    () => new Set(contacts.map((contact) => (contact.email || "").toLowerCase()).filter(Boolean)),
    [contacts]
  );

  const csvPreview = useMemo(() => parseAudienceCsv(csvContent, existingEmailSet), [csvContent, existingEmailSet]);

  const availableTags = useMemo(
    () => PRESET_TAGS.map((tag) => normalizeTag(tag)),
    []
  );

  const filteredContacts = useMemo(() => {
    const normalized = contactSearch.trim().toLowerCase();
    if (!normalized) return contacts;
    return contacts.filter((contact) => {
      const fullName = `${contact.firstName || ""} ${contact.lastName || ""}`.trim().toLowerCase();
      const email = (contact.email || "").toLowerCase();
      const tags = (contact.tags || ["all"]).join(" ").toLowerCase();
      return fullName.includes(normalized) || email.includes(normalized) || tags.includes(normalized);
    });
  }, [contacts, contactSearch]);

  const activeCount = useMemo(() => contacts.filter((contact) => !!contact.isActive).length, [contacts]);
  const unsubscribedCount = Math.max(0, contacts.length - activeCount);

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/contacts/import-csv`, {
        csvContent,
        createSegmentsFromTags: false,
        segmentTags: [],
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contact-import-jobs"] });
      setCsvContent("");
      setCsvFileName("");
      setSelectedContactIds([]);
      setLastImportInvalidRowsCsv(data?.invalidRowsCsv || "");

      const importedCount = data?.summary?.importedCount || 0;
      const updatedCount = data?.summary?.updatedCount || 0;
      const invalidRowsCount = data?.summary?.invalidRowsCount || 0;
      const invalidSuffix = invalidRowsCount > 0 ? `, ${invalidRowsCount} invalid rows` : "";

      toast({
        title: "Contacts imported",
        description: `${importedCount} new, ${updatedCount} updated${invalidSuffix}`,
      });
    },
    onError: (error: Error) => {
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
        tags: [normalizeTag(newContact.tag)],
        isActive: true,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      setNewContact({ email: "", firstName: "", lastName: "", tag: "all" });
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
      setSelectedContactIds([]);
      toast({ title: "Contact removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove contact", description: error.message, variant: "destructive" });
    },
  });

  const bulkContactActionMutation = useMutation({
    mutationFn: async (payload: { action: "activate" | "deactivate" | "delete"; contactIds: string[] }) => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/contacts/bulk-action`, payload);
      return res.json();
    },
    onSuccess: (data: any, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      setSelectedContactIds([]);
      const count = data?.contactCount || variables.contactIds.length;
      const actionLabel =
        variables.action === "activate"
          ? "activated"
          : variables.action === "deactivate"
            ? "unsubscribed"
            : "removed";
      toast({
        title: "Bulk action complete",
        description: `${count} contacts ${actionLabel}`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Bulk action failed", description: error.message, variant: "destructive" });
    },
  });

  const canImport = !!csvContent.trim() && !!csvPreview && csvPreview.hasEmailColumn && csvPreview.validRows > 0;

  const handleCsvFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      setCsvContent(content);
      setCsvFileName(file.name);
      toast({ title: "CSV ready", description: `${file.name} loaded` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read file";
      toast({ title: "CSV read failed", description: message, variant: "destructive" });
    } finally {
      event.target.value = "";
    }
  };

  const beginEditContact = (contact: Contact) => {
    const primaryTag = normalizeTag(contact.tags?.[0] || "all");
    setEditingContacts((previous) => ({
      ...previous,
      [contact.id]: {
        email: contact.email || "",
        firstName: contact.firstName || "",
        lastName: contact.lastName || "",
        tag: primaryTag,
        isActive: !!contact.isActive,
      },
    }));
  };

  const clearContactDraft = (contactId: string) => {
    setEditingContacts((previous) => {
      const next = { ...previous };
      delete next[contactId];
      return next;
    });
  };

  const toggleContactSelection = (contactId: string) => {
    setSelectedContactIds((previous) =>
      previous.includes(contactId)
        ? previous.filter((id) => id !== contactId)
        : [...previous, contactId]
    );
  };

  const runBulkContactAction = (action: "activate" | "deactivate" | "delete") => {
    if (selectedContactIds.length === 0) return;
    if (action === "delete") {
      const ok = window.confirm(`Remove ${selectedContactIds.length} selected contacts?`);
      if (!ok) return;
    }
    bulkContactActionMutation.mutate({
      action,
      contactIds: selectedContactIds,
    });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-md border p-2">
          <div className="text-[11px] text-muted-foreground">Total</div>
          <div className="text-sm font-semibold">{contacts.length}</div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-[11px] text-muted-foreground">Active</div>
          <div className="text-sm font-semibold">{activeCount}</div>
        </div>
        <div className="rounded-md border p-2">
          <div className="text-[11px] text-muted-foreground">Unsubscribed</div>
          <div className="text-sm font-semibold">{unsubscribedCount}</div>
        </div>
      </div>

      <div className="rounded-md border bg-muted/20 p-3 space-y-2">
        <div className="text-xs font-medium text-muted-foreground">Add Contact</div>
        <div className="grid grid-cols-2 gap-2">
          <Input
            value={newContact.email}
            onChange={(event) => setNewContact((previous) => ({ ...previous, email: event.target.value }))}
            placeholder="Email"
            className="h-8 text-xs col-span-2"
          />
          <Input
            value={newContact.firstName}
            onChange={(event) => setNewContact((previous) => ({ ...previous, firstName: event.target.value }))}
            placeholder="First name"
            className="h-8 text-xs"
          />
          <Input
            value={newContact.lastName}
            onChange={(event) => setNewContact((previous) => ({ ...previous, lastName: event.target.value }))}
            placeholder="Last name"
            className="h-8 text-xs"
          />
          <select
            className="h-8 rounded-md border bg-background px-2 text-xs col-span-2"
            value={newContact.tag}
            onChange={(event) => setNewContact((previous) => ({ ...previous, tag: event.target.value }))}
            data-testid="select-new-contact-tag"
          >
            {availableTags.map((tag) => (
              <option key={`new-contact-tag-${tag}`} value={tag}>
                {toTitleCase(tag)}
              </option>
            ))}
          </select>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-full text-xs"
          onClick={() => createContactMutation.mutate()}
          disabled={createContactMutation.isPending || !newContact.email.trim()}
          data-testid="button-add-contact-audience"
        >
          Add Contact
        </Button>
      </div>

      <div className="rounded-md border p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Input
            value={contactSearch}
            onChange={(event) => setContactSearch(event.target.value)}
            className="h-8 text-xs"
            placeholder="Search contacts"
            data-testid="input-search-audience-contacts"
          />
          {!!selectedContactIds.length && (
            <Badge variant="secondary" className="text-xs whitespace-nowrap">
              {selectedContactIds.length} selected
            </Badge>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => runBulkContactAction("activate")}
            disabled={bulkContactActionMutation.isPending || selectedContactIds.length === 0}
            data-testid="button-bulk-activate-contacts"
          >
            Activate
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => runBulkContactAction("deactivate")}
            disabled={bulkContactActionMutation.isPending || selectedContactIds.length === 0}
            data-testid="button-bulk-unsubscribe-contacts"
          >
            Unsubscribe
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs text-red-600 hover:text-red-600 dark:text-red-300"
            onClick={() => runBulkContactAction("delete")}
            disabled={bulkContactActionMutation.isPending || selectedContactIds.length === 0}
            data-testid="button-bulk-delete-contacts"
          >
            Remove
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-xs"
            onClick={() => setSelectedContactIds([])}
            disabled={selectedContactIds.length === 0}
          >
            Clear
          </Button>
        </div>

        <div className="max-h-[360px] overflow-y-auto pr-1 space-y-1.5">
          {filteredContacts.length === 0 ? (
            <div className="text-xs text-muted-foreground py-3">
              {contacts.length === 0 ? "No contacts yet" : "No contacts match this search"}
            </div>
          ) : (
            filteredContacts.map((contact) => {
              const draft = editingContacts[contact.id];
              const isSelected = selectedContactIds.includes(contact.id);

              return (
                <div key={contact.id} className="rounded border p-2 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5"
                        checked={isSelected}
                        onChange={() => toggleContactSelection(contact.id)}
                        data-testid={`checkbox-select-contact-${contact.id}`}
                      />
                      Select
                    </label>
                    {!draft && (
                      <Badge variant={contact.isActive ? "secondary" : "outline"} className="text-[10px]">
                        {contact.isActive ? "Active" : "Unsubscribed"}
                      </Badge>
                    )}
                  </div>

                  {draft ? (
                    <>
                      <Input
                        value={draft.email}
                        onChange={(event) =>
                          setEditingContacts((previous) => ({
                            ...previous,
                            [contact.id]: { ...draft, email: event.target.value },
                          }))
                        }
                        className="h-7 text-xs"
                        placeholder="Email"
                      />
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input
                          value={draft.firstName}
                          onChange={(event) =>
                            setEditingContacts((previous) => ({
                              ...previous,
                              [contact.id]: { ...draft, firstName: event.target.value },
                            }))
                          }
                          className="h-7 text-xs"
                          placeholder="First"
                        />
                        <Input
                          value={draft.lastName}
                          onChange={(event) =>
                            setEditingContacts((previous) => ({
                              ...previous,
                              [contact.id]: { ...draft, lastName: event.target.value },
                            }))
                          }
                          className="h-7 text-xs"
                          placeholder="Last"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <select
                          className="h-7 rounded-md border bg-background px-2 text-xs"
                          value={draft.tag}
                          onChange={(event) =>
                            setEditingContacts((previous) => ({
                              ...previous,
                              [contact.id]: { ...draft, tag: event.target.value },
                            }))
                          }
                          data-testid={`select-edit-contact-tag-${contact.id}`}
                        >
                          {availableTags.map((tag) => (
                            <option key={`edit-contact-tag-${contact.id}-${tag}`} value={tag}>
                              {toTitleCase(tag)}
                            </option>
                          ))}
                        </select>
                        <select
                          className="h-7 rounded-md border bg-background px-2 text-xs"
                          value={draft.isActive ? "active" : "unsubscribed"}
                          onChange={(event) =>
                            setEditingContacts((previous) => ({
                              ...previous,
                              [contact.id]: {
                                ...draft,
                                isActive: event.target.value === "active",
                              },
                            }))
                          }
                          data-testid={`select-edit-contact-status-${contact.id}`}
                        >
                          <option value="active">Active</option>
                          <option value="unsubscribed">Unsubscribed</option>
                        </select>
                      </div>

                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => {
                            updateContactMutation.mutate({
                              id: contact.id,
                              data: {
                                email: draft.email,
                                firstName: draft.firstName || null,
                                lastName: draft.lastName || null,
                                tags: [normalizeTag(draft.tag)],
                                isActive: draft.isActive,
                              },
                            });
                            clearContactDraft(contact.id);
                          }}
                          data-testid={`button-save-contact-${contact.id}`}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => clearContactDraft(contact.id)}
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
                            {toTitleCase(tag)}
                          </Badge>
                        ))}
                      </div>
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => beginEditContact(contact)}
                        >
                          Edit
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-red-600 hover:text-red-600 dark:text-red-300"
                          onClick={() => {
                            const ok = window.confirm(`Remove ${contact.email}?`);
                            if (!ok) return;
                            deleteContactMutation.mutate(contact.id);
                          }}
                          data-testid={`button-delete-contact-${contact.id}`}
                        >
                          Remove
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="rounded-md border p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-muted-foreground">Import Tools</div>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setShowImportPanel((previous) => !previous)}
              data-testid="button-toggle-import-panel"
            >
              {showImportPanel ? "Hide" : "Import CSV"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => setShowImportHistory((previous) => !previous)}
              data-testid="button-toggle-import-history"
            >
              {showImportHistory ? "Hide History" : "History"}
            </Button>
          </div>
        </div>

        {showImportPanel && (
          <>
            <input
              ref={csvFileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={handleCsvFileSelected}
            />

            <div className="rounded-md border bg-muted/20 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => csvFileInputRef.current?.click()}
                    data-testid="button-select-csv-file"
                  >
                    <FileUp className="w-3.5 h-3.5 mr-1.5" />
                    Upload CSV File
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => triggerCsvDownload("flow-audience-template.csv", AUDIENCE_CSV_TEMPLATE)}
                    data-testid="button-download-csv-template"
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Template
                  </Button>
                </div>
                <span className="text-[11px] text-muted-foreground truncate max-w-[170px]">
                  {csvFileName || "No file selected"}
                </span>
              </div>

              <Textarea
                value={csvContent}
                onChange={(event) => setCsvContent(event.target.value)}
                placeholder={"Paste CSV with at least email.\nemail,first_name,last_name,tags"}
                className="min-h-[100px] text-xs font-mono"
                data-testid="textarea-audience-csv"
              />

              {csvPreview && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="secondary" className="text-[11px]">
                    {csvPreview.totalRows} rows
                  </Badge>
                  <Badge variant="secondary" className="text-[11px]">
                    {csvPreview.validRows} valid
                  </Badge>
                  {csvPreview.invalidRows > 0 && (
                    <Badge variant="outline" className="text-[11px] text-amber-700 dark:text-amber-300">
                      {csvPreview.invalidRows} skipped
                    </Badge>
                  )}
                </div>
              )}

              <Button
                size="sm"
                className="h-9 text-xs w-full"
                onClick={() => importMutation.mutate()}
                disabled={importMutation.isPending || !canImport}
                data-testid="button-import-csv-audience"
              >
                {importMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-1.5" />
                )}
                Import Contacts
              </Button>

              {lastImportInvalidRowsCsv && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs w-full"
                  onClick={() => triggerCsvDownload("flow-invalid-rows.csv", lastImportInvalidRowsCsv)}
                  data-testid="button-download-last-import-invalid-rows"
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Download Invalid Rows
                </Button>
              )}
            </div>
          </>
        )}

        {showImportHistory && (
          <div className="rounded-md border p-3 space-y-2">
            {importJobs.length === 0 ? (
              <div className="text-xs text-muted-foreground">No import history yet</div>
            ) : (
              <div className="space-y-1.5 max-h-40 overflow-y-auto pr-1">
                {importJobs.map((job) => {
                  const createdAt = new Date(job.createdAt);
                  const hasValidDate = !Number.isNaN(createdAt.getTime());
                  return (
                    <div key={job.id} className="rounded border p-2 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-[11px] font-medium">{toTitleCase(job.status)}</div>
                        <span className="text-[11px] text-muted-foreground">
                          {hasValidDate ? formatDistanceToNow(createdAt, { addSuffix: true }) : "Unknown"}
                        </span>
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {hasValidDate ? format(createdAt, "MMM d, yyyy h:mm a") : "Unknown time"} · {job.importedByLabel || "Team"}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {job.importedCount} new · {job.updatedCount} updated · {job.skippedCount} skipped
                      </div>
                      {job.errors?.length > 0 && (
                        <div className="text-[11px] text-amber-700 dark:text-amber-300 truncate">
                          {job.errors[0]}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
