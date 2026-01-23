import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TopNav } from "@/components/TopNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LayoutGrid, List, Filter, Calendar, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Newsletter, Client, NewsletterStatus } from "@shared/schema";

const NEWSLETTER_STATUSES = [
  { value: "not_started", label: "Not Started", color: "bg-muted text-muted-foreground" },
  { value: "in_progress", label: "In Progress", color: "bg-blue-500/10 text-blue-600 dark:text-blue-400" },
  { value: "revisions", label: "Revisions", color: "bg-orange-500/10 text-orange-600 dark:text-orange-400" },
  { value: "internal_review", label: "Internal Review", color: "bg-purple-500/10 text-purple-600 dark:text-purple-400" },
  { value: "client_review", label: "Client Review", color: "bg-yellow-500/10 text-yellow-600 dark:text-yellow-400" },
  { value: "approved", label: "Approved", color: "bg-green-500/10 text-green-600 dark:text-green-400" },
  { value: "sent", label: "Sent", color: "bg-primary/10 text-primary" },
] as const;

type NewsletterWithClient = Newsletter & { client: Client };

function getStatusConfig(status: string) {
  return NEWSLETTER_STATUSES.find(s => s.value === status) || NEWSLETTER_STATUSES[0];
}

function NewsletterCard({ newsletter, onStatusChange }: { newsletter: NewsletterWithClient; onStatusChange: (id: string, status: string) => void }) {
  const statusConfig = getStatusConfig(newsletter.status);
  
  return (
    <Card className="p-3 hover-elevate cursor-pointer" data-testid={`newsletter-card-${newsletter.id}`}>
      <Link href={`/clients/${newsletter.clientId}?newsletter=${newsletter.id}`}>
        <div className="flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-sm line-clamp-2">{newsletter.client.name}</p>
            <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
          </div>
          <p className="text-xs text-muted-foreground">
            {format(new Date(newsletter.expectedSendDate), "MMM d")}
          </p>
        </div>
      </Link>
      <div className="mt-2" onClick={(e) => e.stopPropagation()}>
        <Select
          value={newsletter.status}
          onValueChange={(value) => onStatusChange(newsletter.id, value)}
        >
          <SelectTrigger className="h-7 text-xs" data-testid={`status-trigger-${newsletter.id}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {NEWSLETTER_STATUSES.map((s) => (
              <SelectItem key={s.value} value={s.value} data-testid={`status-option-${s.value}`}>
                <span className={`inline-flex items-center gap-1.5`}>
                  <span className={`w-2 h-2 rounded-full ${s.color.split(' ')[0]}`} />
                  {s.label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Card>
  );
}

function BoardView({ newsletters, onStatusChange }: { newsletters: NewsletterWithClient[]; onStatusChange: (id: string, status: string) => void }) {
  const ongoingStatuses = NEWSLETTER_STATUSES.filter(s => s.value !== "sent");
  
  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {ongoingStatuses.map((status) => {
        const statusNewsletters = newsletters.filter(n => n.status === status.value);
        return (
          <div key={status.value} className="flex-shrink-0 w-64">
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="outline" className={status.color} data-testid={`board-column-${status.value}`}>
                {status.label}
              </Badge>
              <span className="text-xs text-muted-foreground">{statusNewsletters.length}</span>
            </div>
            <div className="space-y-2">
              {statusNewsletters.map((newsletter) => (
                <NewsletterCard
                  key={newsletter.id}
                  newsletter={newsletter}
                  onStatusChange={onStatusChange}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function TableView({ newsletters, onStatusChange }: { newsletters: NewsletterWithClient[]; onStatusChange: (id: string, status: string) => void }) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-muted/50">
            <th className="text-left p-3 font-medium">Client</th>
            <th className="text-left p-3 font-medium">Title</th>
            <th className="text-left p-3 font-medium">Due Date</th>
            <th className="text-left p-3 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {newsletters.map((newsletter) => (
            <tr key={newsletter.id} className="border-t hover:bg-muted/30" data-testid={`newsletter-row-${newsletter.id}`}>
              <td className="p-3">
                <Link href={`/clients/${newsletter.clientId}?newsletter=${newsletter.id}`} className="hover:underline">
                  {newsletter.client.name}
                </Link>
              </td>
              <td className="p-3">{newsletter.title}</td>
              <td className="p-3 text-muted-foreground">
                {format(new Date(newsletter.expectedSendDate), "MMM d, yyyy")}
              </td>
              <td className="p-3">
                <Select
                  value={newsletter.status}
                  onValueChange={(value) => onStatusChange(newsletter.id, value)}
                >
                  <SelectTrigger className="h-8 w-40" data-testid={`status-trigger-table-${newsletter.id}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {NEWSLETTER_STATUSES.map((s) => (
                      <SelectItem key={s.value} value={s.value}>
                        <span className="inline-flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${s.color.split(' ')[0]}`} />
                          {s.label}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function NewslettersPage() {
  const [view, setView] = useState<"board" | "table">("board");
  const [filter, setFilter] = useState<"ongoing" | "sent" | "all">("ongoing");

  const { data: newsletters = [], isLoading } = useQuery<NewsletterWithClient[]>({
    queryKey: ["/api/newsletters"],
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      return apiRequest("PATCH", `/api/newsletters/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] });
    },
  });

  const filteredNewsletters = newsletters.filter(n => {
    if (filter === "ongoing") return n.status !== "sent";
    if (filter === "sent") return n.status === "sent";
    return true;
  });

  const handleStatusChange = (id: string, status: string) => {
    updateStatusMutation.mutate({ id, status });
  };

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-semibold">Newsletters</h1>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <TabsList>
                <TabsTrigger value="ongoing" data-testid="tab-ongoing">Ongoing</TabsTrigger>
                <TabsTrigger value="sent" data-testid="tab-sent">Sent</TabsTrigger>
                <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          
          <div className="flex items-center gap-2">
            <Button
              variant={view === "board" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setView("board")}
              data-testid="button-view-board"
            >
              <LayoutGrid className="w-4 h-4" />
            </Button>
            <Button
              variant={view === "table" ? "secondary" : "ghost"}
              size="icon"
              onClick={() => setView("table")}
              data-testid="button-view-table"
            >
              <List className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">Loading newsletters...</p>
          </div>
        ) : filteredNewsletters.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Calendar className="w-12 h-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">No newsletters found</p>
          </div>
        ) : view === "board" ? (
          <ScrollArea className="h-[calc(100vh-180px)]">
            <BoardView newsletters={filteredNewsletters} onStatusChange={handleStatusChange} />
          </ScrollArea>
        ) : (
          <TableView newsletters={filteredNewsletters} onStatusChange={handleStatusChange} />
        )}
      </div>
    </div>
  );
}
