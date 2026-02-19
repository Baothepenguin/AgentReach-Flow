import { ChangeEvent, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { format, formatDistanceToNow } from "date-fns";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  AUDIENCE_CSV_TEMPLATE,
  parseAudienceCsv,
  triggerCsvDownload,
} from "@/lib/audienceCsv";
import { useToast } from "@/hooks/use-toast";
import { Download, FileUp, Loader2, MoreHorizontal, Plus, Upload } from "lucide-react";
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

type AudienceView = "all" | "active" | "unsubscribed" | "archived";

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

function contactName(contact: Contact): string {
  const full = `${contact.firstName || ""} ${contact.lastName || ""}`.trim();
  return full || contact.email;
}

export function ClientAudiencePanel({ clientId }: ClientAudiencePanelProps) {
  const { toast } = useToast();
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);

  const [view, setView] = useState<AudienceView>("all");
  const [showSingleAdd, setShowSingleAdd] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
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
  const [bulkEmails, setBulkEmails] = useState("");

  const [editingContactId, setEditingContactId] = useState<string | null>(null);
  const [editingContactDraft, setEditingContactDraft] = useState({
    email: "",
    firstName: "",
    lastName: "",
    tag: "all",
    isActive: true,
  });

  const { data: summaryContacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/clients", clientId, "contacts", "all"],
    queryFn: async () => {
      const response = await fetch(`/api/clients/${clientId}/contacts?view=all`, { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: viewContacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/clients", clientId, "contacts", view],
    queryFn: async () => {
      const response = await fetch(`/api/clients/${clientId}/contacts?view=${view}`, { credentials: "include" });
      if (!response.ok) return [];
      return response.json();
    },
  });

  const { data: importJobs = [] } = useQuery<ContactImportJobItem[]>({
    queryKey: ["/api/clients", clientId, "contact-import-jobs"],
  });

  const existingEmailSet = useMemo(
    () => new Set(summaryContacts.map((contact) => (contact.email || "").toLowerCase()).filter(Boolean)),
    [summaryContacts]
  );

  const csvPreview = useMemo(() => parseAudienceCsv(csvContent, existingEmailSet), [csvContent, existingEmailSet]);

  const filteredContacts = useMemo(() => {
    const normalized = contactSearch.trim().toLowerCase();
    if (!normalized) return viewContacts;

    return viewContacts.filter((contact) => {
      const fullName = contactName(contact).toLowerCase();
      const email = (contact.email || "").toLowerCase();
      const tags = (contact.tags || ["all"]).join(" ").toLowerCase();
      return fullName.includes(normalized) || email.includes(normalized) || tags.includes(normalized);
    });
  }, [viewContacts, contactSearch]);

  const availableTags = PRESET_TAGS.map((tag) => normalizeTag(tag));

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
    mutationFn: async (payload: { email: string; firstName?: string; lastName?: string; tag?: string }) => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/contacts`, {
        email: payload.email.trim(),
        firstName: payload.firstName?.trim() || null,
        lastName: payload.lastName?.trim() || null,
        tags: [normalizeTag(payload.tag || "all")],
        isActive: true,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
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
      setEditingContactId(null);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to update contact", description: error.message, variant: "destructive" });
    },
  });

  const archiveContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const res = await apiRequest("PATCH", `/api/contacts/${contactId}/archive`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      setSelectedContactIds([]);
      toast({ title: "Contact archived" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to archive contact", description: error.message, variant: "destructive" });
    },
  });

  const restoreContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      const res = await apiRequest("PATCH", `/api/contacts/${contactId}/restore`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      setSelectedContactIds([]);
      toast({ title: "Contact restored" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to restore contact", description: error.message, variant: "destructive" });
    },
  });

  const deleteContactMutation = useMutation({
    mutationFn: async (contactId: string) => {
      await apiRequest("DELETE", `/api/contacts/${contactId}`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      setSelectedContactIds([]);
      toast({ title: "Contact permanently deleted" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to delete contact", description: error.message, variant: "destructive" });
    },
  });

  const bulkContactActionMutation = useMutation({
    mutationFn: async (payload: { action: "activate" | "deactivate" | "archive" | "restore"; contactIds: string[] }) => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/contacts/bulk-action`, payload);
      return res.json();
    },
    onSuccess: (_data: any, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      setSelectedContactIds([]);
      const actionLabel =
        variables.action === "activate"
          ? "activated"
          : variables.action === "deactivate"
            ? "unsubscribed"
            : variables.action === "archive"
              ? "archived"
              : "restored";
      toast({ title: "Bulk action complete", description: `${variables.contactIds.length} contacts ${actionLabel}` });
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

  const beginEdit = (contact: Contact) => {
    setEditingContactId(contact.id);
    setEditingContactDraft({
      email: contact.email || "",
      firstName: contact.firstName || "",
      lastName: contact.lastName || "",
      tag: normalizeTag(contact.tags?.[0] || "all"),
      isActive: !!contact.isActive,
    });
  };

  const runBulkAction = (action: "activate" | "deactivate" | "archive" | "restore") => {
    if (!selectedContactIds.length) return;
    bulkContactActionMutation.mutate({ action, contactIds: selectedContactIds });
  };

  const handleBulkAdd = async () => {
    const rows = bulkEmails
      .split(/\r?\n/g)
      .map((line) => line.trim())
      .filter(Boolean);

    if (!rows.length) return;
    const payloads = rows
      .map((row) => {
        const [email, firstName, lastName] = row.split(",").map((part) => part.trim());
        return {
          email,
          firstName: firstName || "",
          lastName: lastName || "",
          tag: "all",
        };
      })
      .filter((row) => row.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email));

    if (!payloads.length) {
      toast({ title: "No valid rows", description: "Use email[,firstName,lastName] format.", variant: "destructive" });
      return;
    }

    await Promise.all(payloads.map((payload) => createContactMutation.mutateAsync(payload)));
    setBulkEmails("");
    setShowBulkAdd(false);
    toast({ title: "Bulk add complete", description: `${payloads.length} contacts added` });
  };

  const toggleActionPanel = (panel: "single" | "bulk" | "import" | "history") => {
    const current =
      panel === "single"
        ? showSingleAdd
        : panel === "bulk"
          ? showBulkAdd
          : panel === "import"
            ? showImportPanel
            : showImportHistory;
    const next = !current;
    setShowSingleAdd(panel === "single" ? next : false);
    setShowBulkAdd(panel === "bulk" ? next : false);
    setShowImportPanel(panel === "import" ? next : false);
    setShowImportHistory(panel === "history" ? next : false);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center rounded-md border bg-background">
          {(["all", "active", "unsubscribed", "archived"] as const).map((tab) => (
            <Button
              key={tab}
              size="sm"
              variant={view === tab ? "secondary" : "ghost"}
              className="h-7 rounded-none first:rounded-l-md last:rounded-r-md text-xs"
              onClick={() => setView(tab)}
              data-testid={`button-audience-tab-${tab}`}
            >
              {toTitleCase(tab)}
            </Button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={contactSearch}
            onChange={(event) => setContactSearch(event.target.value)}
            className="h-8 w-[220px] text-xs"
            placeholder="Search contacts"
          />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="outline" className="h-8 text-xs">
                <Plus className="w-3.5 h-3.5 mr-1.5" />
                Add Contact
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => toggleActionPanel("single")}>
                Single Add
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toggleActionPanel("bulk")}>
                Bulk Add
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toggleActionPanel("import")}>
                Import CSV
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => toggleActionPanel("history")}>
                Import History
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {showSingleAdd && (
        <div className="rounded-md border bg-muted/20 p-3 space-y-2">
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
            className="h-8 text-xs"
            onClick={async () => {
              await createContactMutation.mutateAsync(newContact);
              setNewContact({ email: "", firstName: "", lastName: "", tag: "all" });
              setShowSingleAdd(false);
              toast({ title: "Contact added" });
            }}
            disabled={createContactMutation.isPending || !newContact.email.trim()}
          >
            Add Contact
          </Button>
        </div>
      )}

      {showBulkAdd && (
        <div className="rounded-md border bg-muted/20 p-3 space-y-2">
          <Textarea
            value={bulkEmails}
            onChange={(event) => setBulkEmails(event.target.value)}
            placeholder={"One per line: email[,firstName,lastName]"}
            className="min-h-[110px] text-xs"
          />
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setShowBulkAdd(false)}>
              Cancel
            </Button>
            <Button size="sm" className="h-8 text-xs" onClick={handleBulkAdd} disabled={createContactMutation.isPending}>
              Add in Bulk
            </Button>
          </div>
        </div>
      )}

      {showImportPanel && (
        <div className="rounded-md border bg-muted/20 p-3 space-y-2">
          <input
            ref={csvFileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleCsvFileSelected}
          />

          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={() => csvFileInputRef.current?.click()}
              >
                <FileUp className="w-3.5 h-3.5 mr-1.5" />
                Upload CSV
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={() => triggerCsvDownload("flow-audience-template.csv", AUDIENCE_CSV_TEMPLATE)}
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
          />

          {csvPreview && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <Badge variant="secondary" className="text-[11px]">{csvPreview.totalRows} rows</Badge>
              <Badge variant="secondary" className="text-[11px]">{csvPreview.validRows} valid</Badge>
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
            >
              <Download className="w-3.5 h-3.5 mr-1.5" />
              Download Invalid Rows
            </Button>
          )}
        </div>
      )}

      {showImportHistory && (
        <div className="rounded-md border bg-muted/20 p-3 space-y-2">
          {importJobs.length === 0 ? (
            <div className="text-xs text-muted-foreground">No import history yet</div>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {importJobs.map((job) => {
                const createdAt = new Date(job.createdAt);
                const hasValidDate = !Number.isNaN(createdAt.getTime());
                return (
                  <div key={job.id} className="rounded-md border bg-background px-2 py-1.5 space-y-1">
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
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      <div className="rounded-md border">
        <div className="flex items-center justify-end gap-2 border-b px-2 py-1.5">
          {selectedContactIds.length > 0 ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="outline" className="h-7 text-xs">
                  {selectedContactIds.length} selected
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {view === "archived" ? (
                  <DropdownMenuItem onClick={() => runBulkAction("restore")}>Restore</DropdownMenuItem>
                ) : (
                  <>
                    <DropdownMenuItem onClick={() => runBulkAction("activate")}>Activate</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => runBulkAction("deactivate")}>Unsubscribe</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => runBulkAction("archive")}>Archive</DropdownMenuItem>
                  </>
                )}
                <DropdownMenuItem onClick={() => setSelectedContactIds([])}>Clear selection</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>

        <div className="max-h-[430px] overflow-y-auto divide-y">
          {filteredContacts.length === 0 ? (
            <div className="text-xs text-muted-foreground py-3 px-2">
              {viewContacts.length === 0 ? "No contacts in this view" : "No contacts match this search"}
            </div>
          ) : (
            filteredContacts.map((contact) => {
              const isSelected = selectedContactIds.includes(contact.id);
              const isEditing = editingContactId === contact.id;

              return (
                <div key={contact.id} className="px-2 py-2 hover:bg-muted/20">
                  {isEditing ? (
                    <div className="space-y-1.5">
                      <Input
                        value={editingContactDraft.email}
                        onChange={(event) => setEditingContactDraft((prev) => ({ ...prev, email: event.target.value }))}
                        className="h-7 text-xs"
                        placeholder="Email"
                      />
                      <div className="grid grid-cols-2 gap-1.5">
                        <Input
                          value={editingContactDraft.firstName}
                          onChange={(event) => setEditingContactDraft((prev) => ({ ...prev, firstName: event.target.value }))}
                          className="h-7 text-xs"
                          placeholder="First"
                        />
                        <Input
                          value={editingContactDraft.lastName}
                          onChange={(event) => setEditingContactDraft((prev) => ({ ...prev, lastName: event.target.value }))}
                          className="h-7 text-xs"
                          placeholder="Last"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-1.5">
                        <select
                          className="h-7 rounded-md border bg-background px-2 text-xs"
                          value={editingContactDraft.tag}
                          onChange={(event) => setEditingContactDraft((prev) => ({ ...prev, tag: event.target.value }))}
                        >
                          {availableTags.map((tag) => (
                            <option key={`edit-contact-${contact.id}-${tag}`} value={tag}>{toTitleCase(tag)}</option>
                          ))}
                        </select>
                        <select
                          className="h-7 rounded-md border bg-background px-2 text-xs"
                          value={editingContactDraft.isActive ? "active" : "unsubscribed"}
                          onChange={(event) => setEditingContactDraft((prev) => ({ ...prev, isActive: event.target.value === "active" }))}
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
                          onClick={() => updateContactMutation.mutate({
                            id: contact.id,
                            data: {
                              email: editingContactDraft.email,
                              firstName: editingContactDraft.firstName || null,
                              lastName: editingContactDraft.lastName || null,
                              tags: [normalizeTag(editingContactDraft.tag)],
                              isActive: editingContactDraft.isActive,
                            },
                          })}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs"
                          onClick={() => setEditingContactId(null)}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        className="h-3.5 w-3.5"
                        checked={isSelected}
                        onChange={() =>
                          setSelectedContactIds((prev) =>
                            prev.includes(contact.id) ? prev.filter((id) => id !== contact.id) : [...prev, contact.id]
                          )
                        }
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">{contactName(contact)}</div>
                        <div className="text-[11px] text-muted-foreground truncate">{contact.email}</div>
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        {contact.isActive ? "Active" : "Unsubscribed"}
                      </span>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreHorizontal className="w-3.5 h-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => beginEdit(contact)}>Edit</DropdownMenuItem>
                          {view === "archived" ? (
                            <>
                              <DropdownMenuItem onClick={() => restoreContactMutation.mutate(contact.id)}>
                                Restore
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="text-red-600"
                                onClick={() => {
                                  const ok = window.confirm(
                                    `Delete ${contact.email} permanently? This cannot be undone.`
                                  );
                                  if (!ok) return;
                                  deleteContactMutation.mutate(contact.id);
                                }}
                              >
                                Delete Permanently
                              </DropdownMenuItem>
                            </>
                          ) : (
                            <DropdownMenuItem onClick={() => archiveContactMutation.mutate(contact.id)}>
                              Archive
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
