import { useAuth } from "@/contexts/AuthContext";
import { TopNav } from "@/components/TopNav";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClientAudiencePanel } from "@/components/ClientAudiencePanel";

export default function DiyContactsPage() {
  const { user } = useAuth();
  const clientId = (user as any)?.diyClientId as string | undefined;

  return (
    <div className="min-h-screen bg-background">
      <TopNav />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Card>
          <CardHeader>
            <CardTitle>Contacts</CardTitle>
            <CardDescription>Import CSV, manage segments/tags, and keep your list ready to send.</CardDescription>
          </CardHeader>
          <CardContent>
            {clientId ? (
              <ClientAudiencePanel clientId={clientId} />
            ) : (
              <div className="text-sm text-muted-foreground">DIY workspace not found. Re-login and try again.</div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
