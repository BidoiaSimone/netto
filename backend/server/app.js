/* DECLARATION AND INSTANTIATION OF EXPRESS APP */
const db = require("../db/database.js");
const express = require("express");
const PORT = 3000;

const app = express();
app.use(express.json());

const router = require("./routes/routes.js");
app.use(router);

app.set('json spaces', 2);

app.listen(PORT, function (err) {
    if (err) console.log(err);
    console.log("Server listening on PORT", PORT);
});

module.exports = app;