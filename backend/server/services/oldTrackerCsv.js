/* READING THE OLD TRACKER (the spreadsheet used before netto, exported as CSV, ";" separated, Italian numbers)
 * Pure parsing: no database, no decisions. services/oldTrackerImport.js decides what becomes what.
 *
 * The export is one sheet after another, each starting with a title line:
 *   "2026: Tabella 1"        the year's summary: one row per item, one column per month ("2025" = the year before,
 *                            i.e. the value at the start of the year). From it: "Cash - Liquidity", and "Material
 *                            goods" (the car) with the rows under it.
 *   "INV: Tabella 1"         per ticker: price, average price (APP), number of shares held (N. Pos) each month
 *   "JAN: Table 1" … "DEC"   the month's transactions: day; amount; category; ; description; income category,
 *                            and on the right the month's totals per category (label; value), used as a check
 *   "JAN: ASSETS CHANGE" …   money moved to investments or to the car: day; amount; from; to
 * Other sheets (SPE-INC, NW TOTAL…) are summaries and are ignored.
 */

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// "1.234,56" / "0,6" / "1087" / "39,265" -> cents (rounded); "" -> null
function parseItalianAmountToCents(text) {
  const cleaned = String(text ?? "").trim().replace(/\./g, "").replace(",", ".");
  if (cleaned === "" || !Number.isFinite(Number(cleaned))) return null;
  return Math.round(Number(cleaned) * 100);
}

// "53" / "0,007817" -> number
function parseItalianNumber(text) {
  const cleaned = String(text ?? "").trim().replace(/\./g, "").replace(",", ".");
  return cleaned === "" || !Number.isFinite(Number(cleaned)) ? null : Number(cleaned);
}

const padTwoDigits = (number) => String(number).padStart(2, "0");

// Splits the file into its sheets: [{ title, lines: [[cells]] }]
function splitIntoSheets(text) {
  const sheets = [];
  let current = null;
  for (const rawLine of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const titleMatch = rawLine.match(/^([^;]+): (Tabella|Table) 1$|^([A-Z]{3}): ASSETS CHANGE$/);
    if (titleMatch) {
      current = { title: rawLine.trim(), lines: [] };
      sheets.push(current);
      continue;
    }
    if (current && rawLine.trim() !== "") current.lines.push(rawLine.split(";"));
  }
  return sheets;
}

// The summary sheet: "Cash - Liquidity" at the start of the year, and the material goods rows
function readSummary(sheet) {
  const header = sheet.lines.find((cells) => cells[0] === "Asset/Liability");
  const rowNamed = (name) => sheet.lines.find((cells) => cells[0].trim() === name);
  const monthValues = (cells) => Object.fromEntries(MONTH_NAMES.map((month, index) => [month, parseItalianAmountToCents(cells[index + 2])]));
  const cash = rowNamed("Cash - Liquidity");
  // the rows between "Material goods" and "Cash - Liquidity" are the goods themselves (Polo, Vespa)
  const goodsStart = sheet.lines.findIndex((cells) => cells[0].trim() === "Material goods");
  const goodsEnd = sheet.lines.findIndex((cells) => cells[0].trim() === "Cash - Liquidity");
  const materialGoods = goodsStart >= 0 && goodsEnd > goodsStart
    ? sheet.lines.slice(goodsStart + 1, goodsEnd).map((cells) => ({ name: cells[0].trim(), startOfYear: parseItalianAmountToCents(cells[1]), byMonth: monthValues(cells) }))
    : [];
  return {
    hasHeader: Boolean(header),
    cashAtStartOfYear: cash ? parseItalianAmountToCents(cash[1]) : null,
    materialGoods,
  };
}

