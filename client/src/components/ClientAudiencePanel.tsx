import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { FileUp, Loader2, Plus, Save, Trash2, Upload } from "lucide-react";
import type { Contact, ContactSegment } from "@shared/schema";

interface ClientAudiencePanelProps {
  clientId: string;
}

type CsvPreviewRow = {
  lineNumber: number;
  email: string;
  firstName: string;
  lastName: string;
  tags: string[];
  isValidEmail: boolean;
};

type CsvPreviewData = {
  headers: string[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  previewRows: CsvPreviewRow[];
  detectedTags: string[];
  hasEmailColumn: boolean;
};

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

function normalizeHeaderKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function splitTagInput(raw: string): string[] {
  if (!raw.trim()) return [];
  return Array.from(
    new Set(
      raw
        .split(/[;,|]/g)
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim().toLowerCase());
}

function parseCsvForPreview(csvContent: string): CsvPreviewData | null {
  const lines = csvContent
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  if (headers.length === 0) return null;

  const headerMeta = headers.map((header, index) => ({
    index,
    key: normalizeHeaderKey(header),
  }));

  const pickHeaderIndex = (keys: string[]): number | undefined =>
    headerMeta.find((item) => keys.includes(item.key))?.index;

  const emailIndex = pickHeaderIndex(["email", "emailaddress", "eaddress"]);
  const firstNameIndex = pickHeaderIndex(["firstname", "fname", "first"]);
  const lastNameIndex = pickHeaderIndex(["lastname", "lname", "last"]);
  const tagsIndex = pickHeaderIndex(["tags", "tag", "segment", "segments", "group", "groups"]);

  const previewRows: CsvPreviewRow[] = [];
  const detectedTags = new Set<string>();
  let validRows = 0;
  let invalidRows = 0;

  const dataRows = lines.slice(1);
  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex++) {
    const row = parseCsvLine(dataRows[rowIndex]);
    const fallbackEmail = row.find((cell) => cell.includes("@")) || "";
    const rawEmail = (emailIndex !== undefined ? row[emailIndex] : fallbackEmail) || "";
    const email = rawEmail.trim().toLowerCase();
    const isValidEmail = isLikelyEmail(email);

    if (isValidEmail) validRows += 1;
    else invalidRows += 1;

    const firstName = (firstNameIndex !== undefined ? row[firstNameIndex] : "") || "";
    const lastName = (lastNameIndex !== undefined ? row[lastNameIndex] : "") || "";
    const rawTags = (tagsIndex !== undefined ? row[tagsIndex] : "") || "";
    const tags = splitTagInput(rawTags);

    for (const tag of tags) {
      if (tag !== "all") detectedTags.add(tag);
    }

    if (previewRows.length < 8) {
      previewRows.push({
        lineNumber: rowIndex + 2,
        email,
        firstName,
        lastName,
        tags,
        isValidEmail,
      });
    }
  }

  return {
    headers,
    totalRows: dataRows.length,
    validRows,
    invalidRows,
    previewRows,
    detectedTags: Array.from(detectedTags),
    hasEmailColumn: emailIndex !== undefined,
  };
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

  const [csvContent, setCsvContent] = useState("");
  const [csvFileName, setCsvFileName] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [createSegmentsFromTags, setCreateSegmentsFromTags] = useState(true);
  const [selectedSegmentTags, setSelectedSegmentTags] = useState<string[]>([]);

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

  const csvPreview = useMemo(() => parseCsvForPreview(csvContent), [csvContent]);
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
      setSelectedSegmentTags([]);
      const importedCount = data?.summary?.importedCount || 0;
      const updatedCount = data?.summary?.updatedCount || 0;
      const createdSegmentsCount = data?.summary?.createdSegmentsCount || 0;
      const segmentSuffix =
        createdSegmentsCount > 0 ? `, ${createdSegmentsCount} segments created` : "";
      toast({
        title: "Contacts imported",
        description: `${importedCount} new, ${updatedCount} updated${segmentSuffix}`,
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
        tags: splitTagInput(newContact.tags).length > 0 ? splitTagInput(newContact.tags) : ["all"],
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
    mutationFn: async (payload?: { name: string; tags: string[] }) => {
      const name = (payload?.name || newSegment.name).trim();
      const customTags = payload?.tags || splitTagInput(newSegment.tags);
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
        tags: splitTagInput(payload.tags),
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

  const displayedContacts = useMemo(() => filteredContacts.slice(0, 40), [filteredContacts]);
  const savedSegments = useMemo(
    () => segments.filter((segment) => !segment.id.startsWith("derived-")),
    [segments]
  );
  const suggestedSegments = useMemo(
    () => segments.filter((segment) => segment.id.startsWith("derived-")),
    [segments]
  );

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
              </div>

              {!csvPreview.hasEmailColumn && (
                <div className="text-xs text-red-600 dark:text-red-300">
                  No email column detected. Add a header named <code>email</code>.
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
                        <tr key={row.lineNumber} className="border-t">
                          <td className="px-2 py-1.5 text-muted-foreground">{row.lineNumber}</td>
                          <td className="px-2 py-1.5">
                            <span className={row.isValidEmail ? "" : "text-red-600 dark:text-red-300"}>
                              {row.email || "—"}
                            </span>
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

          <div className="space-y-1.5 max-h-72 overflow-y-auto pr-1">
            {displayedContacts.length === 0 && (
              <div className="text-xs text-muted-foreground">
                {contacts.length === 0 ? "No contacts imported yet" : "No contacts match this search"}
              </div>
            )}
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
                          onClick={() => {
                            updateContactMutation.mutate({
                              id: contact.id,
                              data: {
                                email: draft.email,
                                firstName: draft.firstName || null,
                                lastName: draft.lastName || null,
                                tags: splitTagInput(draft.tags).length > 0 ? splitTagInput(draft.tags) : ["all"],
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
          {filteredContacts.length > displayedContacts.length && (
            <div className="text-[11px] text-muted-foreground">
              Showing first {displayedContacts.length} of {filteredContacts.length} contacts
            </div>
          )}
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
