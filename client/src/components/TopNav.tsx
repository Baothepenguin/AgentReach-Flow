import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useMutation, useQuery } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ChevronDown, UserCircle2, LogOut, Repeat, UserCog } from "lucide-react";
import logoPath from "@assets/Logo_Colored_Trans_1770505643619.png";
import { apiRequest, queryClient } from "@/lib/queryClient";

const INTERNAL_NAV_ITEMS = [
  { path: "/", label: "Dashboard" },
  { path: "/clients", label: "Clients" },
  { path: "/subscriptions", label: "Subscriptions" },
  { path: "/orders", label: "Orders" },
  { path: "/audience", label: "Audience" },
  { path: "/newsletters", label: "Newsletters" },
];

const DIY_NAV_ITEMS = [
  { path: "/", label: "Dashboard" },
  { path: "/newsletters", label: "Newsletters" },
  { path: "/audience", label: "Contacts" },
  { path: "/brand", label: "Brand" },
  { path: "/billing", label: "Billing" },
];

const TIMEZONE_OPTIONS = [
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Toronto",
];

const DEV_USER_PRESETS = [
  {
    key: "leo",
    email: "leo@sansu.ca",
    accountType: "diy_customer" as const,
    label: "Dev: Sign in as leo@sansu.ca (DIY onboarding)",
    resetOnboarding: true,
    postLoginPath: "/diy/onboarding",
  },
  {
    key: "bao",
    email: "bao@sansu.ca",
    accountType: "internal_operator" as const,
    label: "Dev: Sign in as bao@sansu.ca (Admin)",
    resetOnboarding: false,
    postLoginPath: "/",
  },
];