// The INV sheet: per ticker, shares held at the start of the year and at the end of each month
function readInvestments(sheet) {
  const tickers = [];
  let current = null;
  for (const cells of sheet.lines) {
    const label = cells[0].trim();
    if (/^[A-Z0-9]+[.-][A-Z]+$/.test(label)) { // "SWDA.MI", "BTC-EUR"
      current = { ticker: label, sharesAtStartOfYear: null, sharesByMonth: {} };
      tickers.push(current);
    } else if (current && label === "N. Pos") {
      current.sharesAtStartOfYear = parseItalianNumber(cells[1]);
      MONTH_NAMES.forEach((month, index) => { current.sharesByMonth[month] = parseItalianNumber(cells[index + 2]); });
    }
  }
  return tickers;
}

// A month sheet: its transactions, and its own totals per category (the right-hand columns)
function readMonth(sheet, monthIndex, year) {
  const month = MONTH_NAMES[monthIndex];
  const transactions = [];
  const totals = {};
  sheet.lines.forEach((cells, lineIndex) => {
    if (cells[0] === "Date") return; // header
    const label = (cells[6] ?? "").trim();
    const total = parseItalianAmountToCents(cells[7]);
    if (label && total !== null) totals[label] = total;
    const day = Number(cells[0]);
    const amount = parseItalianAmountToCents(cells[1]);
    if (!Number.isInteger(day) || day < 1 || day > 31 || !amount) return;
    transactions.push({
      key: `${month}-${lineIndex}`, // stable: the same file always gives the same keys (the preview's choices refer to them)
      date: `${year}-${padTwoDigits(monthIndex + 1)}-${padTwoDigits(day)}`,
      amount,
      category: (cells[2] ?? "").trim(),
      description: (cells[4] ?? "").trim(),
      incomeCategory: (cells[5] ?? "").trim(),
    });
  });
  return { month, transactions, totals };
}

// An ASSETS CHANGE sheet: "2;111,69;Cash;MSCI WORLD;"
function readAssetChanges(sheet, monthIndex, year) {
  return sheet.lines
    .filter((cells) => cells[0] !== "Date" && Number.isInteger(Number(cells[0])) && Number(cells[0]) >= 1 && parseItalianAmountToCents(cells[1]))
    .map((cells) => ({
      date: `${year}-${padTwoDigits(monthIndex + 1)}-${padTwoDigits(Number(cells[0]))}`,
      month: MONTH_NAMES[monthIndex],
      amount: parseItalianAmountToCents(cells[1]),
      from: (cells[2] ?? "").trim(),
      to: (cells[3] ?? "").trim(),
      description: (cells[4] ?? "").trim(),
    }));
}

// The whole file. Throws (with a message for the page) when it doesn't look like the old tracker at all.
function parseOldTrackerCsv(text) {
  const sheets = splitIntoSheets(String(text ?? ""));
  const summarySheet = sheets.find((sheet) => /^\d{4}: (Tabella|Table) 1$/.test(sheet.title));
  if (!summarySheet) throw new Error("This doesn't look like the old tracker: no \"2026: Tabella 1\" sheet at the top.");
  const year = Number(summarySheet.title.slice(0, 4));

  const months = [];
  const assetChanges = [];
  for (const sheet of sheets) {
    const monthMatch = sheet.title.match(/^([A-Z]{3}): (Tabella 1|Table 1|ASSETS CHANGE)$/);
    const monthIndex = monthMatch ? MONTH_NAMES.indexOf(monthMatch[1]) : -1;
    if (monthIndex < 0) continue;
    if (monthMatch[2] === "ASSETS CHANGE") assetChanges.push(...readAssetChanges(sheet, monthIndex, year));
    else months.push(readMonth(sheet, monthIndex, year));
  }
  if (!months.some((month) => month.transactions.length)) throw new Error("No transactions found in the month sheets (JAN: Table 1, …).");

  const investmentSheet = sheets.find((sheet) => sheet.title.startsWith("INV:"));
  return {
    year,
    summary: readSummary(summarySheet),
    investments: investmentSheet ? readInvestments(investmentSheet) : [],
    months,
    assetChanges,
  };
}

module.exports = { parseOldTrackerCsv, parseItalianAmountToCents, MONTH_NAMES };
