import { Link, useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import logoPath from "@assets/Logo_Colored_Trans_1770505643619.png";

const navItems = [
  { path: "/", label: "Dashboard" },
  { path: "/clients", label: "Clients" },
  { path: "/orders", label: "Orders" },
  { path: "/subscriptions", label: "Subscriptions" },
  { path: "/newsletters", label: "Newsletters" },
  { path: "/branding-kits", label: "Branding Kits" },
];

export function TopNav() {
  const [location] = useLocation();
  const { user, logout } = useAuth();

  return (
    <header className="h-12 border-b bg-background sticky top-0 z-50">
      <div className="flex h-full items-center justify-between px-5">
        <div className="flex items-center gap-8">
          <Link href="/" className="flex items-center" data-testid="link-home">
            <img src={logoPath} alt="AgentReach" className="h-7" data-testid="logo-agentreach" />
          </Link>
          
          <nav className="flex items-center gap-1">
            {navItems.map((item) => {
              const isActive = location === item.path || (item.path !== "/" && location.startsWith(item.path));
              return (
                <Link key={item.path} href={item.path}>
                  <Button
                    variant={isActive ? "secondary" : "ghost"}
                    size="sm"
                    className={cn(!isActive && "text-muted-foreground")}
                    data-testid={`nav-${item.label.toLowerCase()}`}
                  >
                    {item.label}
                  </Button>
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          {user && (
            <div className="flex items-center gap-3">
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
