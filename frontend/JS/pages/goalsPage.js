// ---- Goals page: things you'd buy anyway, paid for by cutting back (GET /savings-goals) ----
// One card per goal, in queue order (the first is filled first): the bar, what each category gave, the pace,
// the month-by-month detail, the income linked to it (selling the old one), and the purchase once it's made. The maths is all on the server
// (backend/server/services/savingsGoals.js); this file only draws it and sends the buttons' changes.

import { elementById, createElement } from "../core/domHelpers.js";
import { euroFormatter, formatSignedEuros, formatShortDate } from "../core/formatting.js";
import { callApi } from "../core/apiClient.js";
import { appState } from "../core/appState.js";
import { runThenReloadAllData } from "../core/dataRefresh.js";
import { openGoalEditor } from "../dialogs/goalDialog.js";
import { showToast } from "../core/toast.js";
import { createCategoryLabel } from "../core/categoryIcons.js";

const percentFormatter = new Intl.NumberFormat("it-IT", { style: "percent", maximumFractionDigits: 0 });
const monthFormatter = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });
const shortMonthFormatter = new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit" });
const formatMonth = (yearMonth) => shortMonthFormatter.format(new Date(yearMonth + "-15T12:00")); // "Oct 26": the table fits a phone

let goals = [];

export async function loadSavingsGoals() {
  goals = await callApi("/savings-goals");
  renderGoalsPage();
}

const STATUS_LABELS = {
  saving: ["saving", ""],
  reached: ["reached: go get it", "good"],
  bought: ["bought", "good"],
  paying_back: ["paying it back", ""],
  waiting: ["waiting in the queue", ""],
  not_started: ["not started yet", ""],
};

// ---------- the card's parts ----------

// "#1 MacBook  [saving]  ↑ ↓ Edit"
function createCardHead(goal, index) {
  const head = createElement("div", "goal-head");
  const title = createElement("h4", "goal-name");
  title.append(createElement("span", "goal-position", `#${index + 1}`), goal.name);
  const [statusText, statusClass] = STATUS_LABELS[goal.status];
  const statusPill = createElement("span", `status-pill ${statusClass}`, goal.status === "not_started" ? `starts ${formatShortDate(goal.start_date, true)}` : statusText);

  const buttons = createElement("div", "goal-buttons");
  const moveButton = (label, title, offset) => {
    const button = createElement("button", "ghost goal-move", label);
    button.type = "button";
    button.title = title;
    button.disabled = !goals[index + offset];
    button.addEventListener("click", () => moveGoal(index, offset));
    return button;
  };
  const editButton = createElement("button", "ghost", "Edit");
  editButton.type = "button";
  editButton.addEventListener("click", () => openGoalEditor(goal));
  buttons.append(moveButton("↑", "Earlier in the queue: filled first", -1), moveButton("↓", "Later in the queue", 1), editButton);

  head.append(title, statusPill, buttons);
  return head;
}

// "430,00 € of 1.300,00 €  33%" and the bar (empty, with the amount in red, while the total is below zero)
function createProgress(goal) {
  const progress = createElement("div", "goal-progress");
  const amounts = createElement("div", "goal-amounts");
  amounts.append(
    createElement("strong", goal.saved < 0 ? "neg" : "", euroFormatter.format(goal.saved)),
    createElement("span", "hint", ` of ${euroFormatter.format(goal.target)}`
      + (goal.purchase && goal.planned_target !== goal.target ? ` (you planned ${euroFormatter.format(goal.planned_target)})` : "")),
    createElement("span", "goal-share", percentFormatter.format(Math.max(0, goal.share))),
  );
  const track = createElement("div", "goal-track");
  const fill = createElement("span", goal.status === "bought" || goal.status === "reached" ? "done" : "");
  fill.style.width = `${Math.min(100, Math.max(0, goal.share * 100))}%`;
  track.append(fill);
  progress.append(amounts, track);
  return progress;
}

