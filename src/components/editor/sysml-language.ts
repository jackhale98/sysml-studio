/**
 * CodeMirror 6 SysML language support.
 *
 * In Tauri mode: tree-sitter-based highlighting via decoration ViewPlugin.
 * In browser mode: StreamLanguage regex tokenizer as fallback.
 */
import {
  StreamLanguage,
  HighlightStyle,
  syntaxHighlighting,
  type StreamParser,
} from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import {
  ViewPlugin,
  Decoration,
  type DecorationSet,
  EditorView,
  type ViewUpdate,
} from "@codemirror/view";
import { StateField, StateEffect, type Extension, RangeSetBuilder } from "@codemirror/state";
import type { HighlightToken } from "../../lib/element-types";

// ─── SysML Keywords ───

const KEYWORDS = new Set([
  "package", "part", "def", "attribute", "port", "connection", "interface",
  "item", "action", "state", "transition", "constraint", "requirement",
  "concern", "view", "viewpoint", "rendering", "allocation", "analysis",
  "case", "use", "verification", "enum", "enumeration", "occurrence",
  "flow", "import", "alias", "abstract", "readonly", "derived",
  "in", "out", "inout", "first", "then", "do", "entry", "exit",
  "if", "else", "accept", "send", "assign", "assert", "satisfy",
  "after", "at", "when", "decide", "merge", "fork", "join",
  "private", "protected", "public", "ref", "connect", "to",
  "allocate", "expose", "exhibit", "include", "perform",
  "require", "assume", "verify", "subject", "actor", "objective",
  "stakeholder", "calc", "function", "predicate", "metadata",
  "about", "doc", "comment", "variation", "variant", "individual",
  "snapshot", "timeslice", "event", "bind", "succession", "message",
  "dependency", "filter", "render", "return",
]);

const BUILTIN_TYPES = new Set([
  "Boolean", "String", "Integer", "Natural", "Positive", "Real",
  "Complex", "Number", "UnlimitedNatural", "Time", "Length", "Mass",
  "Anything", "Nothing",
]);

// ─── Stream Parser (browser fallback) ───

interface SysmlState {
  inBlockComment: boolean;
  inDoc: boolean;
}

const sysmlStreamParser: StreamParser<SysmlState> = {
  name: "sysml",
  startState: () => ({ inBlockComment: false, inDoc: false }),
  token(stream, state) {
    // Block comment continuation
    if (state.inBlockComment) {
      if (stream.match("*/")) {
        state.inBlockComment = false;
      } else {
        stream.next();
      }
      return "comment";
    }
    // Doc comment continuation
    if (state.inDoc) {
      if (stream.match("*/")) {
        state.inDoc = false;
      } else {
        stream.next();
      }
      return "comment";
    }

    // Whitespace
    if (stream.eatSpace()) return null;

    // Line comments
    if (stream.match("//")) {
      stream.skipToEnd();
      return "comment";
    }

    // Doc comment start (doc /*)
    if (stream.match(/^doc\s+\/\*/)) {
      state.inDoc = true;
      return "comment";
    }

    // Block comment start
    if (stream.match("/*")) {
      state.inBlockComment = true;
      return "comment";
    }

    // String literal
    if (stream.match(/"(?:[^"\\]|\\.)*"/)) return "string";
    if (stream.match(/'(?:[^'\\]|\\.)*'/)) return "string";

    // Number
    if (stream.match(/^-?\d+(\.\d+)?([eE][+-]?\d+)?/)) return "number";

    // Operators
    if (stream.match(":>>") || stream.match(":>") || stream.match("::") ||
        stream.match("..") || stream.match("->") || stream.match("==") ||
        stream.match("!=") || stream.match("<=") || stream.match(">=")) {
      return "operator";
    }

    // Punctuation
    if (stream.match(/^[{}()\[\];:,|&@#=<>+\-*/~.]/)) return "punctuation";

    // Words (identifiers and keywords)
    if (stream.match(/^[a-zA-Z_]\w*/)) {
      const word = stream.current();
      if (KEYWORDS.has(word)) return "keyword";
      if (BUILTIN_TYPES.has(word)) return "typeName";
      if (/^[A-Z]/.test(word)) return "typeName";
      return "variableName";
    }

    stream.next();
    return null;
  },
};

export const sysmlLanguage = StreamLanguage.define(sysmlStreamParser);

// ─── Highlight Style (theme-matched) ───

export const sysmlHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "#c084fc" },
  { tag: t.typeName, color: "#38bdf8" },
  { tag: t.variableName, color: "#94a3b8" },
  { tag: t.definition(t.variableName), color: "#e2e8f0", fontWeight: "600" },
  { tag: t.propertyName, color: "#94a3b8" },
  { tag: t.comment, color: "#4a6741", fontStyle: "italic" },
  { tag: t.string, color: "#a3e635" },
  { tag: t.number, color: "#fbbf24" },
  { tag: t.operator, color: "#64748b" },
  { tag: t.punctuation, color: "#475569" },
  { tag: t.bool, color: "#fb923c" },
]);

