import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { TopNav } from "@/components/TopNav";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  ArrowRight,
  Plus,
  User,
} from "lucide-react";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Client, Newsletter, Invoice, ProductionTask, User as UserType } from "@shared/schema";
import { format, parseISO, differenceInDays, isPast, isToday } from "date-fns";
import { useState } from "react";

interface EnrichedNewsletter extends Newsletter {
  clientName?: string;
}

interface EnrichedInvoice extends Invoice {
  clientName?: string;
}

export default function MasterDashboard() {
  const [, setLocation] = useLocation();
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [showAddTask, setShowAddTask] = useState(false);

  const { data: clients } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const { data: newsletters, isLoading: loadingNewsletters } = useQuery<Newsletter[]>({
    queryKey: ["/api/newsletters"],
  });

  const { data: invoices, isLoading: loadingInvoices } = useQuery<EnrichedInvoice[]>({
    queryKey: ["/api/invoices"],
  });

  const { data: tasks = [], isLoading: loadingTasks } = useQuery<ProductionTask[]>({
    queryKey: ["/api/tasks"],
  });

  const { data: currentUser } = useQuery<UserType>({
    queryKey: ["/api/auth/me"],
  });

  const toggleTaskMutation = useMutation({
    mutationFn: async ({ id, completed }: { id: string; completed: boolean }) => {
      return apiRequest("PATCH", `/api/tasks/${id}`, { completed });
    },
    onMutate: async ({ id, completed }) => {
      await queryClient.cancelQueries({ queryKey: ["/api/tasks"] });
      const previousTasks = queryClient.getQueryData<ProductionTask[]>(["/api/tasks"]);
      queryClient.setQueryData<ProductionTask[]>(["/api/tasks"], (old) =>
        old?.map((t) => (t.id === id ? { ...t, completed } : t))
      );
      return { previousTasks };
    },
    onError: (err, variables, context) => {
      if (context?.previousTasks) {
        queryClient.setQueryData(["/api/tasks"], context.previousTasks);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
  });

  const createTaskMutation = useMutation({
    mutationFn: async (title: string) => {
      return apiRequest("POST", "/api/tasks", { title });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      setNewTaskTitle("");
      setShowAddTask(false);
    },
  });

  const getClientName = (clientId: string) => {
    return clients?.find((c) => c.id === clientId)?.name || "Client";
  };

  const getUpcomingNewsletters = (): EnrichedNewsletter[] => {
    if (!newsletters) return [];
    return newsletters
      .filter((nl) => nl.status !== "sent" && nl.expectedSendDate)
      .map((nl) => ({ ...nl, clientName: getClientName(nl.clientId) }))
      .sort((a, b) => {
        const dateA = a.expectedSendDate ? new Date(a.expectedSendDate).getTime() : Infinity;
        const dateB = b.expectedSendDate ? new Date(b.expectedSendDate).getTime() : Infinity;
        return dateA - dateB;
      })
      .slice(0, 10);
  };

  const getRecentInvoices = (): EnrichedInvoice[] => {
    if (!invoices) return [];
    return invoices.slice(0, 8);
  };

  const getUrgencyDot = (sendDate: string | Date | null) => {
    if (!sendDate) return null;
    const date = typeof sendDate === "string" ? parseISO(sendDate) : sendDate;
    if (isPast(date) && !isToday(date)) return "bg-red-400";
    const daysUntil = differenceInDays(date, new Date());
    if (daysUntil <= 5) return "bg-amber-400";
    return "bg-emerald-400";
  };

  const getStatusLabel = (status: string) => {
    const labels: Record<string, string> = {
      not_started: "Not Started",
      in_progress: "In Progress",
      internal_review: "Internal Review",
      client_review: "Client Review",
      revisions: "Revisions",
      approved: "Approved",
      sent: "Sent",
    };
    return labels[status] || status;
  };

  const getInvoiceStatusColor = (status: string) => {
    switch (status) {
      case "paid": return "text-emerald-600 dark:text-emerald-400";
      case "pending": return "text-amber-600 dark:text-amber-400";
      case "overdue": return "text-red-600 dark:text-red-400";
      default: return "text-muted-foreground";
    }
  };

  const upcomingNewsletters = getUpcomingNewsletters();
  const recentInvoices = getRecentInvoices();
  const incompleteTasks = tasks.filter(t => !t.completed).slice(0, 6);
  const completedTasks = tasks.filter(t => t.completed).slice(0, 3);

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">Production overview</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Upcoming Newsletters</h2>
              <button
                onClick={() => setLocation("/newsletters")}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                data-testid="button-view-all-newsletters"
              >
                View All
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            {loadingNewsletters ? (
              <div className="space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : upcomingNewsletters.length === 0 ? (
              <div className="text-center py-12 text-sm text-muted-foreground">
                No upcoming newsletters scheduled
              </div>
            ) : (
              <div className="space-y-px">
                {upcomingNewsletters.map((nl) => (
                  <div
                    key={nl.id}
                    className="flex items-center justify-between gap-4 px-3 py-3 rounded-md hover-elevate cursor-pointer"
                    onClick={() => setLocation(`/newsletters/${nl.id}`)}
                    data-testid={`newsletter-row-${nl.id}`}
                  >
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${getUrgencyDot(nl.expectedSendDate) || 'bg-muted'}`} />
                      <div className="min-w-0">
                        <span className="font-medium text-sm">{nl.clientName}</span>
                        <span className="text-muted-foreground text-sm ml-2">{nl.title}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {getStatusLabel(nl.status)}
                      </span>
                      {nl.expectedSendDate && (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          {format(parseISO(nl.expectedSendDate as string), "MMM d")}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-8">
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Recent Orders</h2>
                <button
                  onClick={() => setLocation("/orders")}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                  data-testid="button-view-all-orders"
                >
                  View All
                  <ArrowRight className="w-3 h-3" />
                </button>
              </div>
              {loadingInvoices ? (
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : recentInvoices.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No invoices yet
                </div>
              ) : (
                <div className="space-y-px">
                  {recentInvoices.slice(0, 5).map((inv) => (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-md hover-elevate cursor-pointer"
                      onClick={() => setLocation(`/orders?id=${inv.id}`)}
                      data-testid={`order-row-${inv.id}`}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium truncate">
                          {inv.clientName || "Client"}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          ${parseFloat(inv.amount || "0").toFixed(2)}
                        </div>
                      </div>
                      <span className={`text-xs font-medium capitalize ${getInvoiceStatusColor(inv.status)}`}>
                        {inv.status}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">Tasks</h2>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowAddTask(!showAddTask)}
                  data-testid="button-add-task"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {showAddTask && (
                <div className="flex gap-2 mb-3">
                  <Input
                    placeholder="New task..."
                    value={newTaskTitle}
                    onChange={(e) => setNewTaskTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && newTaskTitle.trim()) {
                        createTaskMutation.mutate(newTaskTitle.trim());
                      }
                    }}
                    className="flex-1"
                    data-testid="input-new-task"
                    autoFocus
                  />
                  <Button
                    size="sm"
                    onClick={() => newTaskTitle.trim() && createTaskMutation.mutate(newTaskTitle.trim())}
                    disabled={!newTaskTitle.trim() || createTaskMutation.isPending}
                    data-testid="button-save-task"
                  >
                    Add
                  </Button>
                </div>
              )}
              {loadingTasks ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-10 w-full" />
                  ))}
                </div>
              ) : tasks.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No tasks yet
                </div>
              ) : (
                <div className="space-y-px">
                  {incompleteTasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex items-center gap-3 px-3 py-2.5 rounded-md hover-elevate"
                      data-testid={`task-row-${task.id}`}
                    >
                      <Checkbox
                        id={`task-${task.id}`}
                        checked={task.completed}
                        onCheckedChange={(checked) => {
                          toggleTaskMutation.mutate({ id: task.id, completed: !!checked });
                        }}
                        className="flex-shrink-0"
                        data-testid={`task-checkbox-${task.id}`}
                      />
                      <span className="text-sm truncate flex-1">{task.title}</span>
                    </div>
                  ))}
                  {completedTasks.length > 0 && (
                    <>
                      <div className="text-xs text-muted-foreground pt-3 pb-1 px-3">Completed</div>
                      {completedTasks.map((task) => (
                        <div
                          key={task.id}
                          className="flex items-center gap-3 px-3 py-2 rounded-md"
                          data-testid={`task-row-${task.id}`}
                        >
                          <Checkbox
                            id={`task-${task.id}`}
                            checked={task.completed}
                            onCheckedChange={(checked) => {
                              toggleTaskMutation.mutate({ id: task.id, completed: !!checked });
                            }}
                            className="flex-shrink-0"
                            data-testid={`task-checkbox-${task.id}`}
                          />
                          <span className="text-sm line-through text-muted-foreground truncate">
                            {task.title}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
