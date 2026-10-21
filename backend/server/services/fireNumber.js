/* THE FIRE NUMBER (Forecast page): how much money would let you live off it. Pure maths, no database.
 *
 *   FIRE number = yearly expenses ÷ safe withdrawal rate
 *
 * "Financial Independence, Retire Early": if you take out the same share of your money every year (the withdrawal
 * rate) and that covers your expenses, the money should last for good. 30.000 € a year at 3.5% needs 857.143 €.
 * The US "4% rule" comes from US stock and bond returns over 30-year retirements; European markets did worse
 * historically, the euro investor pays more fees and taxes, and an early retirement lasts longer than 30 years,
 * so 3–3.5% is the usual, more careful choice here. The rate is a setting (Forecast page slider).
 *
 * Expenses: either your plan's last phase (the life you're planning for, e.g. "Working") or what you really spent
 * in the last 12 months. Both are in today's euros, so the FIRE number is too.
 *
 * What counts towards it: cash (vouchers included, like everywhere in the forecast) and investments. NOT the car
 * or other personal-use assets: you can't live off a car's value without selling it, and then it's cash anyway.
 *
 * When the forecast reaches it: the first month where cash + investments, in today's euros (÷ the inflation since
 * today), is at least the FIRE number. Comparing in today's euros is the same as letting the FIRE number grow with
 * inflation: your expenses will cost more euros in ten years too.
 */

// Cents in, cents out; null when there's nothing to divide
function calculateFireNumber(yearlyExpensesInCents, withdrawalRate) {
  if (!(withdrawalRate > 0) || !(yearlyExpensesInCents > 0)) return null;
  return Math.round(yearlyExpensesInCents / withdrawalRate);
}

// points: the forecast's months [{ date, cash, investments, deflator }] (cents, nominal). Returns the first point
// whose cash + investments in today's euros reaches the FIRE number, or null within the horizon.
function findWhenFireNumberIsReached(points, fireNumberInCents) {
  if (fireNumberInCents === null) return null;
  return points.find((point) => (point.cash + point.investments) / point.deflator >= fireNumberInCents) ?? null;
}

module.exports = { calculateFireNumber, findWhenFireNumberIsReached };
