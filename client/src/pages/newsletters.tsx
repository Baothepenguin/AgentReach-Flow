import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { TopNav } from "@/components/TopNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LayoutGrid, List, Calendar, ChevronRight } from "lucide-react";
import { format } from "date-fns";
import { Link } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
} from "@dnd-kit/core";
import { useDraggable } from "@dnd-kit/core";
import type { Newsletter, Client } from "@shared/schema";

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

function DraggableNewsletterCard({ newsletter }: { newsletter: NewsletterWithClient }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: newsletter.id,
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    zIndex: isDragging ? 100 : undefined,
    opacity: isDragging ? 0.5 : 1,
  } : undefined;

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes}>
      <Link href={`/newsletters/${newsletter.id}`}>
        <Card className="p-3 hover-elevate cursor-pointer" data-testid={`newsletter-card-${newsletter.id}`}>
          <div className="flex flex-col gap-1">
            <p className="font-medium text-sm line-clamp-1">{newsletter.client.name}</p>
            <p className="text-xs text-muted-foreground">
              {format(new Date(newsletter.expectedSendDate), "MMM d")}
            </p>
          </div>
        </Card>
      </Link>
    </div>
  );
}

function StatusColumn({ status, newsletters }: { status: typeof NEWSLETTER_STATUSES[number]; newsletters: NewsletterWithClient[] }) {
  const { setNodeRef, isOver } = useDroppable({
    id: status.value,
  });

  return (
    <div 
      ref={setNodeRef} 
      className={`flex-shrink-0 w-56 min-h-[200px] rounded-lg transition-colors ${isOver ? 'bg-primary/5' : ''}`}
    >
      <div className="flex items-center gap-2 mb-3 px-1">
        <Badge variant="outline" className={status.color} data-testid={`board-column-${status.value}`}>
          {status.label}
        </Badge>
        <span className="text-xs text-muted-foreground">{newsletters.length}</span>
      </div>
      <div className="space-y-2">
        {newsletters.map((newsletter) => (
          <DraggableNewsletterCard key={newsletter.id} newsletter={newsletter} />
        ))}
      </div>
    </div>
  );
}

function BoardView({ newsletters, onStatusChange }: { newsletters: NewsletterWithClient[]; onStatusChange: (id: string, status: string) => void }) {
  const ongoingStatuses = NEWSLETTER_STATUSES.filter(s => s.value !== "sent");
  const [activeNewsletter, setActiveNewsletter] = useState<NewsletterWithClient | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const handleDragStart = (event: DragStartEvent) => {
    const newsletter = newsletters.find(n => n.id === event.active.id);
    if (newsletter) {
      setActiveNewsletter(newsletter);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveNewsletter(null);

    if (over && active.id !== over.id) {
      const newStatus = over.id as string;
      const currentNewsletter = newsletters.find(n => n.id === active.id);
      if (currentNewsletter && currentNewsletter.status !== newStatus) {
        onStatusChange(active.id as string, newStatus);
      }
    }
  };

  return (
    <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {ongoingStatuses.map((status) => {
          const statusNewsletters = newsletters.filter(n => n.status === status.value);
          return (
            <StatusColumn key={status.value} status={status} newsletters={statusNewsletters} />
          );
        })}
      </div>
      <DragOverlay>
        {activeNewsletter ? (
          <Card className="p-3 shadow-lg border-2 border-primary/50 w-56">
            <div className="flex flex-col gap-1">
              <p className="font-medium text-sm line-clamp-1">{activeNewsletter.client.name}</p>
              <p className="text-xs text-muted-foreground">
                {format(new Date(activeNewsletter.expectedSendDate), "MMM d")}
              </p>
            </div>
          </Card>
        ) : null}
      </DragOverlay>
    </DndContext>
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
                <Link href={`/newsletters/${newsletter.id}`} className="hover:underline">
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
