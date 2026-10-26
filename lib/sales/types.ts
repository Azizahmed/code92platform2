import type {DealSource, DealStage, DealType, Ownership} from '@/lib/sales/stages';

// Row of public.deal_overview.
export type DealRow = {
  id: string;
  account_id: string;
  account_name: string;
  name: string;
  type: DealType;
  product_id: string | null;
  product_name: string | null;
  owner_id: string;
  owner_name: string | null;
  stage: DealStage;
  value_amount: number | null;
  currency: string;
  expected_close: string | null;
  next_action: string | null;
  next_action_date: string | null;
  next_action_updated_at: string;
  source: DealSource | null;
  stage_changed_at: string;
  closed_at: string | null;
  close_reason: string | null;
  created_at: string;
  updated_at: string;
  is_open: boolean;
  is_stale: boolean;
};

export const DEAL_OVERVIEW_COLUMNS =
  'id, account_id, account_name, name, type, product_id, product_name, owner_id, owner_name, stage, value_amount, currency, expected_close, next_action, next_action_date, next_action_updated_at, source, stage_changed_at, closed_at, close_reason, created_at, updated_at, is_open, is_stale';

// Row of public.account_overview.
export type AccountRow = {
  id: string;
  name: string;
  sector: string | null;
  city: string | null;
  owner_id: string;
  owner_name: string | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  open_deals: number;
  total_deals: number;
  customer_of_count: number;
};

export const ACCOUNT_OVERVIEW_COLUMNS =
  'id, name, sector, city, owner_id, owner_name, notes, archived_at, created_at, updated_at, open_deals, total_deals, customer_of_count';

export type Contact = {
  id: string;
  account_id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  is_primary: boolean;
};

export type DealActivity = {
  id: string;
  deal_id: string;
  actor_id: string | null;
  kind: 'created' | 'stage_change' | 'field_change' | 'note';
  from_stage: DealStage | null;
  to_stage: DealStage | null;
  reason: string | null;
  body: string | null;
  meta: {field: string; from: string | null; to: string | null} | null;
  created_at: string;
};

export type Engagement = {
  id: string;
  account_id: string;
  deal_id: string | null;
  name: string;
  ownership: Ownership;
  started_at: string;
  notes: string | null;
};

export type MemberOption = {userId: string; displayName: string};
export type ProductOption = {id: string; name: string};

// Sum of values per currency (a deal's currency defaults to KWD).
export function sumByCurrency(deals: Pick<DealRow, 'value_amount' | 'currency'>[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const deal of deals) {
    if (deal.value_amount === null) continue;
    totals.set(deal.currency, (totals.get(deal.currency) ?? 0) + Number(deal.value_amount));
  }
  return [...totals.entries()].sort((a, b) => b[1] - a[1]);
}

export function formatMoney(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      maximumFractionDigits: amount >= 1000 ? 0 : undefined
    }).format(amount);
  } catch {
    return `${amount.toLocaleString(locale)} ${currency}`;
  }
}
