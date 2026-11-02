// Risk tier: how strict a product's releases are. Moved here from the retired
// lifecycle module, which is the only place it used to live.
//
// Mirrors the CHECK on products.risk_tier and product_releases.risk_tier. The
// database is authoritative; change both together.

export const RISK_TIERS = ['low', 'medium', 'high'] as const;
export type RiskTier = (typeof RISK_TIERS)[number];

export function isRiskTier(value: string): value is RiskTier {
  return (RISK_TIERS as readonly string[]).includes(value);
}
