import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  AUDIENCE_CSV_TEMPLATE,
  parseAudienceCsv,
  triggerCsvDownload,
} from "@/lib/audienceCsv";
import { CheckCircle2, Download, FileUp, Loader2, MailCheck, Upload } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface OnboardingPayload {
  expired: boolean;
  client: {
    id: string;
    name: string;
    primaryEmail: string;
    isVerified: boolean;
  };
  onboarding: {
    token: string;
    expiresAt: string;
  };
  audience: {
    contactsCount: number;
    segmentsCount: number;
  };
}

export default function OnboardingPage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);
  const [csvContent, setCsvContent] = useState("");
  const [csvFileName, setCsvFileName] = useState("");
  const [lastImportInvalidRowsCsv, setLastImportInvalidRowsCsv] = useState("");
  const [createSegmentsFromTags, setCreateSegmentsFromTags] = useState(true);
  const [selectedSegmentTags, setSelectedSegmentTags] = useState<string[]>([]);

  const csvPreview = useMemo(() => parseAudienceCsv(csvContent), [csvContent]);
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

  const { data, refetch, isLoading } = useQuery<OnboardingPayload>({
    queryKey: ["/api/onboarding", token],
    enabled: !!token,
    retry: false,
  });

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/onboarding/${token}/verify-sender/resend`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      return res.json();
    },
    onSuccess: (result: any) => {
      toast({
        title: result?.isVerified ? "Sender verified" : "Verification email sent",
      });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Verification failed", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/onboarding/${token}/contacts/import-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          csvContent,
          createSegmentsFromTags,
          segmentTags: createSegmentsFromTags ? selectedSegmentTags : [],
        }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      return res.json();
    },
    onSuccess: (result: any) => {
      setCsvContent("");
      setCsvFileName("");
      setSelectedSegmentTags([]);
      setLastImportInvalidRowsCsv(result?.invalidRowsCsv || "");
      const createdSegmentsCount = result?.summary?.createdSegmentsCount || 0;
      const invalidRowsCount = result?.summary?.invalidRowsCount || 0;
      const segmentSuffix = createdSegmentsCount > 0 ? `, ${createdSegmentsCount} segments created` : "";
      const invalidSuffix = invalidRowsCount > 0 ? `, ${invalidRowsCount} invalid rows available to download` : "";
      toast({
        title: "Contacts imported",
        description: `${result?.summary?.importedCount || 0} new, ${result?.summary?.updatedCount || 0} updated${segmentSuffix}${invalidSuffix}`,
      });
      refetch();
    },
    onError: (error: Error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

  const canImport =
    !!csvContent.trim() &&
    !!csvPreview &&
    csvPreview.hasEmailColumn &&
    csvPreview.validRows > 0;

  const toggleSegmentCandidate = (tag: string) => {
    setSelectedSegmentTags((prev) =>
      prev.includes(tag) ? prev.filter((value) => value !== tag) : [...prev, tag]
    );
  };

  const onSelectCsvFile = async (event: ChangeEvent<HTMLInputElement>) => {
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

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20">
        <Loader2 className="w-7 h-7 animate-spin" />
      </div>
    );
  }

  if (!data || data.expired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/20 p-4">
        <Card className="max-w-md w-full p-6 text-center">
          <h1 className="text-lg font-semibold mb-2">Onboarding Link Expired</h1>
          <p className="text-sm text-muted-foreground">
            Please request a new onboarding link.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/20 p-4 md:p-8">
      <div className="max-w-3xl mx-auto space-y-4">
        <Card className="p-5">
          <h1 className="text-xl font-semibold">{data.client.name} Onboarding</h1>
          <p className="text-sm text-muted-foreground mt-1">{data.client.primaryEmail}</p>
          <div className="mt-3 flex items-center gap-2">
            {data.client.isVerified ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-blue-600" />
                <span className="text-sm text-blue-700">Sender verified</span>
              </>
            ) : (
              <>
                <MailCheck className="w-4 h-4 text-amber-600" />
                <span className="text-sm text-amber-700">Sender not verified yet</span>
              </>
            )}
          </div>
          <Button
            className="mt-3"
            onClick={() => verifyMutation.mutate()}
            disabled={verifyMutation.isPending}
            data-testid="button-onboarding-verify-sender"
          >
            {verifyMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <MailCheck className="w-4 h-4 mr-2" />
            )}
            {data.client.isVerified ? "Re-check Verification" : "Send Verification Email"}
          </Button>
        </Card>

        <Card className="p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h2 className="font-medium">Import Contacts CSV</h2>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{data.audience.contactsCount} contacts</span>
              <span className="text-xs text-muted-foreground">·</span>
              <span className="text-xs text-muted-foreground">{data.audience.segmentsCount} segments</span>
            </div>
          </div>

          <input
            ref={csvFileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={onSelectCsvFile}
          />

          <div className="rounded-md border bg-background p-3 space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => csvFileInputRef.current?.click()}
                  data-testid="button-onboarding-select-csv-file"
                >
                  <FileUp className="w-3.5 h-3.5 mr-1.5" />
                  Upload CSV File
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => triggerCsvDownload("flow-audience-template.csv", AUDIENCE_CSV_TEMPLATE)}
                  data-testid="button-onboarding-download-csv-template"
                >
                  <Download className="w-3.5 h-3.5 mr-1.5" />
                  Template
                </Button>
              </div>
              <span className="text-[11px] text-muted-foreground truncate max-w-[180px]">
                {csvFileName || "No file selected"}
              </span>
            </div>

            <Textarea
              value={csvContent}
              onChange={(event) => setCsvContent(event.target.value)}
              placeholder={"Paste CSV data here.\nemail,first_name,last_name,tags"}
              className="min-h-[150px] font-mono text-xs"
              data-testid="textarea-onboarding-csv"
            />
          </div>

          {csvPreview && (
            <div className="rounded-md border bg-background p-3 space-y-3">
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
                    {csvPreview.previewRows.map((row) => (
                      <tr key={row.lineNumber} className={`border-t ${row.isDuplicateInCsv ? "bg-amber-500/5" : ""}`}>
                        <td className="px-2 py-1.5 text-muted-foreground">{row.lineNumber}</td>
                        <td className="px-2 py-1.5">
                          <span className={row.isValidEmail ? "" : "text-red-600 dark:text-red-300"}>
                            {row.email || "—"}
                          </span>
                          {row.isDuplicateInCsv && (
                            <span className="ml-1 text-[10px] text-amber-700 dark:text-amber-300">duplicate</span>
                          )}
                        </td>
                        <td className="px-2 py-1.5">
                          {[row.firstName, row.lastName].filter(Boolean).join(" ") || "—"}
                        </td>
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {row.tags.length ? row.tags.join(", ") : "all"}
                        </td>
                      </tr>
                    ))}
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
                    data-testid="switch-onboarding-create-segments"
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
                                data-testid={`button-onboarding-toggle-segment-${tag}`}
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
            onClick={() => importMutation.mutate()}
            disabled={importMutation.isPending || !canImport}
            data-testid="button-onboarding-import-csv"
          >
            {importMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            Import CSV
          </Button>

          {lastImportInvalidRowsCsv && (
            <Button
              variant="outline"
              onClick={() => triggerCsvDownload("flow-invalid-rows.csv", lastImportInvalidRowsCsv)}
              data-testid="button-onboarding-download-last-invalid-rows"
            >
              <Download className="w-4 h-4 mr-2" />
              Download Invalid Rows From Last Import
            </Button>
          )}
        </Card>
      </div>
    </div>
  );
}
