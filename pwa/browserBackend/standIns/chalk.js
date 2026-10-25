/* "chalk" colours text in a terminal; the browser console has none, so every colour gives the text back unchanged */

const plain = new Proxy((text) => String(text), { get: () => plain });

module.exports = plain;
