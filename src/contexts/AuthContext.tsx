import React, { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CpsRole = "requestor" | "procurement_executive" | "procurement_head" | "it_head" | "management" | "finance" | "site_receiver" | "auditor";

export interface CpsUser {
  id: string; email: string; name: string; role: CpsRole;
  department?: string; phone?: string; auth_uid: string;
}

interface AuthContextType {
  user: CpsUser | null; loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  canApprove: boolean; canCreateRFQ: boolean; canViewAudit: boolean;
  canViewPrices: boolean; canManageSuppliers: boolean;
  isProcurementHead: boolean; isManagement: boolean;
  isEmployee: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
};

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [user, setUser] = useState<CpsUser | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = async (authUid: string, email?: string, displayName?: string) => {
    // 1. Try by auth_uid
    const { data, error } = await supabase.from("cps_users").select("*").eq("auth_uid", authUid).maybeSingle();
    if (!error && data) {
      setUser(data as CpsUser);
      localStorage.setItem("cps_user", JSON.stringify(data));
      return;
    }
    // 2. Fallback: look up by email (e.g. pre-created account or new signup before trigger links auth_uid)
    if (email) {
      const { data: userByEmail } = await supabase.from("cps_users").select("*").eq("email", email).maybeSingle();
      if (userByEmail) {
        if (!userByEmail.auth_uid) {
          await supabase.from("cps_users").update({ auth_uid: authUid }).eq("id", userByEmail.id);
        }
        const linked = { ...userByEmail, auth_uid: authUid };
        setUser(linked as CpsUser);
        localStorage.setItem("cps_user", JSON.stringify(linked));
        return;
      }
    }
    // 3. Auto-create profile for new Google / OAuth sign-ins with no existing record
    if (email) {
      const name = displayName || email.split("@")[0];
      const { data: newProfile } = await supabase
        .from("cps_users")
        .insert({ auth_uid: authUid, email, name, role: "requestor", active: true })
        .select()
        .single();
      if (newProfile) {
        setUser(newProfile as CpsUser);
        localStorage.setItem("cps_user", JSON.stringify(newProfile));
      }
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem("cps_user");
    if (saved) { try { setUser(JSON.parse(saved)); } catch {} }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) loadProfile(session.user.id, session.user.email ?? undefined, session.user.user_metadata?.full_name);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) loadProfile(session.user.id, session.user.email ?? undefined, session.user.user_metadata?.full_name);
      else {
        setUser(null);
        localStorage.removeItem("cps_user");
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const signIn = async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { error };
    if (data.user) await loadProfile(data.user.id, data.user.email ?? undefined);
    return { error: null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    localStorage.removeItem("cps_user");
  };

  const role = user?.role;
  return (
    <AuthContext.Provider value={{
      user, loading, signIn, signOut,
      canApprove: role === "procurement_head" || role === "it_head" || role === "management" || role === "procurement_executive",
      canCreateRFQ: role === "procurement_executive" || role === "procurement_head" || role === "it_head",
      canViewAudit: role === "auditor" || role === "procurement_head" || role === "it_head" || role === "management" || role === "procurement_executive",
      canViewPrices: role !== "requestor" && role !== "site_receiver",
      canManageSuppliers: role === "procurement_head" || role === "it_head" || role === "procurement_executive",
      isProcurementHead: role === "procurement_head" || role === "it_head" || role === "procurement_executive",
      isManagement: role === "management",
      isEmployee: role === "requestor" || role === "site_receiver",
    }}>
      {children}
    </AuthContext.Provider>
  );
};
