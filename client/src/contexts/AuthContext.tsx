import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import type { User } from "@shared/schema";

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  register: (
    email: string,
    password: string,
    name: string,
    accountType?: "internal_operator" | "diy_customer"
  ) => Promise<void>;
  refreshUser: () => Promise<void>;
}

function getDevLoginPayload(): Record<string, unknown> {
  if (!import.meta.env.DEV || typeof window === "undefined") return {};
  const params = new URLSearchParams(window.location.search);
  const email = params.get("dev_email")?.trim().toLowerCase();
  const accountType = params.get("dev_account_type")?.trim();
  const resetOnboarding = params.get("dev_reset_onboarding") === "1";

  const payload: Record<string, unknown> = {};
  if (email) payload.email = email;
  if (accountType) payload.accountType = accountType;
  if (resetOnboarding) payload.resetOnboarding = true;
  return payload;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  async function checkAuth() {
    try {
      // In development, auto-login as dev user
      if (import.meta.env.DEV) {
        const devRes = await fetch("/api/auth/dev-login", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(getDevLoginPayload()),
        });
        if (devRes.ok) {
          const data = await devRes.json();
          setUser(data.user);
          setIsLoading(false);
          return;
        }
      }
      
      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      }
    } catch (error) {
      console.error("Auth check failed:", error);
    } finally {
      setIsLoading(false);
    }
  }

  async function refreshUser() {
    await checkAuth();
  }

  async function login(email: string, password: string) {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Login failed");
    }
    const data = await res.json();
    setUser(data.user);
  }

  async function register(
    email: string,
    password: string,
    name: string,
    accountType: "internal_operator" | "diy_customer" = "diy_customer"
  ) {
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, name, accountType }),
    });
    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || "Registration failed");
    }
    const data = await res.json();
    setUser(data.user);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout, register, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
