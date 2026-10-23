// ---- netto expenses: the one page, Expenses.html ----
// Type the amount, tap a category, Salva: an expense dated today, taken from the edition's one account
// (backend/server/services/expensesEditionSetup.js). After saving, "Annulla" deletes it again for a while, in case
// of a typo. Nothing is kept on the phone: when the server can't be reached the page says so and keeps what was typed.

import { createCategoryIcon } from "../core/categoryIcons.js";
import { visibleEuroFormatter, getTodayAsLocalDate } from "../core/formatting.js";

const UNDO_SECONDS = 30;

const form = document.getElementById("expense-form");
const amountField = document.getElementById("expense-amount");
const dateLine = document.getElementById("expense-date");
const categoryButtons = document.getElementById("expense-categories");
const problemLine = document.getElementById("expense-problem");
const saveButton = document.getElementById("expense-save");
const savedMessage = document.getElementById("expense-saved");
const savedText = document.getElementById("expense-saved-text");
const undoButton = document.getElementById("expense-undo");

let accountId = null;
let chosenCategory = null;
let lastSavedId = null;
let hideSavedMessageTimer = null;

const isOther = (category) => category.name.trim().toLowerCase() === "altro";

async function callServer(method, path, body) {
  const response = await fetch(path, {
    method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw new Error(`${method} ${path} answered ${response.status}`);
  return response.status === 204 ? null : response.json();
}

// "12,50", "12.50", "12" -> 12.5; anything else (empty, letters, "1.234,5", zero or less) -> null
function readAmount(text) {
  const cleaned = text.trim().replace(/\s|€/g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const amount = Number(cleaned);
  return amount > 0 ? amount : null;
}

const showProblem = (text) => { problemLine.textContent = text; problemLine.hidden = !text; };

function writeToday() {
  const today = new Date().toLocaleDateString("it-IT", { weekday: "long", day: "numeric", month: "long" });
  dateLine.textContent = `Oggi, ${today}`;
}

function chooseCategory(category, button) {
  chosenCategory = category;
  categoryButtons.querySelectorAll("button").forEach((other) => other.setAttribute("aria-checked", String(other === button)));
  showProblem("");
}

function drawCategoryButtons(categories) {
  categoryButtons.replaceChildren(...categories.map((category) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "category-button";
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", "false");
    const name = document.createElement("span");
    name.textContent = category.name;
    button.append(createCategoryIcon(category, "category-icon"), name);
    button.addEventListener("click", () => chooseCategory(category, button));
    return button;
  }));
}

async function loadAccountAndCategories() {
  try {
    const [accounts, categories] = await Promise.all([callServer("GET", "/accounts"), callServer("GET", "/categories")]);
    accountId = accounts.find((account) => !account.closed_at)?.id ?? null;
    // in alphabetical order (the server's), "Altro" last
    const expenseCategories = categories.filter((category) => category.kind === "expense");
    drawCategoryButtons([...expenseCategories.filter((category) => !isOther(category)), ...expenseCategories.filter(isOther)]);
  } catch {
    categoryButtons.replaceChildren();
    showProblem("Non riesco a collegarmi. Controlla internet e riapri la pagina.");
  }
}

function clearForm() {
  amountField.value = "";
  chosenCategory = null;
  categoryButtons.querySelectorAll("button").forEach((button) => button.setAttribute("aria-checked", "false"));
}

function showSaved(amount, categoryName) {
  savedText.textContent = `${visibleEuroFormatter.format(amount)} · ${categoryName}`;
  savedMessage.hidden = false;
  undoButton.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
  clearTimeout(hideSavedMessageTimer);
  hideSavedMessageTimer = setTimeout(() => { savedMessage.hidden = true; lastSavedId = null; }, UNDO_SECONDS * 1000);
}

async function saveExpense(event) {
  event.preventDefault();
  const amount = readAmount(amountField.value);
  if (amount === null) { showProblem("Scrivi quanto hai speso, per esempio 12,50."); amountField.focus(); return; }
  if (!chosenCategory) { showProblem("Tocca per cosa hai speso."); return; }
  if (accountId === null) { showProblem("Non riesco a collegarmi. Controlla internet e riapri la pagina."); return; }

  amountField.blur(); // puts the keyboard away, so the message below can be seen
  saveButton.disabled = true;
  showProblem("");
  try {
    const { id } = await callServer("POST", "/transactions", {
      type: "expense", amount, from_account_id: accountId, category_id: chosenCategory.id, date: getTodayAsLocalDate(),
    });
    lastSavedId = id;
    showSaved(amount, chosenCategory.name);
    clearForm();
  } catch {
    showProblem("Non salvato: non riesco a collegarmi. Riprova tra poco.");
  } finally {
    saveButton.disabled = false;
  }
}

async function undoLastExpense() {
  if (lastSavedId === null) return;
  undoButton.disabled = true;
  try {
    await callServer("DELETE", `/transactions/${lastSavedId}`);
    lastSavedId = null;
    clearTimeout(hideSavedMessageTimer);
    savedText.textContent = "niente, l'ho cancellata";
    undoButton.hidden = true;
    hideSavedMessageTimer = setTimeout(() => { savedMessage.hidden = true; }, 4000);
  } catch {
    showProblem("Non riesco a cancellarla adesso. Riprova tra poco.");
  } finally {
    undoButton.disabled = false;
  }
}

amountField.addEventListener("input", () => showProblem(""));
form.addEventListener("submit", saveExpense);
undoButton.addEventListener("click", undoLastExpense);
writeToday();
loadAccountAndCategories();