// "Coffee 60 €/month: +40 €  ·  Food 90 €/month: +50 €", and "paying for #1 first" on a category that a goal
// earlier in the queue is still collecting from
function createCategoryLine(goal, index) {
  const line = createElement("p", "goal-categories");
  goal.categories.forEach((category, categoryIndex) => {
    if (categoryIndex) line.append(" · ");
    line.append(createCategoryLabel(category.category_id, category.name), " ", createElement("span", "hint", `${euroFormatter.format(category.monthly_baseline)}/month`), ": ",
      createElement("span", category.saved < 0 ? "neg" : category.saved > 0 ? "pos" : "", formatSignedEuros(category.saved)));
    const earlierIndex = goals.findIndex((other, otherIndex) => otherIndex < index && (other.status === "saving" || other.status === "paying_back")
      && other.categories.some((otherCategory) => otherCategory.category_id === category.category_id));
    if (earlierIndex >= 0) line.append(createElement("span", "hint", ` (paying for #${earlierIndex + 1} first)`));
  });
  return line;
}

// Where it's heading, or what happened
function createOutlook(goal) {
  const outlook = createElement("p", "goal-outlook");
  if (goal.status === "bought") {
    const { purchase } = goal;
    outlook.append(`Bought on ${formatShortDate(purchase.date, true)} for ${euroFormatter.format(purchase.amount)}${purchase.description ? ` (${purchase.description})` : ""}: `,
      createElement("strong", "pos", `cutting back paid ${percentFormatter.format(purchase.share_paid_by_saving)} of it`),
      purchase.share_paid_by_income > 0 ? `, income ${percentFormatter.format(purchase.share_paid_by_income)}` : "", ".");
  } else if (goal.status === "paying_back") {
    const { purchase } = goal;
    outlook.append(`Bought on ${formatShortDate(purchase.date, true)} for ${euroFormatter.format(purchase.amount)}: `,
      createElement("strong", goal.saved > 0 ? "pos" : "", `${euroFormatter.format(Math.max(0, goal.saved))} paid back`),
      ` of ${euroFormatter.format(goal.target)}. `, describePace(goal, "paid back"));
  } else if (goal.status === "reached") {
    outlook.textContent = "Fully paid for by what you didn't spend. When you buy it, link the purchase below.";
  } else if (goal.status === "waiting") {
    outlook.textContent = "Its categories are paying for a goal earlier in the queue: it starts filling when that one is full (or move it up).";
  } else if (goal.status === "not_started") {
    outlook.textContent = `Starts counting on ${formatShortDate(goal.start_date, true)}.`;
  } else {
    outlook.append(describePace(goal, "yours"));
  }
  return outlook;
}

// "About 60 € a month so far: at this pace it's yours in about 9 months (July 2027)."
// done: "yours" while saving for it, "paid back" once it's bought
function describePace(goal, done) {
  if (goal.monthly_pace === null) return "Too early to tell the pace: give it a week.";
  if (goal.monthly_pace <= 0) {
    const part = createElement("span");
    part.append(createElement("span", "neg", `Spending above the baselines so far (${formatSignedEuros(goal.monthly_pace)} a month)`),
      done === "yours" ? ": nothing saved yet." : ": not paying it back yet.");
    return part;
  }
  const months = Math.max(1, Math.round(goal.months_to_go));
  const reachedOn = new Date();
  reachedOn.setMonth(reachedOn.getMonth() + months);
  const when = `${months} month${months === 1 ? "" : "s"} (${monthFormatter.format(reachedOn)})`;
  return `About ${euroFormatter.format(goal.monthly_pace)} a month so far: at this pace it's ${done === "yours" ? `yours in about ${when}` : `paid back in about ${when}`}.`;
}

// "Best case: spending nothing in these categories (150 € a month), it's yours in 3 months (January 2027)."
// Every category at 0, so the whole baseline is saved each month: the fastest it could possibly go.
function createBestCase(goal) {
  const line = createElement("p", "goal-best-case hint");
  const monthlyMaximum = goal.categories.reduce((sum, category) => sum + category.monthly_baseline, 0);
  const left = goal.target - goal.saved;
  if (monthlyMaximum <= 0 || left <= 0) return null;
  const months = Math.max(1, Math.ceil(left / monthlyMaximum));
  const reachedOn = new Date();
  reachedOn.setMonth(reachedOn.getMonth() + months);
  const done = goal.status === "paying_back" ? "paid back" : "yours";
  line.append(createElement("strong", "", "Best case: "),
    `spending nothing in these categories (${euroFormatter.format(monthlyMaximum)} a month), it's ${done} in ${months} month${months === 1 ? "" : "s"} (${monthFormatter.format(reachedOn)}).`);
  return line;
}

