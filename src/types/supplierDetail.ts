/**
 * Payload returned by the Postgres function `supplier_detail_for_rfq`.
 * The plain-language strings in `why_suggested_bullets` and `risks` are
 * written by the backend and must be rendered verbatim — do not transform.
 */
export interface SupplierDetailPayload {
  supplier: {
    id: string;
    name: string;
    phone: string | null;
    email: string | null;
    city: string | null;
    regions: string[];
    categories: string[];
    performance_score: number | null;
    win_rate: number | null;
    status: string;
    last_invited_at: string | null;
  };
  rfq: {
    id: string;
    rfq_number: string;
    target_category: string | null;
    project_site: string | null;
  };
  match: {
    score: number;
    matched_on: string;
    exact_item_count: number;
    category_match: boolean;
    region_match: boolean;
    is_fresh: boolean;
    win_rate_review_flag: boolean;
  };
  why_suggested_bullets: { text: string }[];
  rate_history_on_rfq_items: Array<{
    item_name: string;
    last_rate: number | null;
    previous_rate: number | null;
    best_rate: number | null;
    avg_rate: number | null;
    rate_trend: "up" | "down" | "stable" | "new" | null;
    last_date: string | null;
    quote_count: number | null;
  }>;
  recent_activity: {
    rfqs_last_5: Array<{
      rfq_number: string;
      invited_at: string;
      response_status: string | null;
    }>;
    last_po_date: string | null;
    total_pos: number;
    total_quotes: number;
  };
  risks: Array<{
    level: "warn" | "danger";
    message: string;
  }>;
}
