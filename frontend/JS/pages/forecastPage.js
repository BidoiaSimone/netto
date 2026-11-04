// ---- Forecast page: where net worth is heading (GET /forecast) ----
// Key numbers on top (net worth in 1, 2, 5, 10 years, the lowest cash point, the runway), warnings when cash
// runs out, and the chart: the real past on the left of "today", the forecast on the right, with a band for
// a 0% and an 8% return. The plan behind it (phases, events, assumptions) is edited in forecastPlanEditor.js;
// every change there answers with the whole new forecast, which is drawn here.
//
// Amounts can be shown in today's euros (each future amount ÷ the inflation since today: what it could buy at
// today's prices) or in the euros of each future month. Today's euros is the default: "200,000 € in 2036" means
// little until you know what it buys.

import { elementById, createElement, highlightSelectedChip } from "../core/domHelpers.js";
import { euroFormatter, wholeEuroFormatter } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { drawStackedAreaChart } from "../charts/stackedAreaChart.js";
import { renderForecastPlan, initializeForecastPlanEditor } from "./forecastPlanEditor.js";
import { renderFireNumber, initializeFireNumber, getFireLineValues } from "./fireNumber.js";
import { t, tp, dateLocale } from "../core/i18n.js";

const REDRAW_DELAY_AFTER_RESIZE_MILLISECONDS = 150;
const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 1 });

let forecast = null;                 // the last answer of GET /forecast (or of a change to the plan)
let moneyView = readSavedSetting("forecastMoneyView", "real"); // "real" | "nominal"
let yearsShown = Number(readSavedSetting("forecastYears", "10"));

