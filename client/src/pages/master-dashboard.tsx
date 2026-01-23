import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { TopNav } from "@/components/TopNav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Mail,
  Receipt,
  CheckSquare,
  ArrowRight,
  Clock,
  AlertCircle,
  CheckCircle2,
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

  const getUrgencyColor = (sendDate: string | Date | null) => {
    if (!sendDate) return "text-muted-foreground";
    const date = typeof sendDate === "string" ? parseISO(sendDate) : sendDate;
    if (isPast(date) && !isToday(date)) return "text-red-500";
    const daysUntil = differenceInDays(date, new Date());
    if (daysUntil <= 5) return "text-amber-500";
    return "text-emerald-500";
  };

  const getUrgencyBadge = (sendDate: string | Date | null) => {
    if (!sendDate) return null;
    const date = typeof sendDate === "string" ? parseISO(sendDate) : sendDate;
    if (isPast(date) && !isToday(date)) {
      return (
        <Badge variant="destructive" className="text-xs">
          <AlertCircle className="w-3 h-3 mr-1" />
          Past Due
        </Badge>
      );
    }
    const daysUntil = differenceInDays(date, new Date());
    if (daysUntil === 0) {
      return (
        <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs">
          <Clock className="w-3 h-3 mr-1" />
          Due Today
        </Badge>
      );
    }
    if (daysUntil <= 5) {
      return (
        <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs">
          <Clock className="w-3 h-3 mr-1" />
          {daysUntil}d
        </Badge>
      );
    }
    return (
      <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs">
        <CheckCircle2 className="w-3 h-3 mr-1" />
        {daysUntil}d
      </Badge>
    );
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

  const getInvoiceStatusBadge = (status: string) => {
    switch (status) {
      case "paid":
        return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs">Paid</Badge>;
      case "pending":
        return <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 text-xs">Pending</Badge>;
      case "overdue":
        return <Badge variant="destructive" className="text-xs">Overdue</Badge>;
      case "draft":
        return <Badge variant="secondary" className="text-xs">Draft</Badge>;
      default:
        return <Badge variant="outline" className="text-xs">{status}</Badge>;
    }
  };

  const upcomingNewsletters = getUpcomingNewsletters();
  const recentInvoices = getRecentInvoices();

  const incompleteTasks = tasks.filter(t => !t.completed).slice(0, 6);
  const completedTasks = tasks.filter(t => t.completed).slice(0, 3);

  return (
    <div className="min-h-screen bg-background">
      <TopNav />

      <main className="p-6">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-muted-foreground text-sm">Production overview</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
              <CardTitle className="text-base font-medium flex items-center gap-2">
                <Mail className="w-4 h-4 text-primary" />
                Upcoming Newsletters
              </CardTitle>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setLocation("/newsletters")}
                className="text-xs"
                data-testid="button-view-all-newsletters"
              >
                View All
                <ArrowRight className="w-3 h-3 ml-1" />
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {loadingNewsletters ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : upcomingNewsletters.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground text-sm">
                  No upcoming newsletters scheduled
                </div>
              ) : (
                <div className="space-y-1">
                  {upcomingNewsletters.map((nl) => (
                    <div
                      key={nl.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-md hover-elevate cursor-pointer"
                      onClick={() => setLocation(`/newsletters/${nl.id}`)}
                      data-testid={`newsletter-row-${nl.id}`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{nl.clientName}</span>
                          <Badge variant="outline" className="text-xs flex-shrink-0">
                            {getStatusLabel(nl.status)}
                          </Badge>
                        </div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          {nl.title}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        {nl.expectedSendDate && (
                          <span className={`text-xs ${getUrgencyColor(nl.expectedSendDate)}`}>
                            {format(parseISO(nl.expectedSendDate as string), "MMM d")}
                          </span>
                        )}
                        {getUrgencyBadge(nl.expectedSendDate)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <div className="space-y-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <Receipt className="w-4 h-4 text-primary" />
                  Recent Orders
                </CardTitle>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setLocation("/orders")}
                  className="text-xs"
                  data-testid="button-view-all-orders"
                >
                  View All
                  <ArrowRight className="w-3 h-3 ml-1" />
                </Button>
              </CardHeader>
              <CardContent className="pt-0">
                {loadingInvoices ? (
                  <div className="space-y-2">
                    {Array.from({ length: 4 }).map((_, i) => (
                      <Skeleton key={i} className="h-10 w-full" />
                    ))}
                  </div>
                ) : recentInvoices.length === 0 ? (
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    No invoices yet
                  </div>
                ) : (
                  <div className="space-y-1">
                    {recentInvoices.slice(0, 5).map((inv) => (
                      <div
                        key={inv.id}
                        className="flex items-center justify-between gap-2 p-2 rounded-md hover-elevate cursor-pointer"
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
                        {getInvoiceStatusBadge(inv.status)}
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
                <CardTitle className="text-base font-medium flex items-center gap-2">
                  <CheckSquare className="w-4 h-4 text-primary" />
                  Tasks
                </CardTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setShowAddTask(!showAddTask)}
                  data-testid="button-add-task"
                >
                  <Plus className="w-4 h-4" />
                </Button>
              </CardHeader>
              <CardContent className="pt-0">
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
                  <div className="text-center py-6 text-muted-foreground text-sm">
                    No tasks yet. Click + to add one.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {incompleteTasks.map((task) => (
                      <div
                        key={task.id}
                        className="flex items-center gap-3 p-2 rounded-md hover-elevate"
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
                        <div className="flex-1 min-w-0">
                          <span className="text-sm block truncate">{task.title}</span>
                          {task.createdById && (
                            <span className="text-xs text-muted-foreground flex items-center gap-1">
                              <User className="w-3 h-3" />
                              {task.createdById === currentUser?.id ? "You" : "Team"}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                    {completedTasks.length > 0 && (
                      <>
                        <div className="text-xs text-muted-foreground pt-2 pb-1">Completed</div>
                        {completedTasks.map((task) => (
                          <div
                            key={task.id}
                            className="flex items-center gap-3 p-2 rounded-md hover-elevate"
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
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    </div>
  );
}
