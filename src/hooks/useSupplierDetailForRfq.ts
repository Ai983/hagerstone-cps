import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { SupplierDetailPayload } from "@/types/supplierDetail";

/**
 * Fetches the structured detail payload for one supplier in the context of
 * one RFQ. Backed by the Postgres function `supplier_detail_for_rfq`.
 */
export function useSupplierDetailForRfq(
  rfqId: string | undefined,
  supplierId: string | undefined,
) {
  return useQuery({
    queryKey: ["supplier-detail-for-rfq", rfqId, supplierId],
    enabled: !!rfqId && !!supplierId,
    queryFn: async (): Promise<SupplierDetailPayload> => {
      const { data, error } = await supabase.rpc("supplier_detail_for_rfq", {
        p_rfq_id: rfqId,
        p_supplier_id: supplierId,
      });
      if (error) throw error;
      if (data && typeof data === "object" && "error" in (data as object)) {
        throw new Error((data as { error: string }).error);
      }
      return data as SupplierDetailPayload;
    },
    staleTime: 60_000,
  });
}
