// ---- data shared by several pages ----
// What the server last sent, kept here so every page reads the same copy.
// Data used by a single page stays inside that page's file.

export const appState = {
  accounts: [],          // GET /accounts (closed ones included)
  transactions: [],      // GET /transactions, newest first
  categories: [],        // GET /categories
  tags: [],              // GET /tags: every tag with its dates and how many transactions use it
  tagReport: [],         // GET /tags/report: what each tag adds up to (Insights > Tags)
  netWorth: null,        // GET /net-worth
  holdings: [],          // GET /investments: what is held, with live prices
  trades: [],            // GET /investments/trades: every buy and sell, newest first
  recurringTransactions: [], // GET /recurring-transactions
  // Reconcile inputs on the Assets page, by account id, kept across auto refreshes and renames
  countedAmountByAccountId: {},
};

// Closed accounts are hidden from the pickers and the Assets list (Assets > Show closed accounts)
export const isAccountOpen = (account) => !account.closed_at;