export function TopNav() {
  const [location, setLocation] = useLocation();
  const { user, logout, refreshUser } = useAuth();
  const { toast } = useToast();
  const isDev = import.meta.env.DEV;

  const [accountOpen, setAccountOpen] = useState(false);
  const [accountSaving, setAccountSaving] = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);
  const [devAuthPending, setDevAuthPending] = useState(false);

  const [nameDraft, setNameDraft] = useState("");
  const [timezoneDraft, setTimezoneDraft] = useState("America/Phoenix");
  const [currentPasswordDraft, setCurrentPasswordDraft] = useState("");
  const [newPasswordDraft, setNewPasswordDraft] = useState("");

  const displayName = useMemo(() => user?.name || "Account", [user?.name]);
  const workspaceModeLabel = (user as any)?.accountType === "diy_customer" ? "DIY Workspace" : "Internal Team";
  const isDiy = (user as any)?.accountType === "diy_customer";
  const isInternal = !!user && !isDiy;
  const canSwitchWorkspace = isInternal || isDev;
  const navItems = useMemo(
    () => ((user as any)?.accountType === "diy_customer" ? DIY_NAV_ITEMS : INTERNAL_NAV_ITEMS),
    [user]
  );

  const { data: supportStatus } = useQuery<{ supportClientId: string | null }>({
    queryKey: ["/api/support/status"],
    queryFn: async () => {
      const response = await fetch("/api/support/status", { credentials: "include" });
      if (!response.ok) {
        return { supportClientId: null };
      }
      return response.json();
    },
    enabled: isInternal,
    retry: false,
  });

  const supportModeActive = isInternal && !!supportStatus?.supportClientId;

  const stopSupportModeMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/support/stop-impersonation", {});
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/support/status"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/clients"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/newsletters"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/invoices"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/subscriptions"] }),
      ]);
      setLocation("/");
      toast({ title: "Client workspace closed" });
    },
    onError: (error: Error) => {
      toast({
        title: "Could not close client workspace",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const signInAsDevPreset = async (
    email: string,
    accountType: "internal_operator" | "diy_customer",
    resetOnboarding: boolean,
    postLoginPath: string
  ) => {
    if (devAuthPending) return;
    setDevAuthPending(true);
    try {
      const response = await fetch("/api/auth/dev-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          accountType,
          resetOnboarding,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to switch dev workspace");
      }

      await refreshUser();
      setLocation(postLoginPath);
      toast({
        title: "Dev workspace switched",
        description: `Signed in as ${email}.`,
      });
    } catch (error: any) {
      toast({
        title: "Could not switch dev workspace",
        description: error?.message || "Try again",
        variant: "destructive",
      });
    } finally {
      setDevAuthPending(false);
    }
  };

  useEffect(() => {
    if (!accountOpen || !user) return;
    setNameDraft(user.name || "");
    setTimezoneDraft((user as any).timezone || "America/Phoenix");
    setCurrentPasswordDraft("");
    setNewPasswordDraft("");
  }, [accountOpen, user]);

  const saveAccount = async () => {
    if (!user) return;
    setAccountSaving(true);
    try {
      const payload: Record<string, string> = {
        name: nameDraft.trim(),
        timezone: timezoneDraft,
      };
      if (newPasswordDraft.trim()) {
        payload.currentPassword = currentPasswordDraft;
        payload.newPassword = newPasswordDraft.trim();
      }

      const response = await fetch("/api/auth/account", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(payload),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || "Failed to update account");
      }

      await refreshUser();
      setAccountOpen(false);
      setCurrentPasswordDraft("");
      setNewPasswordDraft("");
      toast({ title: "Account updated" });
    } catch (error: any) {
      toast({
        title: "Could not save account",
        description: error?.message || "Try again.",
        variant: "destructive",
      });
    } finally {
      setAccountSaving(false);
    }
  };

  const switchAccountMode = async () => {
    if (!user || switchingMode) return;
    setSwitchingMode(true);
    try {
      const nextType = isDiy ? "internal_operator" : "diy_customer";
      const response = await apiRequest("POST", "/api/auth/switch-account-type", {
        accountType: nextType,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error((data as any)?.error || "Failed to switch mode");
      }
      await refreshUser();
      setLocation("/");
      toast({ title: isDiy ? "Switched to Team Side" : "Switched to Client Side" });
    } catch (error: any) {
      toast({
        title: "Mode switch failed",
        description: error?.message || "Try again.",
        variant: "destructive",
      });
    } finally {
      setSwitchingMode(false);
    }
  };

  return (
    <>
      <header className="h-12 border-b bg-background sticky top-0 z-50">
        <div className="flex h-full items-center justify-between px-5">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center" data-testid="link-home">
              <img src={logoPath} alt="AgentReach" className="h-5" data-testid="logo-agentreach" />
            </Link>

            <nav className="flex items-center gap-1">
              {navItems.map((item) => {
                const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
                return (
                  <Link key={item.path} href={item.path}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className={cn(
                        isActive
                          ? "border border-border bg-muted text-foreground hover:bg-muted/80 dark:bg-muted/70"
                          : "text-muted-foreground hover:text-foreground hover:bg-muted/70"
                      )}
                      data-testid={`nav-${item.label.toLowerCase()}`}
                    >
                      {item.label}
                    </Button>
                  </Link>
                );
              })}
              {isDev ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="sm" data-testid="button-dev-testing">
                      Testing
                      <ChevronDown className="w-4 h-4 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-72">
                    {DEV_USER_PRESETS.map((preset) => (
                      <DropdownMenuItem
                        key={`testing-${preset.key}`}
                        onClick={() =>
                          signInAsDevPreset(preset.email, preset.accountType, preset.resetOnboarding, preset.postLoginPath)
                        }
                        disabled={devAuthPending}
                        data-testid={`testing-sign-in-${preset.key}`}
                      >
                        <UserCog className="w-4 h-4 mr-2" />
                        {preset.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : null}
            </nav>
          </div>

          <div className="flex items-center gap-3">
            {user ? (
              <span
                className="hidden md:inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
                data-testid="badge-workspace-mode"
              >
                {workspaceModeLabel}
              </span>
            ) : null}
            {supportModeActive ? (
              <span className="hidden md:inline-flex items-center rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-medium text-emerald-800">
                Client Workspace
              </span>
            ) : null}
            {user && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="rounded-full px-3" data-testid="button-user-menu">
                    <span className="text-sm">{displayName}</span>
                    <ChevronDown className="w-4 h-4 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-52">
                  <DropdownMenuItem onClick={() => setAccountOpen(true)} data-testid="menu-account">
                    <UserCircle2 className="w-4 h-4 mr-2" />
                    Account
                  </DropdownMenuItem>
                  {canSwitchWorkspace ? (
                    <DropdownMenuItem onClick={switchAccountMode} disabled={switchingMode} data-testid="menu-switch-side">
                      <Repeat className="w-4 h-4 mr-2" />
                      {switchingMode
                        ? "Switching..."
                        : isDiy
                          ? "Switch to Team Side"
                          : "Switch to Client Side"}
                    </DropdownMenuItem>
                  ) : null}
                  {supportModeActive ? (
                    <DropdownMenuItem
                      onClick={() => stopSupportModeMutation.mutate()}
                      disabled={stopSupportModeMutation.isPending}
                      data-testid="menu-stop-support-mode"
                    >
                      <Repeat className="w-4 h-4 mr-2" />
                      {stopSupportModeMutation.isPending ? "Closing workspace..." : "Exit Client Workspace"}
                    </DropdownMenuItem>
                  ) : null}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={logout} data-testid="menu-logout">
                    <LogOut className="w-4 h-4 mr-2" />
                    Logout
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </header>

      <Dialog open={accountOpen} onOpenChange={setAccountOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Account</DialogTitle>
            <p className="text-sm text-muted-foreground">Update your name, login password, and timezone.</p>
          </DialogHeader>

          <div className="space-y-3 py-1">
            <div className="space-y-1.5">
              <Label htmlFor="account-name">Name</Label>
              <Input id="account-name" value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-email">Login Email</Label>
              <Input id="account-email" value={user?.email || ""} disabled />
            </div>
            <div className="space-y-1.5">
              <Label>Timezone</Label>
              <Select value={timezoneDraft} onValueChange={setTimezoneDraft}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEZONE_OPTIONS.map((tz) => (
                    <SelectItem key={tz} value={tz}>
                      {tz}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-current-password">Current Password</Label>
              <Input
                id="account-current-password"
                type="password"
                value={currentPasswordDraft}
                onChange={(e) => setCurrentPasswordDraft(e.target.value)}
                placeholder="Required only when changing password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="account-new-password">New Password</Label>
              <Input
                id="account-new-password"
                type="password"
                value={newPasswordDraft}
                onChange={(e) => setNewPasswordDraft(e.target.value)}
                placeholder="Leave blank to keep current password"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAccountOpen(false)}>
              Cancel
            </Button>
            <Button onClick={saveAccount} disabled={accountSaving} data-testid="button-save-account">
              {accountSaving ? "Saving..." : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
