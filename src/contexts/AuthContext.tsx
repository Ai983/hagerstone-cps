import React, { createContext, use, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type CpsRole = "requestor" | "procurement_executive" | "procurement_head" | "it_head" | "management" | "finance" | "site_receiver" | "auditor" | "accounts_team" | "design_team";

export interface CpsUser {
  id: string; email: string; name: string; role: CpsRole;
  department?: string; phone?: string; auth_uid: string;
  /** True = blocked from raising new PRs (missed an invoice-upload deadline). Cleared only by a procurement head. */
  pr_blocked?: boolean; pr_blocked_reason?: string | null;
}

interface AuthContextType {
  user: CpsUser | null; loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: any }>;
  signOut: () => Promise<void>;
  canApprove: boolean; canCreateRFQ: boolean; canViewAudit: boolean;
  canViewPrices: boolean; canManageSuppliers: boolean;
  canIssueStock: boolean; canAdjustStock: boolean; canViewStock: boolean;
  isProcurementHead: boolean; isManagement: boolean;
  isEmployee: boolean;
  /**
   * Design Team Head — view-only across all procurement pages, plus the
   * Design acknowledgement on the PR verification gate. Holds NO write
   * permissions (cannot approve, create RFQ, manage suppliers, adjust stock).
   */
  isDesignTeam: boolean;
  /** True = current user is blocked from raising new PRs (missed an invoice-upload deadline). */
  isPrBlocked: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const useAuth = () => {
  const ctx = use(AuthContext);
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
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // NEVER call a supabase method synchronously inside this callback.
      // supabase-js holds an internal auth lock while the callback runs; an
      // awaited supabase call inside loadProfile() (supabase.from(...)) deadlocks
      // that lock, so the JWT never attaches to the request, it goes out as anon,
      // and the session gets dropped — i.e. "logged in for a second, then kicked
      // back to login". Defer the work out of the callback with setTimeout.
      if (event === "SIGNED_OUT" || !session?.user) {
        setUser(null);
        localStorage.removeItem("cps_user");
        return;
      }
      // Only (re)load the profile on a real sign-in. TOKEN_REFRESHED fires on
      // every silent token rotation (~hourly + on tab focus) and must NOT trigger
      // a profile reload — the initial getSession() above already handles restore.
      if (event === "SIGNED_IN") {
        setTimeout(() => {
          loadProfile(session.user.id, session.user.email ?? undefined, session.user.user_metadata?.full_name);
        }, 0);
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
      canViewAudit: role === "auditor" || role === "procurement_head" || role === "it_head" || role === "management" || role === "procurement_executive" || role === "design_team",
      canViewPrices: role !== "requestor" && role !== "site_receiver",
      canManageSuppliers: role === "procurement_head" || role === "it_head" || role === "procurement_executive",
      // Stock permissions — anyone with a role can view. Issue is for site team (receiver/requestor) + procurement.
      // Adjust (corrections, opening stock, thresholds) is procurement-only.
      canViewStock: !!role,
      // design_team has a deliberate stock-write exception (otherwise view-only):
      // she manages Site Stock + Stock Overview after reviewing sites.
      canIssueStock: role === "site_receiver" || role === "requestor" || role === "procurement_executive" || role === "procurement_head" || role === "it_head" || role === "design_team",
      canAdjustStock: role === "procurement_executive" || role === "procurement_head" || role === "it_head" || role === "design_team",
      isProcurementHead: role === "procurement_head" || role === "it_head" || role === "procurement_executive",
      isManagement: role === "management",
      isEmployee: role === "requestor" || role === "site_receiver",
      isDesignTeam: role === "design_team",
      isPrBlocked: user?.pr_blocked === true,
    }}>
      {children}
    </AuthContext.Provider>
  );
};