// The month-by-month table, folded away
function createMonthDetails(goal) {
  const details = createElement("details", "goal-months");
  details.append(createElement("summary", "", "Month by month"));
  const table = createElement("table");
  const head = createElement("thead");
  const anythingPassedOn = goal.months.some((row) => row.carried_in); // no column (or note) when it would be empty
  const anyIncome = goal.months.some((row) => row.income);
  head.innerHTML = `<tr><th>Month</th><th>Baseline</th><th>Spent</th><th>Saved</th>${anyIncome ? "<th>Income</th>" : ""}${anythingPassedOn ? "<th>Passed on</th>" : ""}</tr>`;
  const body = createElement("tbody");
  for (const row of goal.months) {
    const tableRow = createElement("tr");
    const monthCell = createElement("td", "", formatMonth(row.month));
    if (row.partial) monthCell.append(createElement("small", "hint", " (part)"));
    tableRow.append(
      monthCell,
      createElement("td", "", euroFormatter.format(row.baseline)),
      createElement("td", "", euroFormatter.format(row.spent)),
      createElement("td", row.saved < 0 ? "neg" : "pos", formatSignedEuros(row.saved)),
    );
    if (anyIncome) tableRow.append(createElement("td", row.income ? "pos" : "", row.income ? formatSignedEuros(row.income) : ""));
    if (anythingPassedOn) tableRow.append(createElement("td", "hint", row.carried_in ? formatSignedEuros(row.carried_in) : ""));
    body.append(tableRow);
  }
  table.append(head, body);
  const scroller = createElement("div", "goal-months-scroll"); // a very narrow screen scrolls the table, not the page
  scroller.append(table);
  details.append(scroller);
  if (anythingPassedOn) details.append(createElement("p", "hint small",
    "Passed on: + what a goal before this one collected above its target, − what this one collected above its own and passed to the next."));
  return details;
}

// "Bought it with: [expense ▾] [Link]" (or "Unlink" once linked)
function createPurchaseRow(goal) {
  const row = createElement("div", "goal-purchase");
  if (goal.purchase) {
    const unlinkButton = createElement("button", "ghost", "Unlink the purchase");
    unlinkButton.type = "button";
    unlinkButton.addEventListener("click", () => linkPurchase(goal, null));
    row.append(unlinkButton);
    return row;
  }
  if (goal.status !== "saving" && goal.status !== "reached") return row;
  // the biggest expenses of the last months first: the purchase is rarely a coffee
  const linkedIds = new Set(goals.map((other) => other.purchase?.transaction_id).filter(Boolean));
  const candidates = appState.transactions
    .filter((transaction) => transaction.type === "expense" && !linkedIds.has(transaction.id))
    .slice(0, 200) // newest first already
    .sort((first, second) => second.amount - first.amount)
    .slice(0, 40);
  const picker = createElement("select", "goal-purchase-picker");
  picker.append(new Option(goal.status === "reached" ? "Bought it? Pick the expense…" : "Bought it already? Pick it…", ""));
  for (const transaction of candidates) {
    const label = `${formatShortDate(transaction.date)} · ${euroFormatter.format(transaction.amount)} · ${transaction.description || transaction.category || "expense"}`;
    picker.append(new Option(label, transaction.id));
  }
  const linkButton = createElement("button", "ghost", "Link");
  linkButton.type = "button";
  linkButton.addEventListener("click", () => { if (picker.value) linkPurchase(goal, Number(picker.value)); });
  row.append(picker, linkButton);
  return row;
}

// ---------- income that pays into it (selling the old MacBook) ----------