export const sysmlLightHighlightStyle = HighlightStyle.define([
  { tag: t.keyword, color: "#7c3aed" },
  { tag: t.typeName, color: "#0284c7" },
  { tag: t.variableName, color: "#334155" },
  { tag: t.definition(t.variableName), color: "#0f172a", fontWeight: "600" },
  { tag: t.propertyName, color: "#334155" },
  { tag: t.comment, color: "#65a30d", fontStyle: "italic" },
  { tag: t.string, color: "#16a34a" },
  { tag: t.number, color: "#d97706" },
  { tag: t.operator, color: "#64748b" },
  { tag: t.punctuation, color: "#94a3b8" },
  { tag: t.bool, color: "#ea580c" },
]);

// ─── Tree-sitter Decoration Plugin (Tauri mode) ───

/** Effect to update highlight tokens from tree-sitter */
const setHighlightTokens = StateEffect.define<HighlightToken[]>();

// CSS class decorations for each token kind
const tokenDecorations: Record<string, Decoration> = {
  keyword: Decoration.mark({ class: "cm-ts-keyword" }),
  type: Decoration.mark({ class: "cm-ts-type" }),
  definition: Decoration.mark({ class: "cm-ts-definition" }),
  comment: Decoration.mark({ class: "cm-ts-comment" }),
  string: Decoration.mark({ class: "cm-ts-string" }),
  number: Decoration.mark({ class: "cm-ts-number" }),
  operator: Decoration.mark({ class: "cm-ts-operator" }),
  punctuation: Decoration.mark({ class: "cm-ts-punctuation" }),
  literal: Decoration.mark({ class: "cm-ts-literal" }),
  property: Decoration.mark({ class: "cm-ts-property" }),
};

/** StateField that holds tree-sitter decorations */
const treeSitterHighlightField = StateField.define<DecorationSet>({
  create() {
    return Decoration.none;
  },
  update(decos, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setHighlightTokens)) {
        const builder = new RangeSetBuilder<Decoration>();
        const docLen = tr.state.doc.length;
        for (const token of effect.value) {
          const deco = tokenDecorations[token.kind];
          if (deco && token.start < docLen && token.end <= docLen && token.start < token.end) {
            builder.add(token.start, token.end, deco);
          }
        }
        return builder.finish();
      }
    }
    // If document changed but no new tokens yet, try to map existing ones
    if (tr.docChanged) {
      return decos.map(tr.changes);
    }
    return decos;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/** Dispatch new highlight tokens to the editor */
export function dispatchHighlightTokens(view: EditorView, tokens: HighlightToken[]) {
  view.dispatch({ effects: setHighlightTokens.of(tokens) });
}

// ─── CSS for tree-sitter token classes ───

const treeSitterTheme = EditorView.baseTheme({
  ".cm-ts-keyword": { color: "#c084fc" },
  ".cm-ts-type": { color: "#38bdf8" },
  ".cm-ts-definition": { color: "#e2e8f0", fontWeight: "600" },
  ".cm-ts-comment": { color: "#4a6741", fontStyle: "italic" },
  ".cm-ts-string": { color: "#a3e635" },
  ".cm-ts-number": { color: "#fbbf24" },
  ".cm-ts-operator": { color: "#64748b" },
  ".cm-ts-punctuation": { color: "#475569" },
  ".cm-ts-literal": { color: "#fb923c" },
  ".cm-ts-property": { color: "#94a3b8" },
});

const treeSitterLightTheme = EditorView.baseTheme({
  "&light .cm-ts-keyword": { color: "#7c3aed" },
  "&light .cm-ts-type": { color: "#0284c7" },
  "&light .cm-ts-definition": { color: "#0f172a", fontWeight: "600" },
  "&light .cm-ts-comment": { color: "#65a30d", fontStyle: "italic" },
  "&light .cm-ts-string": { color: "#16a34a" },
  "&light .cm-ts-number": { color: "#d97706" },
  "&light .cm-ts-operator": { color: "#64748b" },
  "&light .cm-ts-punctuation": { color: "#94a3b8" },
  "&light .cm-ts-literal": { color: "#ea580c" },
  "&light .cm-ts-property": { color: "#334155" },
});

// ─── Exports ───

/** Extension bundle for browser mode (StreamLanguage) */
export function sysmlBrowserHighlighting(): Extension {
  return [
    sysmlLanguage,
    syntaxHighlighting(sysmlHighlightStyle),
    syntaxHighlighting(sysmlLightHighlightStyle),
  ];
}

/** Extension bundle for Tauri mode (tree-sitter decorations) */
export function sysmlTreeSitterHighlighting(): Extension {
  return [
    treeSitterHighlightField,
    treeSitterTheme,
    treeSitterLightTheme,
  ];
}
