// ---- Forecast > FIRE number: the money that would let you live off it (the "fire" part of GET /forecast) ----
// FIRE number = yearly expenses ÷ withdrawal rate (backend/server/services/fireNumber.js explains the idea and the
// rate). Shown in today's euros, with how much of it you have now and the month the forecast reaches it.
// The rate (slider) and which expenses to use (chips) are settings stored with your data: changing one reloads
// the forecast. Only cash and investments count towards it, never the car.

import { elementById, createElement, highlightSelectedChip } from "../core/domHelpers.js";
import { wholeEuroFormatter } from "../core/formatting.js";
import { saveAppSetting } from "../core/appSettings.js";

const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 2 });
const shareFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 0 });
const formatMonthYear = (date) => new Date(date + "T00:00").toLocaleDateString("it-IT", { month: "long", year: "numeric" });

// The chart's dashed line: the FIRE number from today on, in the money the chart is showing (in future euros it
// grows with inflation, because your expenses will cost more euros then too). Null when there's no FIRE number.
export function getFireLineValues(forecast, moneyView) {
  const fireNumber = forecast.fire?.fire_number;
  if (!fireNumber) return null;
  return {
    label: "FIRE number",
    className: "fire",
    values: [...forecast.history.map(() => null), ...forecast.forecast.map((point) => (moneyView === "real" ? fireNumber : fireNumber * point.deflator))],
  };
}

function createCard(title, value, detail, className = "") {
  const card = createElement("div", "card");
  card.append(title, createElement("strong", className, value), createElement("small", "", detail));
  return card;
}

export function renderFireNumber(forecast) {
  const fire = forecast.fire;
  if (!fire) return;
  const rateSlider = elementById("fc-fire-rate");
  if (document.activeElement !== rateSlider) rateSlider.value = fire.withdrawal_rate;
  elementById("fc-fire-rate-value").textContent = percentFormatter.format(fire.withdrawal_rate);
  highlightSelectedChip(elementById("fc-fire-expenses"), fire.expenses_from);
  elementById("fc-fire-from-phase").textContent = `${fire.last_phase.name}: ${wholeEuroFormatter.format(fire.last_phase.yearly_expenses)} a year`;
  const lastTwelveChip = elementById("fc-fire-from-last-12");
  lastTwelveChip.disabled = !fire.last_12_months;
  lastTwelveChip.textContent = fire.last_12_months
    ? `Last ${fire.last_12_months.months_of_data === 12 ? "12 months" : `${fire.last_12_months.months_of_data} months (as a year)`}: ${wholeEuroFormatter.format(fire.last_12_months.yearly_expenses)} a year`
    : "Last 12 months: no complete month yet";

  if (fire.fire_number === null) {
    elementById("fc-fire-cards").replaceChildren(createCard("FIRE number", "—", "no expenses to cover: add a phase with its monthly expenses"));
    return;
  }
  const yearsShown = forecast.years;
  elementById("fc-fire-cards").replaceChildren(
    createCard("FIRE number", wholeEuroFormatter.format(fire.fire_number),
      `${wholeEuroFormatter.format(fire.yearly_expenses)} a year ÷ ${percentFormatter.format(fire.withdrawal_rate)} · today's euros`),
    createCard("You have", shareFormatter.format(fire.share_now),
      `${wholeEuroFormatter.format(fire.counted_now)} of cash and investments (the car doesn't count)`),
    fire.reached_on
      ? createCard("Reached", formatMonthYear(fire.reached_on), "when the forecast's cash + investments get there, in today's euros", "pos")
      : createCard("Reached", "Not yet", `not within the ${yearsShown} years shown, with this plan and return`),
  );
}

export function initializeFireNumber({ reloadForecast }) {
  const saveThenReload = async (key, value) => {
    try {
      await saveAppSetting(key, value);
      elementById("fc-error").textContent = "";
    } catch (error) {
      elementById("fc-error").textContent = error.message;
    }
    reloadForecast();
  };
  const rateSlider = elementById("fc-fire-rate");
  rateSlider.addEventListener("input", () => { elementById("fc-fire-rate-value").textContent = percentFormatter.format(Number(rateSlider.value)); });
  rateSlider.addEventListener("change", () => saveThenReload("fire_withdrawal_rate", Number(rateSlider.value)));
  elementById("fc-fire-expenses").addEventListener("click", (event) => {
    const chip = event.target.closest("button[data-value]");
    if (!chip || chip.disabled) return;
    saveThenReload("fire_expenses_from_last_12_months", chip.dataset.value === "last_12_months" ? 1 : 0);
  });
}
