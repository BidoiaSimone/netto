// ---- Next up page: a to do list, stored in the database (see backend/server/routes/todoRoutes.js) ----

import { elementById, createElement } from "../core/domHelpers.js";
import { callApi } from "../core/apiClient.js";
import { showErrorMessage } from "../core/errorBanner.js";

const SLIDE_OUT_TIMEOUT_MILLISECONDS = 400;
const userPrefersReducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

let todos = [];                  // the list as the server last sent it
let todoIdToAnimateIn = null;    // the item to slide in on the next render

// Loads the list. The first time, the list this browser used to keep (localStorage) is moved into
// the database; the browser copy is kept under "todoList-moved" instead of being thrown away.
export async function loadTodos() {
  todos = await callApi("/todos");
  let listKeptByBrowser = null;
  try { listKeptByBrowser = JSON.parse(localStorage.getItem("todoList")); } catch {}
  if (Array.isArray(listKeptByBrowser) && listKeptByBrowser.length) {
    if (!todos.length) {
      await callApi("/todos/import", { method: "POST", body: { items: listKeptByBrowser } });
      todos = await callApi("/todos");
    }
    try {
      localStorage.setItem("todoList-moved", localStorage.getItem("todoList"));
      localStorage.removeItem("todoList");
    } catch {}
  }
  renderTodoLists();
}

function createTodoListItem(todo) {
  const listItem = createElement("li");
  if (todo.id === todoIdToAnimateIn) listItem.classList.add("entering");
  const checkbox = createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = todo.done;
  checkbox.addEventListener("change", () => toggleTodoDone(todo.id, listItem));
  const label = createElement("label");
  label.append(checkbox, createElement("span", null, todo.text));
  const deleteButton = createElement("button", "todo-del", "×");
  deleteButton.title = "Delete";
  deleteButton.addEventListener("click", () => deleteTodo(todo.id, listItem));
  listItem.append(label, deleteButton);
  return listItem;
}

function renderTodoLists() {
  elementById("todoList").replaceChildren(...todos.filter((todo) => !todo.done).map(createTodoListItem));
  elementById("doneList").replaceChildren(...todos.filter((todo) => todo.done).map(createTodoListItem));
  todoIdToAnimateIn = null;
}

// Every change is shown at once and then saved; if saving fails, the list is reloaded from the server
// so the page never shows something that isn't stored.
function saveInBackground(saveRequest) {
  saveRequest.catch((error) => {
    showErrorMessage(error.message);
    loadTodos().catch(() => {});
  });
}

// Slides a row out, then runs `afterSlideOut`. The row may still carry the "entering" animation from
// when it appeared, which would override "leaving" (and animationend would never come): it is removed
// first, and a timer finishes the job anyway if the animation doesn't report back.
function slideOutThen(listItem, afterSlideOut) {
  if (userPrefersReducedMotion.matches) return afterSlideOut();
  let hasFinished = false;
  const finish = () => {
    if (hasFinished) return;
    hasFinished = true;
    afterSlideOut();
  };
  listItem.classList.remove("entering");
  listItem.classList.add("leaving");
  listItem.addEventListener("animationend", finish, { once: true });
  setTimeout(finish, SLIDE_OUT_TIMEOUT_MILLISECONDS);
}

function toggleTodoDone(todoId, listItem) {
  const todo = todos.find((candidate) => candidate.id === todoId);
  if (!todo) return;
  todo.done = !todo.done;
  saveInBackground(callApi(`/todos/${todoId}`, { method: "PUT", body: { done: todo.done } }));
  slideOutThen(listItem, () => {
    todoIdToAnimateIn = todoId;
    renderTodoLists();
  });
}

function deleteTodo(todoId, listItem) {
  todos = todos.filter((todo) => todo.id !== todoId);
  saveInBackground(callApi(`/todos/${todoId}`, { method: "DELETE" }));
  slideOutThen(listItem, renderTodoLists);
}

async function addTodoFromInput() {
  const input = elementById("todoInput");
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  try {
    const newTodo = await callApi("/todos", { method: "POST", body: { text } });
    todos.push(newTodo);
    todoIdToAnimateIn = newTodo.id;
    renderTodoLists();
  } catch (error) {
    input.value = text; // nothing was saved: give the text back
    showErrorMessage(error.message);
  }
}

export function initializeNextUpPage() {
  elementById("todoAddBtn").addEventListener("click", addTodoFromInput);
  elementById("todoInput").addEventListener("keydown", (event) => { if (event.key === "Enter") addTodoFromInput(); });
}
