/* ITALIAN TAX RATES used for the estimates on the Statements page (services/italianTaxEstimates.js)
 * They are ESTIMATES next to your real figures: netto doesn't know what your broker or bank actually withheld.
 * Each rate says where it comes from and when it was last checked. Check them again when a new year's budget
 * law (legge di bilancio) comes out, and update `lastChecked` when you do.
 *
 * Checked on 14 Oct 2026 against:
 *   - QuiFinanza, "Imposta di bollo e Ivafe sui prodotti finanziari, aliquote e novità fiscali del 2026" (5 Jul 2026)
 *     https://quifinanza.it/fisco-tasse/imposta-bollo-ivafe-prodotti-finanziari-2026/1005389/
 *   - Tuttocalcolato, "Imposta di bollo conto corrente e titoli 2026" (20 Feb 2026): "Nel 2026 le regole non sono cambiate"
 *     https://tuttocalcolato.it/blog/imposta-bollo-conto-corrente-titoli-2026/
 *   - Money.it, "Hai più di 5.000€ sul conto?" (1 May 2026)
 *     https://www.money.it/hai-piu-di-5000eur-sul-conto-ecco-quanto-ti-costa-ogni-anno-e-come-evitarlo
 *   - Moneyviz, "Tassazione ETF 2026" (16 Aug 2026): ETF gains stay at 26%; the new 33% is for crypto only
 *     https://blog.moneyviz.it/tassazione-etf-2026-plusvalenze-minusvalenze-730-modello-redditi/
 */

const ITALIAN_TAX_RATES = {
  lastChecked: "2026-10-14",

  // Imposta di bollo on financial products (conto titoli: ETFs, shares, bonds), individuals.
  // 0.2% a year of the market value at the end of each reporting period, prorated to its length; no minimum,
  // no maximum for individuals (the 14,000 € cap is for companies only).
  // Law: DPR 642/1972, Tariffa parte I, art. 13, comma 2-ter.
  stampDutyOnSecuritiesYearlyRate: 0.002,

  // Imposta di bollo on current accounts and libretti di risparmio, individuals: 34.20 € a year, due only when the
  // average balance (giacenza media) of the period is above 5,000 €. The threshold counts every current account and
  // libretto with the same holder at the same bank together. Shorter statements (e.g. quarterly) pay the matching share.
  // Law: DPR 642/1972, Tariffa parte I, art. 13, comma 2-bis, note 3-bis.
  stampDutyOnCurrentAccountsYearlyAmountInCents: 3420,
  stampDutyOnCurrentAccountsThresholdInCents: 500000,

  // Tax on financial income (capital gains, dividends, ETF proceeds): 26%.
  // Gains on harmonised (UCITS) ETFs such as EIMI.MI, SWDA.MI, VWCE.MI are "redditi di capitale": each gain is taxed
  // on its own and ETF losses can't offset them (an ETF loss is a "reddito diverso", usable for 4 years only against
  // gains on shares, bonds, ETCs, certificates). Government bonds (and the part of a fund invested in them) pay 12.5%:
  // not modelled, these ETFs hold shares.
  // Law: DL 66/2014, art. 3 (26% since 1 Jul 2014).
  capitalGainsTaxRate: 0.26,
};

module.exports = { ITALIAN_TAX_RATES };
