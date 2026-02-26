import { lazy, Suspense } from "react";
import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { Loader2 } from "lucide-react";

const LoginPage = lazy(() => import("@/pages/login"));
const MasterDashboard = lazy(() => import("@/pages/master-dashboard"));
const ClientsListPage = lazy(() => import("@/pages/clients-list"));
const NewslettersPage = lazy(() => import("@/pages/newsletters"));
const InvoicesPage = lazy(() => import("@/pages/invoices"));
const SubscriptionsPage = lazy(() => import("@/pages/subscriptions"));
const BrandingKitsPage = lazy(() => import("@/pages/branding-kits"));
const AudienceManagerPage = lazy(() => import("@/pages/audience-manager"));
const NewsletterEditorPage = lazy(() => import("@/pages/newsletter-editor"));
const ReviewPage = lazy(() => import("@/pages/review"));
const OnboardingPage = lazy(() => import("@/pages/onboarding"));
const DiyDashboardPage = lazy(() => import("@/pages/diy-dashboard"));
const DiyContactsPage = lazy(() => import("@/pages/diy-contacts"));
const DiyBillingPage = lazy(() => import("@/pages/diy-billing"));
const DiyBrandPage = lazy(() => import("@/pages/diy-settings"));
const DiyOnboardingPage = lazy(() => import("@/pages/diy-onboarding"));
const DiyNewslettersPage = lazy(() => import("@/pages/diy-newsletters"));
const NotFound = lazy(() => import("@/pages/not-found"));

type AccessMode = "any" | "internal" | "diy";

function ProtectedRoute({
  children,
  access = "any",
  allowWhenBillingBlocked = false,
}: {
  children: React.ReactNode;
  access?: AccessMode;
  allowWhenBillingBlocked?: boolean;
}) {
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

  const isDiy = (user as any).accountType === "diy_customer";
  if (access === "internal" && isDiy) {
    return <Redirect to="/" />;
  }
  if (access === "diy" && !isDiy) {
    return <Redirect to="/" />;
  }

  const billingStatus = String((user as any).billingStatus || "trialing");
  const billingBlocked = isDiy && billingStatus !== "trialing" && billingStatus !== "active";
  if (billingBlocked && !allowWhenBillingBlocked) {
    return <Redirect to="/billing" />;
  }

  return <>{children}</>;
}

function Router() {
  const { user } = useAuth();
  const isDiy = (user as any)?.accountType === "diy_customer";
  const diyOnboardingCompleted = Boolean((user as any)?.onboardingCompleted);

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      }
    >
    <Switch>
      <Route path="/" component={() => (
        <ProtectedRoute>
          {isDiy ? (diyOnboardingCompleted ? <DiyDashboardPage /> : <Redirect to="/diy/onboarding" />) : <MasterDashboard />}
        </ProtectedRoute>
      )} />
      <Route path="/newsletters" component={() => (
        <ProtectedRoute>
          {isDiy ? <DiyNewslettersPage /> : <NewslettersPage />}
        </ProtectedRoute>
      )} />
      <Route path="/clients" component={() => (
        <ProtectedRoute access="internal">
          <ClientsListPage />
        </ProtectedRoute>
      )} />
      <Route path="/orders" component={() => (
        <ProtectedRoute access="internal">
          <InvoicesPage />
        </ProtectedRoute>
      )} />
      <Route path="/subscriptions" component={() => (
        <ProtectedRoute access="internal">
          <SubscriptionsPage />
        </ProtectedRoute>
      )} />
      <Route path="/branding-kits" component={() => (
        <ProtectedRoute access="internal">
          <BrandingKitsPage />
        </ProtectedRoute>
      )} />
      <Route path="/audience" component={() => (
        <ProtectedRoute>
          {isDiy ? <DiyContactsPage /> : <AudienceManagerPage />}
        </ProtectedRoute>
      )} />
      <Route path="/billing" component={() => (
        <ProtectedRoute access="diy" allowWhenBillingBlocked>
          <DiyBillingPage />
        </ProtectedRoute>
      )} />
      <Route path="/brand" component={() => (
        <ProtectedRoute access="diy" allowWhenBillingBlocked>
          <DiyBrandPage />
        </ProtectedRoute>
      )} />
      <Route path="/settings" component={() => (
        <ProtectedRoute access="diy" allowWhenBillingBlocked>
          <Redirect to="/brand" />
        </ProtectedRoute>
      )} />
      <Route path="/diy/onboarding" component={() => (
        <ProtectedRoute access="diy" allowWhenBillingBlocked>
          {diyOnboardingCompleted ? <Redirect to="/" /> : <DiyOnboardingPage />}
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
    </Suspense>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
            <Router />
          </TooltipProvider>
        </AuthProvider>
      </AppErrorBoundary>
    </QueryClientProvider>
  );
}

export default App;
