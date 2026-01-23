import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TopNav } from "@/components/TopNav";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Plus, Mail, Phone, MapPin, FileText, Users } from "lucide-react";
import { Link } from "wouter";
import type { Client } from "@shared/schema";

function getStatusBadge(status: string) {
  switch (status) {
    case "active":
      return <Badge className="bg-green-500/10 text-green-600 dark:text-green-400">Active</Badge>;
    case "paused":
      return <Badge className="bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">Paused</Badge>;
    case "canceled":
      return <Badge className="bg-red-500/10 text-red-600 dark:text-red-400">Churned</Badge>;
    case "past_due":
      return <Badge className="bg-orange-500/10 text-orange-600 dark:text-orange-400">Past Due</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

function getFrequencyBadge(frequency: string) {
  switch (frequency) {
    case "weekly":
      return <Badge variant="secondary">Weekly</Badge>;
    case "biweekly":
      return <Badge variant="secondary">Bi-Weekly</Badge>;
    case "monthly":
      return <Badge variant="secondary">Monthly</Badge>;
    default:
      return null;
  }
}

function ClientCard({ client }: { client: Client }) {
  const initials = client.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2);
  
  return (
    <Link href={`/clients/${client.id}`}>
      <Card className="p-4 hover-elevate cursor-pointer h-full" data-testid={`client-card-${client.id}`}>
        <div className="flex items-start gap-3 mb-3">
          <Avatar className="w-10 h-10">
            <AvatarFallback className="bg-primary/10 text-primary">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <h3 className="font-medium truncate">{client.name}</h3>
            <div className="flex items-center gap-2 mt-1">
              {getStatusBadge(client.subscriptionStatus)}
              {getFrequencyBadge(client.newsletterFrequency)}
            </div>
          </div>
        </div>
        
        <div className="space-y-1.5 text-sm">
          <div className="flex items-center gap-2 text-muted-foreground">
            <Mail className="w-3.5 h-3.5" />
            <span className="truncate">{client.primaryEmail}</span>
          </div>
          {client.phone && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Phone className="w-3.5 h-3.5" />
              <span>{client.phone}</span>
            </div>
          )}
          {client.locationCity && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <MapPin className="w-3.5 h-3.5" />
              <span>{client.locationCity}{client.locationRegion ? `, ${client.locationRegion}` : ""}</span>
            </div>
          )}
        </div>
        
        <div className="mt-3 pt-3 border-t flex items-center gap-2">
          <Button variant="ghost" size="sm" className="h-7 text-xs" asChild>
            <Link href={`/clients/${client.id}?tab=branding`}>
              <FileText className="w-3 h-3 mr-1" />
              Brand Kit
            </Link>
          </Button>
        </div>
      </Card>
    </Link>
  );
}

export default function ClientsListPage() {
  const [filter, setFilter] = useState<"active" | "churned" | "all">("active");

  const { data: clients = [], isLoading } = useQuery<Client[]>({
    queryKey: ["/api/clients"],
  });

  const filteredClients = clients.filter(c => {
    if (filter === "active") return c.subscriptionStatus === "active";
    if (filter === "churned") return c.subscriptionStatus === "canceled";
    return true;
  });

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      
      <div className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-semibold">Clients</h1>
            <Tabs value={filter} onValueChange={(v) => setFilter(v as typeof filter)}>
              <TabsList>
                <TabsTrigger value="active" data-testid="tab-active">Active</TabsTrigger>
                <TabsTrigger value="churned" data-testid="tab-churned">Churned</TabsTrigger>
                <TabsTrigger value="all" data-testid="tab-all">All</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          
          <Button data-testid="button-new-client">
            <Plus className="w-4 h-4 mr-2" />
            New Client
          </Button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <p className="text-muted-foreground">Loading clients...</p>
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Users className="w-12 h-12 text-muted-foreground/40 mb-4" />
            <p className="text-muted-foreground">No clients found</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filteredClients.map((client) => (
              <ClientCard key={client.id} client={client} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
