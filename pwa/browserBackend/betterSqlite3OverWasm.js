/* BETTER-SQLITE3, AS FAR AS NETTO USES IT, OVER SQLITE WASM
 * The backend was written for better-sqlite3 (synchronous, Node only). In the PWA the same code runs in a Web Worker
 * on SQLite compiled to WebAssembly (@sqlite.org/sqlite-wasm), which is synchronous too. The build (pwa/build.mjs)
 * swaps `require("better-sqlite3")` for this file, so the routes, services and migrations run unchanged.
 *
 * Only what netto calls is here: prepare() -> run / get / all, exec, pragma, transaction, close, name.
 * backup() is not: a copy of the database in the browser is a JSON export (step 5 of the deploy map).
 *
 * Before `new Database()` works, apiWorker.js hands over the loaded SQLite with useSqliteWasm().
 */

let sqlite3 = null;
let openDatabase = null; // (fileName) -> oo1.DB: OPFS when the browser has it, memory otherwise

function useSqliteWasm(loadedSqlite3, openDatabaseFile) {
  sqlite3 = loadedSqlite3;
  openDatabase = openDatabaseFile;
}

// better-sqlite3 takes .run(a, b), .run([a, b]) or .run({ name: value }) for @name / :name / $name in the SQL
function bindParametersOf(statement, args) {
  const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  const isNamed = values.length === 1 && values[0] !== null && typeof values[0] === "object" && !(values[0] instanceof Uint8Array);
  const toSqlite = (value) => (value === undefined ? null : typeof value === "boolean" ? Number(value) : value);
  statement.clearBindings();
  if (isNamed) {
    const named = values[0];
    for (let index = 1; index <= statement.parameterCount; index++) {
      const fullName = sqlite3.capi.sqlite3_bind_parameter_name(statement.pointer, index); // "@month"
      const key = fullName ? fullName.slice(1) : undefined;
      if (key === undefined || !(key in named)) throw new RangeError(`Missing named parameter "${key}"`);
      statement.bind(index, toSqlite(named[key]));
    }
  } else if (values.length) {
    statement.bind(values.map(toSqlite));
  }
}

class Statement {
  constructor(database, sql) {
    this.database = database;
    this.source = sql;
    this.wasmStatement = database.compiledStatement(sql);
  }

  #runWith(args, eachRow) {
    const statement = this.wasmStatement;
    try {
      bindParametersOf(statement, args);
      while (statement.step()) if (eachRow(statement.get({})) === false) break;
    } finally {
      statement.reset();
    }
  }

  run(...args) {
    this.#runWith(args, () => {});
    const { capi } = sqlite3;
    const pointer = this.database.wasmDatabase.pointer;
    return { changes: capi.sqlite3_changes(pointer), lastInsertRowid: Number(capi.sqlite3_last_insert_rowid(pointer)) };
  }

  get(...args) {
    let firstRow;
    this.#runWith(args, (row) => { firstRow = row; return false; });
    return firstRow;
  }

  all(...args) {
    const rows = [];
    this.#runWith(args, (row) => { rows.push(row); });
    return rows;
  }
}

class Database {
  constructor(fileName = ":memory:") {
    if (!sqlite3) throw new Error("SQLite WASM isn't loaded yet (apiWorker.js calls useSqliteWasm first)");
    this.name = fileName;
    this.wasmDatabase = openDatabase(fileName);
    this.open = true;
    this.transactionDepth = 0;
    this.compiledStatements = new Map(); // SQL -> compiled statement: many routes prepare the same SQL on every request
  }

  // One compiled statement per SQL text, reused. Safe because every call steps it to the end and resets it at once.
  compiledStatement(sql) {
    if (!this.compiledStatements.has(sql)) this.compiledStatements.set(sql, this.wasmDatabase.prepare(sql));
    return this.compiledStatements.get(sql);
  }

  prepare(sql) {
    return new Statement(this, sql);
  }

  exec(sql) {
    this.wasmDatabase.exec(sql);
    return this;
  }

  // "foreign_keys = ON" changes a setting; "user_version" reads one ({ simple: true }: just the first value)
  pragma(source, { simple = false } = {}) {
    const rows = this.prepare(`PRAGMA ${source}`).all();
    return simple ? (rows[0] ? Object.values(rows[0])[0] : undefined) : rows;
  }

  // Like better-sqlite3: a function that runs `fn` all-or-nothing; nested ones become savepoints
  transaction(fn) {
    const database = this;
    return function runInTransaction(...args) {
      const isOutermost = database.transactionDepth === 0;
      const savepoint = `netto_${database.transactionDepth}`;
      database.exec(isOutermost ? "BEGIN" : `SAVEPOINT ${savepoint}`);
      database.transactionDepth++;
      try {
        const result = fn.apply(this, args);
        database.transactionDepth--;
        database.exec(isOutermost ? "COMMIT" : `RELEASE ${savepoint}`);
        return result;
      } catch (error) {
        database.transactionDepth--;
        database.exec(isOutermost ? "ROLLBACK" : `ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
        throw error;
      }
    };
  }

  backup() {
    return Promise.reject(new Error("Database copies aren't available in the browser: use Download backup (JSON) instead"));
  }

  close() {
    for (const statement of this.compiledStatements.values()) statement.finalize();
    this.compiledStatements.clear();
    this.wasmDatabase.close();
    this.open = false;
  }
}

module.exports = Database;
module.exports.useSqliteWasm = useSqliteWasm;