function readSavedSetting(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function saveSetting(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

// "mar 2028"
const formatMonthYear = (date) => new Date(date + "T00:00").toLocaleDateString(dateLocale, { month: "short", year: "numeric" });

// A forecast amount in the chosen money: nominal as it is, or divided by the inflation up to its month
const inChosenMoney = (amount, deflator = 1) => (moneyView === "real" ? amount / deflator : amount);

export async function loadForecast() {
  showForecast(await callApi(`/forecast?years=${yearsShown}`));
}

// Called with every new forecast (a load, or the answer to a change in the plan)
export function showForecast(newForecast) {
  forecast = newForecast;
  renderForecastPlan(forecast);
  renderForecastResults();
}

// ---------- key numbers and warnings ----------

function createKeyNumberCard(title, value, detail, className = "") {
  const card = createElement("div", "card");
  card.append(title, createElement("strong", className, value), createElement("small", "", detail));
  return card;
}

function renderKeyNumbers() {
  const todayPoint = forecast.forecast[0];
  const netWorthCards = forecast.key_numbers.net_worth_in.map((point) => {
    const value = inChosenMoney(point.net_worth, point.deflator);
    const change = value - todayPoint.net_worth;
    return createKeyNumberCard(tp(point.years, "In {count} year", "In {count} years"), wholeEuroFormatter.format(value),
      `${t("{amount} from today", { amount: `${change >= 0 ? "+" : "−"}${wholeEuroFormatter.format(Math.abs(change))}` })} · ${formatMonthYear(point.date)}`, change < 0 ? "neg" : "");
  });

  const lowestCash = forecast.key_numbers.lowest_cash;
  const lowestCashPoint = forecast.forecast.find((point) => point.date === lowestCash.date);
  const lowestCashCard = createKeyNumberCard(t("Lowest cash"), wholeEuroFormatter.format(inChosenMoney(lowestCash.value, lowestCashPoint?.deflator)),
    lowestCash.date === forecast.today ? t("today: it only grows from here") : formatMonthYear(lowestCash.date), lowestCash.value <= 0 ? "neg" : "");

  const runway = forecast.key_numbers.runway;
  const runwayCard = runway.months === null
    ? createKeyNumberCard(t("Runway"), "∞", runway.phase_name ? t("{name} brings in more than it costs", { name: t(runway.phase_name) }) : t("no phase yet"))
    : createKeyNumberCard(t("Runway"), t("{count} months", { count: runway.months.toLocaleString("it-IT", { maximumFractionDigits: 1 }) }),
      t("{liquid} cash + investments ÷ {deficit} a month short ({name})", { liquid: wholeEuroFormatter.format(runway.liquid_now), deficit: euroFormatter.format(runway.monthly_deficit), name: t(runway.phase_name) }),
      runway.months < 12 ? "neg" : "");

  elementById("fc-key-numbers").replaceChildren(...netWorthCards, lowestCashCard, runwayCard);
}

function renderWarnings() {
  const { cash_runs_out: cashRunsOut, investments_run_out: investmentsRunOut, largest_shortfall: largestShortfall } = forecast.warnings;
  const warnings = [];
  if (cashRunsOut) {
    warnings.push(createElement("p", "fc-warning", t("Your cash runs out in {month}: from then, investments are sold to cover what's missing.", { month: formatMonthYear(cashRunsOut.date) })));
  }
  if (investmentsRunOut) {
    warnings.push(createElement("p", "fc-warning danger",
      t("Investments run out too in {month}: after that you'd be short, up to {amount} (in that month's euros).", { month: formatMonthYear(investmentsRunOut.date), amount: wholeEuroFormatter.format(largestShortfall) })));
  }
  const pastEvents = forecast.events.filter((event) => event.is_past);
  if (pastEvents.length) {
    warnings.push(createElement("p", "fc-warning muted", t("Not counted, already past: {list}. Move them to a future month or delete them.", { list: pastEvents.map((event) => event.name).join(", ") })));
  }
  elementById("fc-warnings").replaceChildren(...warnings);
}

// ---------- chart ----------

function renderChart() {
  const chartBox = elementById("fc-chart");
  const history = forecast.history, future = forecast.forecast;
  const dates = [...history.map((point) => point.date), ...future.map((point) => point.date)];
  const valuesOf = (field) => [...history.map((point) => point[field]), ...future.map((point) => inChosenMoney(point[field], point.deflator))];
  const showBand = elementById("fc-show-band").checked;
  const bandOf = (bandValues) => [...history.map(() => null), ...bandValues.map((value, index) => inChosenMoney(value, future[index].deflator))];

  drawStackedAreaChart(chartBox, dates, [
    { name: t("Cash"), values: valuesOf("cash"), className: "fc-cash" },
    { name: t("Investments"), values: valuesOf("investments"), className: "fc-investments" },
    { name: t("Personal use"), values: valuesOf("personal_use"), className: "fc-personal-use" },
  ], t("Net worth"), {
    forecastFromIndex: history.length,
    band: showBand ? { low: bandOf(forecast.band.low), high: bandOf(forecast.band.high), label: t("{low} – {high} return", { low: percentFormatter.format(forecast.band.low_return), high: percentFormatter.format(forecast.band.high_return) }) } : null,
    referenceLine: getFireLineValues(forecast, moneyView),
  });
  elementById("fc-band-label").textContent = t("{low} – {high} return", { low: percentFormatter.format(forecast.band.low_return), high: percentFormatter.format(forecast.band.high_return) });
}

function renderForecastResults() {
  if (!forecast) return;
  highlightSelectedChip(elementById("fc-money-view"), moneyView);
  highlightSelectedChip(elementById("fc-years"), String(yearsShown));
  renderKeyNumbers();
  renderWarnings();
  renderFireNumber(forecast, moneyView);
  renderChart();
}

// ---------- buttons ----------

export function initializeForecastPage() {
  elementById("fc-money-view").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip) return;
    moneyView = chip.dataset.value;
    saveSetting("forecastMoneyView", moneyView);
    renderForecastResults();
  });
  elementById("fc-years").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip) return;
    yearsShown = Number(chip.dataset.value);
    saveSetting("forecastYears", String(yearsShown));
    loadForecast().catch((error) => { elementById("fc-error").textContent = error.message; });
  });
  elementById("fc-show-band").addEventListener("change", renderChart);
  initializeForecastPlanEditor({ getYearsShown: () => yearsShown, onForecastChanged: showForecast });
  initializeFireNumber({ reloadForecast: () => loadForecast().catch((error) => { elementById("fc-error").textContent = error.message; }) });

  // drawn at the real pixel size: redraw when the window (or the page) changes size
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => forecast && renderChart(), REDRAW_DELAY_AFTER_RESIZE_MILLISECONDS);
  });
  window.addEventListener("hashchange", () => { if (location.hash === "#forecast" && forecast) setTimeout(renderChart); });
}
