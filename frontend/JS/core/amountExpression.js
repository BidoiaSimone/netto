// ---- an amount typed as a small sum: "4,70+1,20" -> 5.9 ----
// The transaction dialog's amount field accepts + − × ÷ and brackets (a receipt, a bill split three ways), and both
// decimal marks: "4,70" and "4.70" are the same. A number with a comma reads the comma as the decimal mark and any
// dots as thousands ("1.200,50"); a number without a comma reads a dot as the decimal mark ("4.70").
// No eval(): a tiny parser that only knows numbers, + - * / ( ) (and × ÷ x), so nothing else can ever run.

// "1.200,50" -> 1200.5, "4.7" -> 4.7; NaN for anything else
function parseNumber(text) {
  const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
  return /^\d*\.?\d+$|^\d+\.$/.test(normalized) ? Number(normalized) : NaN;
}

function tokenize(text) {
  const tokens = [];
  const source = text.replace(/\s+/g, "").replace(/[×x]/gi, "*").replace(/÷/g, "/").replace(/−/g, "-");
  for (let index = 0; index < source.length;) {
    const numberMatch = /^[\d.,]+/.exec(source.slice(index));
    if (numberMatch) {
      const value = parseNumber(numberMatch[0]);
      if (Number.isNaN(value)) return null;
      tokens.push(value);
      index += numberMatch[0].length;
    } else if ("+-*/()".includes(source[index])) {
      tokens.push(source[index++]);
    } else {
      return null; // a letter or anything else: not a sum
    }
  }
  return tokens;
}

// expression := term (("+" | "-") term)* ; term := factor (("*" | "/") factor)* ; factor := number | "-" factor | "(" expression ")"
function evaluate(tokens) {
  let position = 0;
  const peek = () => tokens[position];
  function factor() {
    const token = tokens[position++];
    if (typeof token === "number") return token;
    if (token === "-") return -factor();
    if (token === "(") {
      const value = expression();
      if (tokens[position++] !== ")") throw new Error("bracket");
      return value;
    }
    throw new Error("unexpected");
  }
  function term() {
    let value = factor();
    while (peek() === "*" || peek() === "/") value = tokens[position++] === "*" ? value * factor() : value / factor();
    return value;
  }
  function expression() {
    let value = term();
    while (peek() === "+" || peek() === "-") value = tokens[position++] === "+" ? value + term() : value - term();
    return value;
  }
  const value = expression();
  if (position !== tokens.length) throw new Error("left over");
  return value;
}

// The amount, rounded to the cent, or null if it isn't a number or a sum. Empty -> null.
export function evaluateAmount(text) {
  const tokens = tokenize(String(text ?? "").trim());
  if (!tokens || !tokens.length) return null;
  try {
    const value = evaluate(tokens);
    return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
  } catch {
    return null;
  }
}

// Does the text contain an operation (so the result is worth showing next to it)?
export const isSum = (text) => /\d\s*[-+*/×÷x−]\s*[\d(]/i.test(String(text ?? ""));
