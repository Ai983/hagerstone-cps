import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * One ranked supplier suggestion for an RFQ, returned by the
 * `suggest_suppliers_for_rfq` Postgres function. Scored by proven history →
 * category match → region match, with anti-corruption flags.
 */
export interface SuggestedSupplier {
  supplier_id: string;
  supplier_name: string;
  score: number;
  matched_on: string | null;
  exact_item_count: number;
  category_match: boolean;
  region_match: boolean;
  is_fresh: boolean;
  performance_score: number | null;
  win_rate: number | null;
  win_rate_review_flag: boolean;
  last_invited_at: string | null;
}

/**
 * Fetches ranked supplier suggestions for an RFQ.
 *
 * Calls `resolve_rfq_category` first (idempotent — auto-fills the RFQ category
 * only when it is NULL, never overwrites a human pick), then
 * `suggest_suppliers_for_rfq` for the ranked list. Both functions are owned by
 * the backend team — do not recreate or modify them.
 */
export function useSuggestedSuppliers(rfqId: string | undefined, limit = 15) {
  return useQuery({
    queryKey: ["suggested-suppliers", rfqId, limit],
    enabled: !!rfqId,
    queryFn: async (): Promise<SuggestedSupplier[]> => {
      if (!rfqId) return [];
      // 1. Resolve/auto-fill the RFQ category (idempotent; never overwrites a human pick)
      const { error: catErr } = await supabase.rpc("resolve_rfq_category", {
        p_rfq_id: rfqId,
      });
      if (catErr) console.warn("resolve_rfq_category failed:", catErr.message);

      // 2. Get ranked suggestions
      const { data, error } = await supabase.rpc("suggest_suppliers_for_rfq", {
        p_rfq_id: rfqId,
        p_limit: limit,
      });
      if (error) throw error;
      return (data ?? []) as SuggestedSupplier[];
    },
    staleTime: 60_000,
  });
}
