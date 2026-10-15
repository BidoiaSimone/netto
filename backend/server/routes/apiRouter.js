/* ALL API ROUTES IN ONE ROUTER, so app.js only has to mount this file.
 * Order matters only for the investments: /investments/trades and /investments/history must be
 * registered before /investments/:ticker, or "trades" and "history" would be read as tickers.
 */

const express = require("express");

const apiRouter = express.Router();

apiRouter.use(require("./accountRoutes.js"));
apiRouter.use(require("./transactionRoutes.js"));
apiRouter.use(require("./recurringTransactionRoutes.js"));
apiRouter.use(require("./categoryRoutes.js"));
apiRouter.use(require("./tagRoutes.js"));
apiRouter.use(require("./budgetRoutes.js"));
apiRouter.use(require("./forecastRoutes.js"));
apiRouter.use(require("./investmentTradeRoutes.js"));   // before the holdings: see above
apiRouter.use(require("./investmentHoldingRoutes.js"));
apiRouter.use(require("./netWorthRoutes.js"));
apiRouter.use(require("./statementRoutes.js"));
apiRouter.use(require("./todoRoutes.js"));
apiRouter.use(require("./backupRoutes.js"));
apiRouter.use(require("./databaseDumpRoutes.js"));

module.exports = apiRouter;
