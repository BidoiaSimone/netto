/* DECLARATION AND INSTANTIATION OF EXPRESS APP */

const express = require("express");
const path = require("path");

const PORT = process.env.PORT || 3000;
const FRONTEND_DIR = path.join(__dirname, "../../frontend");

const app = express();
app.use(express.json());
app.set("json spaces", 2);

app.use(require("./routes/routes.js"));  // API routes
app.use(express.static(FRONTEND_DIR));   // pages, css, js, images
app.get("/", (req, res) => res.redirect("/HTML/Home.html"));

app.listen(PORT, function (err) {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Server listening on http://localhost:${PORT}`);
});

module.exports = app;
