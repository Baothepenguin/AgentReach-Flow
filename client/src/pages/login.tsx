import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import logoPath from "@assets/Logo_Colored_Trans_1770505643619.png";

const loginSchema = z.object({
  email: z.string().email("Valid email required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const registerSchema = loginSchema.extend({
  name: z.string().min(2, "Name must be at least 2 characters"),
});

type LoginForm = z.infer<typeof loginSchema>;
type RegisterForm = z.infer<typeof registerSchema>;

export default function LoginPage() {
  const { login, register } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("login");

  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: "", password: "" },
  });

  const registerForm = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: { email: "", password: "", name: "" },
  });

  const handleLogin = async (data: LoginForm) => {
    setIsLoading(true);
    try {
      await login(data.email, data.password);
      toast({ title: "Welcome back!" });
    } catch (error) {
      toast({
        title: "Login failed",
        description: error instanceof Error ? error.message : "Invalid credentials",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleRegister = async (data: RegisterForm) => {
    setIsLoading(true);
    try {
      await register(data.email, data.password, data.name);
      toast({ title: "Account created!" });
    } catch (error) {
      toast({
        title: "Registration failed",
        description: error instanceof Error ? error.message : "Could not create account",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src={logoPath} alt="AgentReach" className="h-10 mx-auto" data-testid="logo-agentreach-login" />
          <p className="text-sm text-muted-foreground mt-1">Newsletter Production System</p>
        </div>
        <Card>
          <Tabs value={activeTab} onValueChange={setActiveTab}>
            <CardHeader className="pb-4">
              <TabsList className="w-full">
                <TabsTrigger value="login" className="flex-1" data-testid="tab-login">
                  Sign In
                </TabsTrigger>
                <TabsTrigger value="register" className="flex-1" data-testid="tab-register">
                  Register
                </TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent>
              <TabsContent value="login" className="mt-0">
                <Form {...loginForm}>
                  <form onSubmit={loginForm.handleSubmit(handleLogin)} className="space-y-4">
                    <FormField
                      control={loginForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="email"
                              placeholder="you@example.com"
                              data-testid="input-login-email"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={loginForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="password"
                              placeholder="Enter password"
                              data-testid="input-login-password"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={isLoading}
                      data-testid="button-login"
                    >
                      {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Sign In
                    </Button>
                  </form>
                </Form>
              </TabsContent>
              <TabsContent value="register" className="mt-0">
                <Form {...registerForm}>
                  <form onSubmit={registerForm.handleSubmit(handleRegister)} className="space-y-4">
                    <FormField
                      control={registerForm.control}
                      name="name"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Full Name</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              placeholder="John Smith"
                              data-testid="input-register-name"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="email"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Email</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="email"
                              placeholder="you@example.com"
                              data-testid="input-register-email"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={registerForm.control}
                      name="password"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Password</FormLabel>
                          <FormControl>
                            <Input
                              {...field}
                              type="password"
                              placeholder="Create password"
                              data-testid="input-register-password"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={isLoading}
                      data-testid="button-register"
                    >
                      {isLoading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                      Create Account
                    </Button>
                  </form>
                </Form>
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>
        <p className="text-center text-xs text-muted-foreground mt-6">
          Internal use only. Contact admin for access.
        </p>
      </div>
    </div>
  );
}
