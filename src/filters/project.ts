import type { Project } from "../domain";

type Token =
  | { type: "identifier"; value: string }
  | { type: "string"; value: string }
  | { type: "operator"; value: "and" | "or" | "not" | "==" | "!=" | "contains" | "in" }
  | { type: "paren"; value: "(" | ")" }
  | { type: "comma"; value: "," };

type Value = string | boolean | string[] | null;

const fields = new Set([
  "state",
  "visibility",
  "owner",
  "repo",
  "slug",
  "archived",
  "pinned",
  "up",
  "automation_enabled",
  "has_roadmap",
  "primary_language",
  "topics",
  "tags",
]);

export function matchesProjectFilter(project: Project, expression: string | undefined): boolean {
  const trimmed = expression?.trim();
  if (!trimmed) return true;
  const parser = new Parser(tokenize(trimmed), project);
  const result = parser.parseExpression();
  parser.expectEnd();
  return result;
}

function tokenize(expression: string): Token[] {
  const tokens: Token[] = [];
  for (let index = 0; index < expression.length; ) {
    const char = expression[index] as string;
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === "(" || char === ")") {
      tokens.push({ type: "paren", value: char });
      index += 1;
      continue;
    }
    if (char === ",") {
      tokens.push({ type: "comma", value: char });
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      const [value, next] = readString(expression, index);
      tokens.push({ type: "string", value });
      index = next;
      continue;
    }
    if (expression.startsWith("==", index) || expression.startsWith("!=", index)) {
      tokens.push({ type: "operator", value: expression.slice(index, index + 2) as "==" | "!=" });
      index += 2;
      continue;
    }
    const word = /^[A-Za-z_][A-Za-z0-9_-]*/.exec(expression.slice(index))?.[0];
    if (!word) throw new Error(`Unexpected filter token near: ${expression.slice(index)}`);
    tokens.push(keywordToken(word));
    index += word.length;
  }
  return tokens;
}

function readString(expression: string, start: number): [string, number] {
  const quote = expression[start];
  let value = "";
  for (let index = start + 1; index < expression.length; index += 1) {
    const char = expression[index];
    if (char === "\\") {
      value += expression[index + 1] ?? "";
      index += 1;
      continue;
    }
    if (char === quote) return [value, index + 1];
    value += char;
  }
  throw new Error("Unterminated string literal in project filter.");
}

function keywordToken(word: string): Token {
  if (word === "and" || word === "or" || word === "not" || word === "contains" || word === "in") {
    return { type: "operator", value: word };
  }
  return { type: "identifier", value: word };
}

class Parser {
  private index = 0;

  constructor(
    private readonly tokens: Token[],
    private readonly project: Project,
  ) {}

  parseExpression(): boolean {
    return this.parseOr();
  }

  expectEnd() {
    if (this.peek()) throw new Error(`Unexpected filter token: ${this.describe(this.peek())}`);
  }

  private parseOr(): boolean {
    let value = this.parseAnd();
    while (this.matchOperator("or")) {
      value = this.parseAnd() || value;
    }
    return value;
  }

  private parseAnd(): boolean {
    let value = this.parseNot();
    while (this.matchOperator("and")) {
      value = this.parseNot() && value;
    }
    return value;
  }

  private parseNot(): boolean {
    if (this.matchOperator("not")) return !this.parseNot();
    return this.parsePredicate();
  }

  private parsePredicate(): boolean {
    if (this.matchParen("(")) {
      const value = this.parseExpression();
      this.expectParen(")");
      return value;
    }
    const left = this.parseValue();
    const operator = this.matchComparison();
    if (!operator) return this.truthy(left);
    const right = this.parseValue();
    if (operator === "==") return this.equals(left, right);
    if (operator === "!=") return !this.equals(left, right);
    if (operator === "contains") return this.contains(left, right);
    return this.contains(right, left);
  }

  private parseValue(): Value {
    const token = this.next();
    if (!token) throw new Error("Unexpected end of project filter.");
    if (token.type === "string") return token.value;
    if (token.type !== "identifier") {
      throw new Error(`Expected filter value, received ${this.describe(token)}.`);
    }
    if (token.value === "true") return true;
    if (token.value === "false") return false;
    if (this.matchParen("(")) return this.callFunction(token.value);
    if (!fields.has(token.value)) throw new Error(`Unknown project filter field: ${token.value}`);
    return fieldValue(this.project, token.value);
  }

  private callFunction(name: string): boolean {
    const token = this.next();
    if (token?.type !== "string") {
      throw new Error(`Function ${name} expects a string argument.`);
    }
    this.expectParen(")");
    if (name === "has_topic") return this.project.topics.includes(token.value);
    if (name === "has_tag") return this.project.tags.includes(token.value);
    if (name === "has_language") return this.project.languages.includes(token.value);
    throw new Error(`Unknown project filter function: ${name}`);
  }

  private matchComparison(): Token["value"] | undefined {
    const token = this.peek();
    if (
      token?.type === "operator" &&
      (token.value === "==" ||
        token.value === "!=" ||
        token.value === "contains" ||
        token.value === "in")
    ) {
      this.index += 1;
      return token.value;
    }
  }

  private contains(left: Value, right: Value): boolean {
    if (Array.isArray(left) && typeof right === "string") return left.includes(right);
    if (typeof left === "string" && typeof right === "string") return left.includes(right);
    return false;
  }

  private equals(left: Value, right: Value): boolean {
    if (Array.isArray(left) || Array.isArray(right)) {
      return JSON.stringify(left) === JSON.stringify(right);
    }
    return left === right;
  }

  private truthy(value: Value): boolean {
    if (Array.isArray(value)) return value.length > 0;
    return Boolean(value);
  }

  private matchOperator(operator: Token["value"]) {
    const token = this.peek();
    if (token?.type !== "operator" || token.value !== operator) return false;
    this.index += 1;
    return true;
  }

  private matchParen(paren: "(" | ")") {
    const token = this.peek();
    if (token?.type !== "paren" || token.value !== paren) return false;
    this.index += 1;
    return true;
  }

  private expectParen(paren: "(" | ")") {
    if (!this.matchParen(paren)) throw new Error(`Expected '${paren}' in project filter.`);
  }

  private next() {
    const token = this.peek();
    this.index += 1;
    return token;
  }

  private peek() {
    return this.tokens[this.index];
  }

  private describe(token: Token | undefined) {
    if (!token) return "end of input";
    return token.value;
  }
}

function fieldValue(project: Project, field: string): Value {
  if (field === "visibility") return project.visibility;
  if (field === "automation_enabled") return project.automationEnabled;
  if (field === "has_roadmap") return project.hasRoadmap;
  if (field === "primary_language") return project.primaryLanguage ?? null;
  const value = project[field as keyof Project];
  if (typeof value === "string" || typeof value === "boolean" || Array.isArray(value)) {
    return value;
  }
  return null;
}
