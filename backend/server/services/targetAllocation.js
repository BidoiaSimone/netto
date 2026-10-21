/* TARGET ALLOCATION: how far each investment is from its target, and where new money should go. Pure maths.
 *
 * Shares and drift. With V = the value of everything held:
 *   current share   value / V
 *   drift           current share − target share, in percentage points: SWDA at 74% with a 70% target = +4 points
 *                   (overweight); in euros, value − target share × V: how much above (+) or below (−) its target
 *
 * Where new money goes, WITHOUT SELLING ("water-filling"). Selling to rebalance would make the gains taxable (26%),
 * so the calculator only ever buys. Picture each fund as a glass whose size is its target: SWDA at 70% is a big
 * glass, EIMI at 15% a small one. How full a glass is = value / target share. New money is poured into the emptiest
 * glass first, until it's as full as the next emptiest, then into both, and so on, keeping the glasses being filled
 * always at the same level. When the money runs out, every fund that got some is equally "full", the others were
 * already above that level, and nothing was taken from anyone. With enough money everyone reaches its target exactly.
 *
 * Every amount here is in euro cents (integers), so the buys add up to exactly the money you put in.
 */

const BASIS_POINTS_IN_ONE = 10000; // 70% = 7000 basis points

// holdings: [{ ticker, valueInCents }]; targetBasisPointsByTicker: Map ticker -> 7000.
// Returns one row per ticker held or targeted: { ticker, valueInCents, currentShare, targetShare, driftPoints, driftInCents },
// biggest target first. A ticker with no target has targetShare 0 (its whole share is drift).
function describeAllocation(holdings, targetBasisPointsByTicker) {
  const valueByTicker = new Map(holdings.map((holding) => [holding.ticker, holding.valueInCents]));
  const totalValueInCents = holdings.reduce((sum, holding) => sum + holding.valueInCents, 0);
  const tickers = [...new Set([...targetBasisPointsByTicker.keys(), ...valueByTicker.keys()])];
  return tickers.map((ticker) => {
    const valueInCents = valueByTicker.get(ticker) ?? 0;
    const targetShare = (targetBasisPointsByTicker.get(ticker) ?? 0) / BASIS_POINTS_IN_ONE;
    const currentShare = totalValueInCents > 0 ? valueInCents / totalValueInCents : 0;
    return {
      ticker,
      valueInCents,
      currentShare,
      targetShare,
      driftPoints: totalValueInCents > 0 ? (currentShare - targetShare) * 100 : 0,
      driftInCents: Math.round(valueInCents - targetShare * totalValueInCents),
    };
  }).sort((first, second) => second.targetShare - first.targetShare || second.valueInCents - first.valueInCents || first.ticker.localeCompare(second.ticker));
}

// Splits `newMoneyInCents` over the targeted tickers by water-filling (see the top of the file).
// Returns [{ ticker, amountInCents }] for every targeted ticker (0 for those that get nothing), biggest buy first.
// No targets: [] (there is nothing to aim for).
function splitNewMoneyWithoutSelling(holdings, targetBasisPointsByTicker, newMoneyInCents) {
  const valueByTicker = new Map(holdings.map((holding) => [holding.ticker, holding.valueInCents]));
  const glasses = [...targetBasisPointsByTicker]
    .filter(([, basisPoints]) => basisPoints > 0)
    .map(([ticker, basisPoints]) => {
      const targetShare = basisPoints / BASIS_POINTS_IN_ONE;
      const valueInCents = valueByTicker.get(ticker) ?? 0;
      return { ticker, targetShare, valueInCents, fullness: valueInCents / targetShare };
    })
    .sort((first, second) => first.fullness - second.fullness);
  if (!glasses.length || !(newMoneyInCents > 0)) return glasses.map((glass) => ({ ticker: glass.ticker, amountInCents: 0 }));

  // The level the k emptiest glasses can all be filled to with the money: every one of them ends at
  // targetShare × level, so Σ (targetShare × level − value) = money -> level = (money + Σ value) / Σ targetShare.
  // The right k is the first whose level doesn't reach the next glass (that one was already fuller).
  let level = 0;
  let filledCount = 0;
  let valueSum = 0, targetShareSum = 0;
  for (let index = 0; index < glasses.length; index++) {
    valueSum += glasses[index].valueInCents;
    targetShareSum += glasses[index].targetShare;
    level = (newMoneyInCents + valueSum) / targetShareSum;
    filledCount = index + 1;
    const nextGlass = glasses[index + 1];
    if (!nextGlass || level <= nextGlass.fullness) break;
  }

  // Exact amounts are fractions of a cent: round down, then hand the cents left over to the largest remainders
  const exactAmounts = glasses.map((glass, index) => (index < filledCount ? Math.max(0, glass.targetShare * level - glass.valueInCents) : 0));
  const amountsInCents = exactAmounts.map(Math.floor);
  let centsLeft = newMoneyInCents - amountsInCents.reduce((sum, amount) => sum + amount, 0);
  const byLargestRemainder = exactAmounts.map((amount, index) => ({ index, remainder: amount - Math.floor(amount) }))
    .filter(({ index }) => index < filledCount)
    .sort((first, second) => second.remainder - first.remainder);
  for (let position = 0; centsLeft > 0 && byLargestRemainder.length; position = (position + 1) % byLargestRemainder.length, centsLeft--) {
    amountsInCents[byLargestRemainder[position].index]++;
  }

  return glasses
    .map((glass, index) => ({ ticker: glass.ticker, amountInCents: amountsInCents[index] }))
    .sort((first, second) => second.amountInCents - first.amountInCents || first.ticker.localeCompare(second.ticker));
}

module.exports = { BASIS_POINTS_IN_ONE, describeAllocation, splitNewMoneyWithoutSelling };
