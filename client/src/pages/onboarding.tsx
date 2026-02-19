import { useState } from "react";
import { useParams } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Loader2, MailCheck, Upload } from "lucide-react";
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
  const [csvContent, setCsvContent] = useState("");

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
    onError: (error) => {
      toast({ title: "Verification failed", description: error.message, variant: "destructive" });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/onboarding/${token}/contacts/import-csv`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvContent }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      return res.json();
    },
    onSuccess: (result: any) => {
      setCsvContent("");
      toast({
        title: "Contacts imported",
        description: `${result?.summary?.importedCount || 0} new, ${result?.summary?.updatedCount || 0} updated`,
      });
      refetch();
    },
    onError: (error) => {
      toast({ title: "Import failed", description: error.message, variant: "destructive" });
    },
  });

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
      <div className="max-w-2xl mx-auto space-y-4">
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
          <div className="flex items-center justify-between">
            <h2 className="font-medium">Import Contacts CSV</h2>
            <span className="text-xs text-muted-foreground">{data.audience.contactsCount} contacts</span>
          </div>
          <Textarea
            value={csvContent}
            onChange={(event) => setCsvContent(event.target.value)}
            placeholder={"Paste CSV data here.\nemail,first_name,last_name,tags"}
            className="min-h-[160px] font-mono text-xs"
            data-testid="textarea-onboarding-csv"
          />
          <Button
            onClick={() => importMutation.mutate()}
            disabled={importMutation.isPending || !csvContent.trim()}
            data-testid="button-onboarding-import-csv"
          >
            {importMutation.isPending ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <Upload className="w-4 h-4 mr-2" />
            )}
            Import CSV
          </Button>
        </Card>
      </div>
    </div>
  );
}
