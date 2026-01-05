import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckCircle2, MessageSquare, AlertCircle, Loader2, Sparkles } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface ReviewData {
  newsletter: {
    id: string;
    title: string;
    clientName: string;
  };
  html: string;
  expired: boolean;
}

export default function ReviewPage() {
  const { token } = useParams<{ token: string }>();
  const { toast } = useToast();
  const [showCommentBox, setShowCommentBox] = useState(false);
  const [comment, setComment] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const { data, isLoading, error } = useQuery<ReviewData>({
    queryKey: ["/api/review", token],
    enabled: !!token,
    retry: false,
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/review/${token}/approve`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to approve");
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
      toast({ title: "Newsletter approved!" });
    },
  });

  const requestChangesMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/review/${token}/request-changes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      if (!res.ok) throw new Error("Failed to submit");
      return res.json();
    },
    onSuccess: () => {
      setSubmitted(true);
      toast({ title: "Changes requested" });
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-muted/30 p-6">
        <div className="max-w-4xl mx-auto">
          <Skeleton className="h-12 w-64 mb-6" />
          <Skeleton className="h-[600px] w-full rounded-lg" />
        </div>
      </div>
    );
  }

  if (error || data?.expired) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
        <Card className="p-8 text-center max-w-md">
          <AlertCircle className="w-12 h-12 mx-auto text-destructive mb-4" />
          <h1 className="text-xl font-semibold mb-2">Link Expired or Invalid</h1>
          <p className="text-sm text-muted-foreground">
            This review link is no longer valid. Please contact your agent for a new link.
          </p>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30 p-6">
        <Card className="p-8 text-center max-w-md">
          <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-500 mb-4" />
          <h1 className="text-xl font-semibold mb-2">Thank You!</h1>
          <p className="text-sm text-muted-foreground">
            Your response has been submitted. You can close this page.
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col">
      <header className="bg-background border-b px-6 py-4">
        <div className="max-w-4xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="font-semibold">{data?.newsletter.title}</h1>
              <p className="text-sm text-muted-foreground">{data?.newsletter.clientName}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-6 overflow-auto">
        <div className="max-w-4xl mx-auto">
          <div className="bg-white rounded-lg shadow-2xl overflow-hidden">
            <iframe
              srcDoc={data?.html}
              title="Newsletter Preview"
              className="w-full min-h-[700px] border-0"
              sandbox="allow-same-origin"
              data-testid="iframe-review-preview"
            />
          </div>
        </div>
      </main>

      <footer className="sticky bottom-0 bg-background border-t p-4">
        <div className="max-w-4xl mx-auto">
          {showCommentBox ? (
            <div className="space-y-3">
              <Textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Please describe the changes you'd like..."
                className="min-h-[100px]"
                data-testid="input-review-comment"
              />
              <div className="flex items-center justify-end gap-3">
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowCommentBox(false);
                    setComment("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => requestChangesMutation.mutate()}
                  disabled={!comment.trim() || requestChangesMutation.isPending}
                  data-testid="button-submit-changes"
                >
                  {requestChangesMutation.isPending && (
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  )}
                  Submit Changes
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-4">
              <Button
                size="lg"
                onClick={() => approveMutation.mutate()}
                disabled={approveMutation.isPending}
                className="min-w-[140px]"
                data-testid="button-approve"
              >
                {approveMutation.isPending ? (
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 mr-2" />
                )}
                Approve
              </Button>
              <Button
                size="lg"
                variant="outline"
                onClick={() => setShowCommentBox(true)}
                className="min-w-[140px]"
                data-testid="button-request-changes"
              >
                <MessageSquare className="w-4 h-4 mr-2" />
                Request Changes
              </Button>
            </div>
          )}
        </div>
      </footer>
    </div>
  );
}
