import { Link, useLocation } from "wouter";
import { Users, Mail, Receipt, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";

const navItems = [
  { path: "/", label: "Dashboard", icon: LayoutGrid },
  { path: "/clients", label: "Clients", icon: Users },
  { path: "/orders", label: "Orders", icon: Receipt },
  { path: "/newsletters", label: "Newsletters", icon: Mail },
];

export function TopNav() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  return (
    <header className="h-14 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
      <div className="flex h-full items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2" data-testid="link-home">
            <span className="hidden sm:inline font-serif font-bold text-xl bg-gradient-to-r from-primary to-emerald-600 bg-clip-text text-transparent drop-shadow-[0_0_8px_rgba(26,95,74,0.3)]">AgentReach Flow</span>
          </Link>
          
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
              return (
                <Link key={item.path} href={item.path}>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    size="sm"
                    className={cn(
                      "gap-2",
                      isActive && "bg-secondary"
                    )}
                    data-testid={`nav-${item.label.toLowerCase()}`}
                  >
                    <item.icon className="w-4 h-4" />
                    <span className="hidden md:inline">{item.label}</span>
                  </Button>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          {user && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground hidden sm:inline">{user.name}</span>
              <Button variant="ghost" size="sm" onClick={logout} data-testid="button-logout">
                Logout
              </Button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