// "Income: Old MacBook 15 Oct +400 € ×" (× unlinks it) and "[Add income… ▾] [Link]"
function createIncomeRow(goal) {
  const row = createElement("div", "goal-incomes");
  if (goal.incomes.length) {
    const list = createElement("p", "goal-income-list");
    list.append(createElement("span", "hint", "Income: "));
    goal.incomes.forEach((income, index) => {
      if (index) list.append(" · ");
      const unlinkButton = createElement("button", "goal-income-unlink", "×");
      unlinkButton.type = "button";
      unlinkButton.title = "Unlink: it stops counting toward this goal (the income stays)";
      unlinkButton.setAttribute("aria-label", `Unlink ${income.description || "this income"}`);
      unlinkButton.addEventListener("click", () => unlinkIncome(goal, income.transaction_id));
      list.append(`${income.description || income.category || "income"} ${formatShortDate(income.date)} `,
        createElement("span", "pos", formatSignedEuros(income.amount)), unlinkButton);
    });
    row.append(list);
  }

  // the incomes in no goal yet, the biggest of the recent ones first (a sale, rarely a salary)
  const linkedIds = new Set(goals.flatMap((other) => other.incomes.map((income) => income.transaction_id)));
  const candidates = appState.transactions
    .filter((transaction) => transaction.type === "income" && !linkedIds.has(transaction.id))
    .slice(0, 200) // newest first already
    .sort((first, second) => second.amount - first.amount)
    .slice(0, 40);
  if (!candidates.length) return row;
  const linking = createElement("div", "goal-purchase");
  const picker = createElement("select", "goal-purchase-picker");
  picker.append(new Option("Sold something for it? Pick the income…", ""));
  for (const transaction of candidates) {
    const label = `${formatShortDate(transaction.date)} · ${euroFormatter.format(transaction.amount)} · ${transaction.description || transaction.category || "income"}`;
    picker.append(new Option(label, transaction.id));
  }
  const linkButton = createElement("button", "ghost", "Link");
  linkButton.type = "button";
  linkButton.addEventListener("click", () => { if (picker.value) linkIncome(goal, Number(picker.value)); });
  linking.append(picker, linkButton);
  row.append(linking);
  return row;
}

function createGoalCard(goal, index) {
  const card = createElement("article", `goal-card ${goal.status}`);
  card.append(createCardHead(goal, index), createProgress(goal), createCategoryLine(goal, index), createOutlook(goal));
  if (["saving", "paying_back", "waiting", "not_started"].includes(goal.status)) {
    const bestCase = createBestCase(goal);
    if (bestCase) card.append(bestCase);
  }
  card.append(createIncomeRow(goal), createPurchaseRow(goal));
  if (goal.months.length) card.append(createMonthDetails(goal));
  return card;
}

// ---------- changes ----------

function moveGoal(index, offset) {
  const order = goals.map((goal) => goal.id);
  [order[index], order[index + offset]] = [order[index + offset], order[index]];
  runThenReloadAllData(() => callApi("/savings-goals/order", { method: "PUT", body: { goal_ids: order } }));
}

function linkIncome(goal, transactionId) {
  runThenReloadAllData(() => callApi(`/savings-goals/${goal.id}/incomes`, { method: "POST", body: { transaction_id: transactionId } }));
}

function unlinkIncome(goal, transactionId) {
  runThenReloadAllData(() => callApi(`/savings-goals/${goal.id}/incomes/${transactionId}`, { method: "DELETE" }));
}

function linkPurchase(goal, transactionId) {
  runThenReloadAllData(() => callApi(`/savings-goals/${goal.id}/purchase`, { method: "PUT", body: { transaction_id: transactionId } }));
}

// ---------- "Is this the MacBook?" ----------

// A new expense close to a goal's target (70% – 130%, at least 50 €) is probably the thing itself: offer to link
// it right away, before the goal counts it as spending in its categories. Called by the transaction dialog.
const LINK_OFFER_SHARE = 0.3;
const LINK_OFFER_MINIMUM_EUROS = 50;
const LINK_OFFER_MILLISECONDS = 20000;
export function offerToLinkPurchase(transactionId, transaction) {
  if (transaction.type !== "expense" || !(transaction.amount >= LINK_OFFER_MINIMUM_EUROS)) return;
  const candidates = goals.filter((goal) => !goal.purchase && (goal.status === "saving" || goal.status === "reached")
    && Math.abs(transaction.amount - goal.target) <= goal.target * LINK_OFFER_SHARE);
  if (candidates.length !== 1) return; // none, or too unsure which
  const [goal] = candidates;
  showToast(`Is this the ${goal.name}? Link it to the goal`, [
    { label: "Link it", onClick: () => linkPurchase(goal, transactionId) },
    { label: "No", onClick: () => {} },
  ], LINK_OFFER_MILLISECONDS);
}

// ---------- the page ----------

export function renderGoalsPage() {
  elementById("goals-empty").hidden = goals.length > 0;
  // the open "Month by month" panels stay open across reloads
  const openPanels = new Set([...elementById("goals-list").querySelectorAll("details[open]")].map((details) => details.closest("[data-goal-id]")?.dataset.goalId));
  elementById("goals-list").replaceChildren(...goals.map((goal, index) => {
    const card = createGoalCard(goal, index);
    card.dataset.goalId = goal.id;
    if (openPanels.has(String(goal.id))) card.querySelector("details")?.setAttribute("open", "");
    return card;
  }));
}
