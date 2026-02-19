import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  AUDIENCE_CSV_TEMPLATE,
  parseAudienceCsv,
  splitAudienceTags,
  triggerCsvDownload,
} from "@/lib/audienceCsv";
import { useToast } from "@/hooks/use-toast";
import { Download, FileUp, Loader2, Plus, Save, Upload } from "lucide-react";
import type { Contact, ContactSegment } from "@shared/schema";

interface ClientAudiencePanelProps {
  clientId: string;
}

function toTitleCase(value: string): string {
  return value
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function ClientAudiencePanel({ clientId }: ClientAudiencePanelProps) {
  const { toast } = useToast();
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);
  const contactsPageSize = 50;

  const [csvContent, setCsvContent] = useState("");
  const [csvFileName, setCsvFileName] = useState("");
  const [lastImportInvalidRowsCsv, setLastImportInvalidRowsCsv] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [contactsPage, setContactsPage] = useState(1);
  const [selectedContactIds, setSelectedContactIds] = useState<string[]>([]);
  const [createSegmentsFromTags, setCreateSegmentsFromTags] = useState(true);
  const [selectedSegmentTags, setSelectedSegmentTags] = useState<string[]>([]);
  const [mergeSourceSegmentId, setMergeSourceSegmentId] = useState("");
  const [mergeTargetSegmentId, setMergeTargetSegmentId] = useState("");

  const [newContact, setNewContact] = useState({
    email: "",
    firstName: "",
    lastName: "",
    tags: "all",
  });
  const [editingContacts, setEditingContacts] = useState<
    Record<string, { email: string; firstName: string; lastName: string; tags: string; isActive: boolean }>
  >({});
  const [newSegment, setNewSegment] = useState({ name: "", tags: "" });
  const [editingSegments, setEditingSegments] = useState<Record<string, { name: string; tags: string }>>({});

  const { data: contacts = [] } = useQuery<Contact[]>({
    queryKey: ["/api/clients", clientId, "contacts"],
  });

  const { data: segments = [] } = useQuery<ContactSegment[]>({
    queryKey: ["/api/clients", clientId, "segments"],
  });

  const existingEmailSet = useMemo(
    () => new Set(contacts.map((contact) => (contact.email || "").toLowerCase()).filter(Boolean)),
    [contacts]
  );
  const csvPreview = useMemo(() => parseAudienceCsv(csvContent, existingEmailSet), [csvContent, existingEmailSet]);
  const previewTagsKey = (csvPreview?.detectedTags || []).join("|");

  useEffect(() => {
    const tags = csvPreview?.detectedTags || [];
    if (tags.length === 0) {
      setSelectedSegmentTags([]);
      return;
    }
    setSelectedSegmentTags((previous) => {
      const retained = previous.filter((tag) => tags.includes(tag));
      return retained.length > 0 ? retained : tags;
    });
  }, [previewTagsKey]);

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/contacts/import-csv`, {
        csvContent,
        createSegmentsFromTags,
        segmentTags: createSegmentsFromTags ? selectedSegmentTags : [],
      });
      return res.json();
    },
    onSuccess: (data: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "segments"] });
      setCsvContent("");
      setCsvFileName("");
      setSelectedContactIds([]);
      setSelectedSegmentTags([]);
      setLastImportInvalidRowsCsv(data?.invalidRowsCsv || "");
      const importedCount = data?.summary?.importedCount || 0;
      const updatedCount = data?.summary?.updatedCount || 0;
      const createdSegmentsCount = data?.summary?.createdSegmentsCount || 0;
      const invalidRowsCount = data?.summary?.invalidRowsCount || 0;
      const segmentSuffix =
        createdSegmentsCount > 0 ? `, ${createdSegmentsCount} segments created` : "";
      const invalidSuffix =
        invalidRowsCount > 0 ? `, ${invalidRowsCount} invalid rows available to download` : "";
      toast({
        title: "Contacts imported",
        description: `${importedCount} new, ${updatedCount} updated${segmentSuffix}${invalidSuffix}`,
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
      const tags = splitAudienceTags(newContact.tags);
      const res = await apiRequest("POST", `/api/clients/${clientId}/contacts`, {
        email: newContact.email.trim(),
        firstName: newContact.firstName.trim() || null,
        lastName: newContact.lastName.trim() || null,
        tags: tags.length > 0 ? tags : ["all"],
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

  const bulkContactActionMutation = useMutation({
    mutationFn: async (payload: { action: "activate" | "deactivate" | "delete"; contactIds: string[] }) => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/contacts/bulk-action`, payload);
      return res.json();
    },
    onSuccess: (data: any, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "segments"] });
      setSelectedContactIds([]);
      const count = data?.contactCount || variables.contactIds.length;
      const actionLabel =
        variables.action === "activate"
          ? "activated"
          : variables.action === "deactivate"
            ? "deactivated"
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

  const createSegmentMutation = useMutation({
    mutationFn: async (payload?: { name: string; tags: string[] }) => {
      const name = (payload?.name || newSegment.name).trim();
      const customTags = payload?.tags || splitAudienceTags(newSegment.tags);
      const tags = customTags.length > 0 ? customTags : [name.toLowerCase()];
      const res = await apiRequest("POST", `/api/clients/${clientId}/segments`, {
        name,
        tags,
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "segments"] });
      setNewSegment({ name: "", tags: "" });
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
        tags: splitAudienceTags(payload.tags),
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

  const mergeSegmentsMutation = useMutation({
    mutationFn: async (payload: { sourceSegmentId: string; targetSegmentId: string }) => {
      const res = await apiRequest("POST", `/api/clients/${clientId}/segments/merge`, payload);
      return res.json();
    },
    onSuccess: (data: any, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/clients", clientId, "segments"] });
      setMergeSourceSegmentId("");
      setMergeTargetSegmentId("");
      const updatedContacts = data?.updatedContacts || 0;
      toast({
        title: "Segments merged",
        description: `${updatedContacts} contacts updated`,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Merge failed", description: error.message, variant: "destructive" });
    },
  });

  const filteredContacts = useMemo(() => {
    const search = contactSearch.trim().toLowerCase();
    if (!search) return contacts;
    return contacts.filter((contact) => {
      const fullName = `${contact.firstName || ""} ${contact.lastName || ""}`.trim().toLowerCase();
      const email = (contact.email || "").toLowerCase();
      const tags = (contact.tags || []).join(" ").toLowerCase();
      return fullName.includes(search) || email.includes(search) || tags.includes(search);
    });
  }, [contacts, contactSearch]);

  const contactsPageCount = Math.max(1, Math.ceil(filteredContacts.length / contactsPageSize));
  const pagedContacts = useMemo(() => {
    const start = (contactsPage - 1) * contactsPageSize;
    const end = start + contactsPageSize;
    return filteredContacts.slice(start, end);
  }, [filteredContacts, contactsPage, contactsPageSize]);
  const pagedContactIds = useMemo(() => pagedContacts.map((contact) => contact.id), [pagedContacts]);
  const allPagedSelected =
    pagedContactIds.length > 0 && pagedContactIds.every((id) => selectedContactIds.includes(id));

  const savedSegments = useMemo(
    () => segments.filter((segment) => !segment.id.startsWith("derived-")),
    [segments]
  );
  const suggestedSegments = useMemo(
    () => segments.filter((segment) => segment.id.startsWith("derived-")),
    [segments]
  );
  const mergeableSegments = useMemo(
    () => savedSegments.filter((segment) => segment.name.toLowerCase() !== "all"),
    [savedSegments]
  );

  useEffect(() => {
    setContactsPage(1);
    setSelectedContactIds([]);
  }, [contactSearch, clientId]);

  useEffect(() => {
    setContactsPage((current) => Math.min(current, contactsPageCount));
  }, [contactsPageCount]);

  useEffect(() => {
    const filteredIdSet = new Set(filteredContacts.map((contact) => contact.id));
    setSelectedContactIds((current) => current.filter((id) => filteredIdSet.has(id)));
  }, [filteredContacts]);

  const handleCsvFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const content = await file.text();
      setCsvContent(content);
      setCsvFileName(file.name);
      toast({
        title: "CSV ready",
        description: `${file.name} loaded. Review preview, then import.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to read file";
      toast({ title: "CSV read failed", description: message, variant: "destructive" });
    } finally {
      event.target.value = "";
    }
  };

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

  const clearContactDraft = (contactId: string) => {
    setEditingContacts((prev) => {
      const next = { ...prev };
      delete next[contactId];
      return next;
    });
  };

  const clearSegmentDraft = (segmentId: string) => {
    setEditingSegments((prev) => {
      const next = { ...prev };
      delete next[segmentId];
      return next;
    });
  };

  const toggleSegmentCandidate = (tag: string) => {
    setSelectedSegmentTags((prev) =>
      prev.includes(tag) ? prev.filter((value) => value !== tag) : [...prev, tag]
    );
  };

  const toggleContactSelection = (contactId: string) => {
    setSelectedContactIds((prev) =>
      prev.includes(contactId) ? prev.filter((id) => id !== contactId) : [...prev, contactId]
    );
  };

  const toggleSelectPageContacts = () => {
    setSelectedContactIds((prev) => {
      if (allPagedSelected) {
        return prev.filter((id) => !pagedContactIds.includes(id));
      }
      return Array.from(new Set([...prev, ...pagedContactIds]));
    });
  };

  const runBulkContactAction = (action: "activate" | "deactivate" | "delete") => {
    if (selectedContactIds.length === 0) return;
    const confirmRequired = action === "delete";
    if (confirmRequired) {
      const ok = window.confirm(`Remove ${selectedContactIds.length} selected contacts? This cannot be undone.`);
      if (!ok) return;
    }
    bulkContactActionMutation.mutate({
      action,
      contactIds: selectedContactIds,
    });
  };

  const quickRenameSegment = (segment: ContactSegment) => {
    const proposed = window.prompt("Rename segment", segment.name);
    if (!proposed) return;
    const trimmed = proposed.trim();
    if (!trimmed || trimmed === segment.name) return;
    updateSegmentMutation.mutate({
      id: segment.id,
      name: trimmed,
      tags: (segment.tags || [segment.name.toLowerCase()]).join(", "),
    });
  };

  const canImport =
    !!csvContent.trim() &&
    !!csvPreview &&
    csvPreview.hasEmailColumn &&
    csvPreview.validRows > 0;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">Audience</span>
        <span className="text-[11px] text-muted-foreground">
          {contacts.length} contacts · {savedSegments.length} saved segments
        </span>
      </div>

      <Tabs defaultValue="bulk" className="w-full">
        <TabsList className="grid h-8 w-full grid-cols-3">
          <TabsTrigger value="bulk" className="text-xs">Bulk Upload</TabsTrigger>
          <TabsTrigger value="contacts" className="text-xs">Contacts</TabsTrigger>
          <TabsTrigger value="segments" className="text-xs">Segments</TabsTrigger>
        </TabsList>

        <TabsContent value="bulk" className="mt-3 space-y-3">
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
              className="min-h-[120px] text-xs font-mono"
              data-testid="textarea-audience-csv"
            />
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">
                Accepted headers: email, first_name, last_name, tags
              </span>
              {!!csvContent && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    setCsvContent("");
                    setCsvFileName("");
                    setSelectedSegmentTags([]);
                  }}
                  data-testid="button-clear-csv-audience"
                >
                  Clear
                </Button>
              )}
            </div>
          </div>

          {csvPreview && (
            <div className="rounded-md border p-3 space-y-3">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="secondary" className="text-[11px]">
                  {csvPreview.totalRows} rows
                </Badge>
                <Badge variant="secondary" className="text-[11px]">
                  {csvPreview.validRows} valid emails
                </Badge>
                {csvPreview.invalidRows > 0 && (
                  <Badge variant="outline" className="text-[11px] text-amber-700 dark:text-amber-300">
                    {csvPreview.invalidRows} rows skipped
                  </Badge>
                )}
                {csvPreview.duplicateInCsvCount > 0 && (
                  <Badge variant="outline" className="text-[11px] text-amber-700 dark:text-amber-300">
                    {csvPreview.duplicateInCsvCount} duplicate rows in CSV
                  </Badge>
                )}
                {csvPreview.duplicateExistingCount > 0 && (
                  <Badge variant="outline" className="text-[11px] text-blue-700 dark:text-blue-300">
                    {csvPreview.duplicateExistingCount} existing contacts will update
                  </Badge>
                )}
                {csvPreview.invalidRows > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      triggerCsvDownload(
                        "flow-invalid-rows-preview.csv",
                        [
                          "line_number,email,first_name,last_name,tags,reason",
                          ...csvPreview.previewRows
                            .filter((row) => !row.isValidEmail)
                            .map((row) =>
                              `${row.lineNumber},${row.email},${row.firstName},${row.lastName},${row.tags.join(";")},invalid email`
                            ),
                        ].join("\n")
                      )
                    }
                    data-testid="button-download-preview-invalid-rows"
                  >
                    <Download className="w-3.5 h-3.5 mr-1.5" />
                    Download Invalid Preview Rows
                  </Button>
                )}
              </div>

              {!csvPreview.hasEmailColumn && (
                <div className="text-xs text-red-600 dark:text-red-300">
                  No email column detected. Add a header named <code>email</code>.
                </div>
              )}
              {csvPreview.duplicateInCsvCount > 0 && (
                <div className="text-xs text-amber-700 dark:text-amber-300">
                  Duplicate CSV rows are allowed; they will update the same contact record.
                </div>
              )}

              <div className="rounded-md border overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/40">
                    <tr>
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Line</th>
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Email</th>
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Name</th>
                      <th className="text-left px-2 py-1.5 font-medium text-muted-foreground">Tags</th>
                    </tr>
                  </thead>
                  <tbody>
                    {csvPreview.previewRows.length === 0 ? (
                      <tr>
                        <td className="px-2 py-2 text-muted-foreground" colSpan={4}>
                          No rows found under the header
                        </td>
                      </tr>
                    ) : (
                      csvPreview.previewRows.map((row) => (
                        <tr
                          key={row.lineNumber}
                          className={`border-t ${
                            row.isDuplicateInCsv || row.isExistingContact ? "bg-amber-500/5" : ""
                          }`}
                        >
                          <td className="px-2 py-1.5 text-muted-foreground">{row.lineNumber}</td>
                          <td className="px-2 py-1.5">
                            <span className={row.isValidEmail ? "" : "text-red-600 dark:text-red-300"}>
                              {row.email || "—"}
                            </span>
                            {row.isDuplicateInCsv && (
                              <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-300">duplicate</span>
                            )}
                            {row.isExistingContact && (
                              <span className="ml-1 text-[10px] text-blue-700 dark:text-blue-300">existing</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5">
                            {[row.firstName, row.lastName].filter(Boolean).join(" ") || "—"}
                          </td>
                          <td className="px-2 py-1.5 text-muted-foreground">
                            {row.tags.length ? row.tags.join(", ") : "all"}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              <div className="rounded-md border bg-muted/10 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-medium">Create segments from imported tags</div>
                    <div className="text-[11px] text-muted-foreground">
                      Turn off to import contacts without creating new segments.
                    </div>
                  </div>
                  <Switch
                    checked={createSegmentsFromTags}
                    onCheckedChange={setCreateSegmentsFromTags}
                    data-testid="switch-create-segments-from-csv"
                  />
                </div>

                {createSegmentsFromTags && (
                  <>
                    {csvPreview.detectedTags.length === 0 ? (
                      <div className="text-[11px] text-muted-foreground">
                        No tags detected in CSV. Contacts will still import.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => setSelectedSegmentTags(csvPreview.detectedTags)}
                          >
                            Select all
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => setSelectedSegmentTags([])}
                          >
                            Clear
                          </Button>
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {csvPreview.detectedTags.map((tag) => {
                            const selected = selectedSegmentTags.includes(tag);
                            return (
                              <button
                                key={tag}
                                type="button"
                                className={`px-2 py-1 rounded-md border text-[11px] transition-colors ${
                                  selected
                                    ? "bg-primary text-primary-foreground border-primary"
                                    : "bg-background hover:bg-muted/20"
                                }`}
                                onClick={() => toggleSegmentCandidate(tag)}
                                data-testid={`button-toggle-csv-segment-${tag}`}
                              >
                                {tag}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>
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
            Import Contact List
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
              Download Invalid Rows From Last Import
            </Button>
          )}
        </TabsContent>

        <TabsContent value="contacts" className="mt-3 space-y-3">
          <div className="rounded-md border bg-muted/20 p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Add Contact</div>
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
              className="h-8 w-full text-xs"
              onClick={() => createContactMutation.mutate()}
              disabled={createContactMutation.isPending || !newContact.email.trim()}
              data-testid="button-add-contact-audience"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add Contact
            </Button>
          </div>

          <Input
            value={contactSearch}
            onChange={(event) => setContactSearch(event.target.value)}
            className="h-8 text-xs"
            placeholder="Search contacts by name, email, or tag"
            data-testid="input-search-audience-contacts"
          />

          {selectedContactIds.length > 0 && (
            <div className="rounded-md border bg-muted/20 p-2 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-muted-foreground mr-1">
                {selectedContactIds.length} selected
              </span>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => runBulkContactAction("activate")}
                disabled={bulkContactActionMutation.isPending}
                data-testid="button-bulk-activate-contacts"
              >
                Activate
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => runBulkContactAction("deactivate")}
                disabled={bulkContactActionMutation.isPending}
                data-testid="button-bulk-deactivate-contacts"
              >
                Deactivate
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-red-600 hover:text-red-600 dark:text-red-300"
                onClick={() => runBulkContactAction("delete")}
                disabled={bulkContactActionMutation.isPending}
                data-testid="button-bulk-delete-contacts"
              >
                Remove
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setSelectedContactIds([])}
              >
                Clear Selection
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <button
              type="button"
              className="underline-offset-2 hover:underline disabled:opacity-40"
              onClick={toggleSelectPageContacts}
              disabled={pagedContactIds.length === 0}
              data-testid="button-select-current-page-contacts"
            >
              {allPagedSelected ? "Unselect page" : "Select page"}
            </button>
            <span>
              Page {contactsPage} / {contactsPageCount}
            </span>
          </div>

          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {pagedContacts.length === 0 && (
              <div className="text-xs text-muted-foreground">
                {contacts.length === 0 ? "No contacts imported yet" : "No contacts match this search"}
              </div>
            )}
            {pagedContacts.map((contact) => {
              const draft = editingContacts[contact.id];
              const isSelected = selectedContactIds.includes(contact.id);
              return (
                <div key={contact.id} className="rounded border p-2 space-y-1.5">
                  <div className="flex items-center justify-between">
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
                  </div>
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
                          onClick={() => {
                            const tags = splitAudienceTags(draft.tags);
                            updateContactMutation.mutate({
                              id: contact.id,
                              data: {
                                email: draft.email,
                                firstName: draft.firstName || null,
                                lastName: draft.lastName || null,
                                tags: tags.length > 0 ? tags : ["all"],
                                isActive: draft.isActive,
                              },
                            });
                            clearContactDraft(contact.id);
                          }}
                          data-testid={`button-save-contact-${contact.id}`}
                        >
                          <Save className="w-3 h-3 mr-1" />
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
                          data-testid={`button-toggle-active-contact-${contact.id}`}
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
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-red-600 hover:text-red-600 dark:text-red-300"
                          onClick={() => deleteContactMutation.mutate(contact.id)}
                          data-testid={`button-delete-contact-${contact.id}`}
                        >
                          Remove
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>{filteredContacts.length} filtered contacts</span>
            <div className="flex items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setContactsPage((current) => Math.max(1, current - 1))}
                disabled={contactsPage <= 1}
                data-testid="button-contacts-page-prev"
              >
                Prev
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs"
                onClick={() => setContactsPage((current) => Math.min(contactsPageCount, current + 1))}
                disabled={contactsPage >= contactsPageCount}
                data-testid="button-contacts-page-next"
              >
                Next
              </Button>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="segments" className="mt-3 space-y-3">
          <div className="rounded-md border bg-muted/20 p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Create Segment</div>
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
                placeholder="Tags (optional)"
                className="h-8 text-xs"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-full text-xs"
              onClick={() => createSegmentMutation.mutate(undefined)}
              disabled={createSegmentMutation.isPending || !newSegment.name.trim()}
              data-testid="button-add-segment-audience"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Add Segment
            </Button>
          </div>

          <div className="rounded-md border bg-muted/20 p-3 space-y-2">
            <div className="text-xs font-medium text-muted-foreground">Merge Segments</div>
            <div className="grid grid-cols-2 gap-2">
              <select
                className="h-8 rounded-md border bg-background px-2 text-xs"
                value={mergeSourceSegmentId}
                onChange={(event) => setMergeSourceSegmentId(event.target.value)}
                data-testid="select-merge-source-segment"
              >
                <option value="">Source segment</option>
                {mergeableSegments.map((segment) => (
                  <option key={`source-${segment.id}`} value={segment.id}>
                    {segment.name}
                  </option>
                ))}
              </select>
              <select
                className="h-8 rounded-md border bg-background px-2 text-xs"
                value={mergeTargetSegmentId}
                onChange={(event) => setMergeTargetSegmentId(event.target.value)}
                data-testid="select-merge-target-segment"
              >
                <option value="">Target segment</option>
                {mergeableSegments.map((segment) => (
                  <option key={`target-${segment.id}`} value={segment.id}>
                    {segment.name}
                  </option>
                ))}
              </select>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-full text-xs"
              onClick={() =>
                mergeSegmentsMutation.mutate({
                  sourceSegmentId: mergeSourceSegmentId,
                  targetSegmentId: mergeTargetSegmentId,
                })
              }
              disabled={
                mergeSegmentsMutation.isPending ||
                !mergeSourceSegmentId ||
                !mergeTargetSegmentId ||
                mergeSourceSegmentId === mergeTargetSegmentId
              }
              data-testid="button-merge-segments"
            >
              Merge Source Into Target
            </Button>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">Saved Segments</div>
            <div className="space-y-1.5 max-h-44 overflow-y-auto pr-1">
              {savedSegments.length === 0 && (
                <span className="text-xs text-muted-foreground">No saved segments yet</span>
              )}
              {savedSegments.map((segment) => {
                const segmentDraft = editingSegments[segment.id];
                return (
                  <div key={segment.id} className="rounded border p-2 space-y-1.5">
                    {segmentDraft ? (
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
                            onClick={() => {
                              updateSegmentMutation.mutate({
                                id: segment.id,
                                name: segmentDraft.name,
                                tags: segmentDraft.tags,
                              });
                              clearSegmentDraft(segment.id);
                            }}
                            data-testid={`button-save-segment-${segment.id}`}
                          >
                            <Save className="w-3 h-3 mr-1" />
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => clearSegmentDraft(segment.id)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </>
                    ) : (
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <div className="text-xs font-medium">{segment.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {(segment.tags || []).join(", ") || "all"}
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => quickRenameSegment(segment)}
                            data-testid={`button-quick-rename-segment-${segment.id}`}
                          >
                            Rename
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs"
                            onClick={() => beginEditSegment(segment)}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 px-2 text-xs text-red-600 hover:text-red-600 dark:text-red-300"
                            onClick={() => deleteSegmentMutation.mutate(segment.id)}
                            data-testid={`button-delete-segment-${segment.id}`}
                          >
                            Remove
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <div className="text-xs font-medium text-muted-foreground">Tag Suggestions</div>
            <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
              {suggestedSegments.length === 0 && (
                <span className="text-xs text-muted-foreground">No new tag suggestions</span>
              )}
              {suggestedSegments.map((segment) => (
                <div key={segment.id} className="rounded border p-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-medium">{toTitleCase(segment.name)}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {(segment.tags || []).join(", ")}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() =>
                      createSegmentMutation.mutate({
                        name: segment.name,
                        tags: segment.tags || [segment.name.toLowerCase()],
                      })
                    }
                    data-testid={`button-save-suggested-segment-${segment.name}`}
                  >
                    Add
                  </Button>
                </div>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
