import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import LoginPage from "@/pages/login";
import MasterDashboard from "@/pages/master-dashboard";
import ClientsListPage from "@/pages/clients-list";
import NewslettersPage from "@/pages/newsletters";
import InvoicesPage from "@/pages/invoices";
import SubscriptionsPage from "@/pages/subscriptions";
import BrandingKitsPage from "@/pages/branding-kits";
import NewsletterEditorPage from "@/pages/newsletter-editor";
import ReviewPage from "@/pages/review";
import OnboardingPage from "@/pages/onboarding";
import NotFound from "@/pages/not-found";
import { Loader2 } from "lucide-react";

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return <LoginPage />;
  }

  return <>{children}</>;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={() => (
        <ProtectedRoute>
          <MasterDashboard />
        </ProtectedRoute>
      )} />
      <Route path="/newsletters" component={() => (
        <ProtectedRoute>
          <NewslettersPage />
        </ProtectedRoute>
      )} />
      <Route path="/clients" component={() => (
        <ProtectedRoute>
          <ClientsListPage />
        </ProtectedRoute>
      )} />
      <Route path="/orders" component={() => (
        <ProtectedRoute>
          <InvoicesPage />
        </ProtectedRoute>
      )} />
      <Route path="/subscriptions" component={() => (
        <ProtectedRoute>
          <SubscriptionsPage />
        </ProtectedRoute>
      )} />
      <Route path="/branding-kits" component={() => (
        <ProtectedRoute>
          <BrandingKitsPage />
        </ProtectedRoute>
      )} />
      <Route path="/newsletters/:id" component={(params) => (
        <ProtectedRoute>
          <NewsletterEditorPage newsletterId={params.params.id} />
        </ProtectedRoute>
      )} />
      <Route path="/review/:token" component={ReviewPage} />
      <Route path="/onboarding/:token" component={OnboardingPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
