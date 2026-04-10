import React, { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Building2, Loader2, ShieldCheck, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";

export default function Login() {
  const [mode, setMode] = useState<"login" | "register">("login");

  // Sign-in state
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState("");

  // Register state
  const [fullName, setFullName] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [regLoading, setRegLoading] = useState(false);

  const [googleLoading, setGoogleLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showRegPassword, setShowRegPassword] = useState(false);

  const { signIn, user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => { if (user) navigate("/dashboard"); }, [user]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true); setLoginError("");
    const { error: err } = await signIn(email, password);
    if (err) {
      setLoginError(err.message || "Invalid credentials");
      setLoginLoading(false);
    } else navigate("/dashboard");
  };

  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/dashboard`,
          queryParams: { access_type: "offline", prompt: "consent" },
        },
      });
      if (error) throw error;
      // Supabase redirects automatically on success
    } catch (error: any) {
      toast.error(error.message || "Google sign-in failed");
      setGoogleLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (regPassword !== confirmPassword) {
      toast.error("Passwords don't match");
      return;
    }
    if (regPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setRegLoading(true);
    try {
      const { error } = await supabase.auth.signUp({
        email: registerEmail,
        password: regPassword,
        options: { data: { full_name: fullName } },
      });
      // DO NOT insert into cps_users here — the DB trigger handles it
      if (error) {
        toast.error(error.message);
        return;
      }
      toast.success("Account created! You can now sign in.");
      setMode("login");
    } catch (err: any) {
      toast.error(err.message || "Registration failed");
    } finally {
      setRegLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center">
              <Building2 className="h-9 w-9 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-foreground">Hagerstone International</h1>
          <p className="text-muted-foreground text-sm">Centralised Procurement System</p>
        </div>

        <Card className="shadow-lg border-border">
          <Tabs value={mode} onValueChange={(v) => setMode(v as "login" | "register")}>
            <CardHeader className="pb-0">
              <TabsList className="w-full">
                <TabsTrigger value="login" className="flex-1">Sign In</TabsTrigger>
                <TabsTrigger value="register" className="flex-1">Register</TabsTrigger>
              </TabsList>
            </CardHeader>
            <CardContent className="pt-6">
              <TabsContent value="login" className="mt-0">
                <form onSubmit={handleSignIn} className="space-y-4">
                  {loginError && (
                    <div className="text-sm text-destructive bg-destructive/10 border border-destructive/20 p-3 rounded-md">
                      {loginError}
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="email">Email</Label>
                    <Input id="email" type="email" placeholder="you@hagerstone.com" value={email} onChange={e => setEmail(e.target.value)} required autoFocus />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="password">Password</Label>
                    <div className="relative">
                      <Input id="password" type={showPassword ? "text" : "password"} placeholder="Enter your password" value={password} onChange={e => setPassword(e.target.value)} required className="pr-10" />
                      <button type="button" onClick={() => setShowPassword(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={loginLoading}>
                    {loginLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Signing in...</> : "Sign In"}
                  </Button>
                </form>

                <div className="relative my-4">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs">
                    <span className="bg-card px-2 text-muted-foreground">or</span>
                  </div>
                </div>

                <Button
                  variant="outline"
                  className="w-full"
                  onClick={handleGoogleSignIn}
                  disabled={googleLoading || loginLoading}
                >
                  {googleLoading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <img src="/google-icon.svg" className="h-4 w-4 mr-2" alt="Google" />
                  )}
                  Sign in with Google
                </Button>
              </TabsContent>

              <TabsContent value="register" className="mt-0">
                <form onSubmit={handleRegister} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="fullName">Full Name</Label>
                    <Input id="fullName" type="text" placeholder="Your full name" value={fullName} onChange={e => setFullName(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="regEmail">Email</Label>
                    <Input id="regEmail" type="email" placeholder="you@example.com" value={registerEmail} onChange={e => setRegisterEmail(e.target.value)} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="regPassword">Password</Label>
                    <div className="relative">
                      <Input id="regPassword" type={showRegPassword ? "text" : "password"} placeholder="Min 6 characters" value={regPassword} onChange={e => setRegPassword(e.target.value)} required minLength={6} className="pr-10" />
                      <button type="button" onClick={() => setShowRegPassword(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                        {showRegPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="confirmPassword">Confirm Password</Label>
                    <Input id="confirmPassword" type="password" placeholder="Repeat your password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} required />
                  </div>
                  <Button type="submit" className="w-full" disabled={regLoading}>
                    {regLoading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creating account...</> : "Create Account"}
                  </Button>
                </form>
              </TabsContent>
            </CardContent>
          </Tabs>
        </Card>

        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Zero corruption · Best rates · Full auditability</span>
        </div>
      </div>
    </div>
  );
}
