// ---- the Home page's three groups of the net worth: liquid, investments, immobilized ----
// The server already splits the net worth into four liquidity classes (GET /net-worth -> by_liquidity, see
// backend/config/accountKinds.js). The Home page shows a simpler picture of three groups, from most to least liquid:
//
//   liquid       cash, current and savings accounts + restricted cash (meal vouchers): real money you can spend
//                now. Vouchers only buy some things, so the card names their share instead of hiding it.
//   investments  ETFs and stocks at today's prices: a few days to turn into money, at that day's price
//   immobilized  personal-use assets (the car): only money once sold, at a price you can only estimate
//
// No imports and no page access, so the tests can load it in Node.

// { liquid, restrictedPartOfLiquid, investments, immobilized, netWorth } in euros; the three groups add up to netWorth
export function splitNetWorthIntoGroups(netWorthResponse) {
  const classes = netWorthResponse.by_liquidity ?? {};
  const restrictedPartOfLiquid = classes.restricted ?? 0;
  return {
    liquid: (classes.cash_and_equivalents ?? 0) + restrictedPartOfLiquid,
    restrictedPartOfLiquid,
    investments: classes.investments ?? netWorthResponse.investments_value ?? 0,
    immobilized: classes.personal_use ?? 0,
    netWorth: netWorthResponse.net_worth,
  };
}

// Width of each bar segment, in percent. A negative group (an overdrawn account) can't be drawn as a piece of the
// bar, so it counts as 0 there; the card still shows its real (negative) amount.
export function calculateBarWidths(groups) {
  const parts = { liquid: Math.max(0, groups.liquid), investments: Math.max(0, groups.investments), immobilized: Math.max(0, groups.immobilized) };
  const total = parts.liquid + parts.investments + parts.immobilized;
  const percentOf = (part) => (total > 0 ? (part / total) * 100 : 0);
  return { liquid: percentOf(parts.liquid), investments: percentOf(parts.investments), immobilized: percentOf(parts.immobilized) };
}
