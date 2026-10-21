/* WHERE THE MONEY WENT, AS FLOWS (Statements > Money flows: the Sankey diagram). Pure maths, no database.
 *
 *   left (where it came from)          middle          right (where it went)
 *   income, by category        ─┐                  ┌─ expenses, by category
 *   investments sold (net)     ─┼──  money in  ───┼─ into investments (net)
 *   taken from savings         ─┘                  └─ left as savings
 *
 * Every left box flows into the middle and the middle flows out to every right box, so each band is simply one
 * amount. The two sides always add up to the same total, because the last box of each side closes the gap:
 *
 *   savings = income − expenses − net money into investments
 *   savings > 0  "left as savings" on the right          savings < 0  "taken from savings" on the left
 *   (during the master's, spending more than you earn is normal: that's the left box, not an error)
 *
 * "Into investments" is the cash that left your accounts for trades minus what sales paid back into them (the cash
 * side of the trades). Shares recorded without an account ("opening positions") moved no cash and aren't in it.
 * Movements between your own accounts and reconciliations aren't income or spending, so they aren't flows either.
 *
 * Small categories: a category smaller than SMALL_CATEGORY_SHARE of its side's total is put together with the
 * others like it into one "Other" box, when there are at least two of them. Twenty 3-pixel slivers can't be read
 * or tapped; one "Other (7 categories)" can, and its detail lists them. The totals don't change.
 *
 * Everything in cents.
 */

const SMALL_CATEGORY_SHARE = 0.03; // under 3% of the income (or of the spending) -> "Other"

// rows: [{ category_id, name, total }] (cents). Returns the boxes of one side, small ones grouped.
function groupSmallCategories(rows, kind, otherLabel) {
  const sideTotal = rows.reduce((sum, row) => sum + row.total, 0);
  const isSmall = (row) => sideTotal > 0 && row.total < sideTotal * SMALL_CATEGORY_SHARE;
  const smallRows = rows.filter(isSmall);
  const keptRows = smallRows.length >= 2 ? rows.filter((row) => !isSmall(row)) : rows;
  const boxes = keptRows.map((row) => ({ key: `${kind}-${row.category_id ?? "none"}`, label: row.name, amount: row.total, kind, category_id: row.category_id }));
  if (smallRows.length >= 2) {
    boxes.push({
      key: `${kind}-other`, label: `${otherLabel} (${smallRows.length} categories)`, amount: smallRows.reduce((sum, row) => sum + row.total, 0), kind,
      category_id: null, grouped: smallRows.map((row) => ({ name: row.name, amount: row.total })),
    });
  }
  return boxes.filter((box) => box.amount > 0).sort((first, second) => second.amount - first.amount);
}

// incomeRows / expenseRows: the income statement's categories (cents); investmentCash: the period's cash side of the
// trades, + into the accounts (sales), − out of them (buys). Returns { sources, uses, total } in cents.
function buildSankeyFlows({ incomeRows, expenseRows, investmentCash }) {
  const totalIncome = incomeRows.reduce((sum, row) => sum + row.total, 0);
  const totalExpenses = expenseRows.reduce((sum, row) => sum + row.total, 0);
  const netIntoInvestments = -investmentCash;
  const savings = totalIncome - totalExpenses - netIntoInvestments;

  const sources = groupSmallCategories(incomeRows, "income", "Other income");
  if (netIntoInvestments < 0) sources.push({ key: "investments-sold", label: "Investments sold", amount: -netIntoInvestments, kind: "investments" });
  if (savings < 0) sources.push({ key: "from-savings", label: "Taken from savings", amount: -savings, kind: "savings" });

  const uses = groupSmallCategories(expenseRows, "expense", "Other expenses");
  if (netIntoInvestments > 0) uses.push({ key: "into-investments", label: "Into investments", amount: netIntoInvestments, kind: "investments" });
  if (savings > 0) uses.push({ key: "left-as-savings", label: "Left as savings", amount: savings, kind: "savings" });

  return { sources, uses, total: sources.reduce((sum, box) => sum + box.amount, 0), totalIncome, totalExpenses, netIntoInvestments, savings };
}

module.exports = { SMALL_CATEGORY_SHARE, buildSankeyFlows };
