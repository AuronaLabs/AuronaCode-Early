import hljs from "highlight.js/lib/core";
import css from "highlight.js/lib/languages/css";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";

// Aurona Code only registers the languages its editor can detect, keeping the
// worker bundle small instead of shipping every highlight.js grammar.
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("python", python);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("css", css);
hljs.registerLanguage("json", json);
hljs.registerLanguage("html", xml);

const SUPPORTED_HLJS_LANGUAGES = new Set([
  "rust",
  "python",
  "javascript",
  "typescript",
  "css",
  "json",
  "html",
]);

const classToType: Record<string, number> = {
  "hljs-keyword": 1,
  "hljs-literal": 1,
  "hljs-symbol": 1,
  "hljs-string": 2,
  "hljs-regexp": 2,
  "hljs-number": 3,
  "hljs-function": 4,
  "hljs-title": 4,
  "hljs-attr": 5,
  "hljs-variable": 5,
  "hljs-params": 5,
  "hljs-comment": 6,
  "hljs-operator": 7,
  "hljs-punctuation": 7,
  "hljs-built_in": 8,
  "hljs-bullet": 8,
  "hljs-type": 9,
  "hljs-class": 9,
  "hljs-meta": 5,
};

function parseHtmlFast(html: string, totalLines: number): number[][] {
  const linesTokens: number[][] = Array.from({ length: totalLines }, () => []);
  let currentLine = 0;
  let currentOffset = 0;
  const activeClasses: string[] = [];

  // Decode HTML entities mapping
  const entities: Record<string, string> = {
    "&amp;": "&",
    "&lt;": "<",
    "&gt;": ">",
    "&quot;": '"',
    "&#39;": "'",
  };
  const unescapeHTML = (str: string) => str.replace(/&[a-z]+;|&#\d+;/gi, (m) => entities[m] || m);

  // Match <span class="xxx"> or </span> or plain text
  const regex = /<span class="([^"]+)">|<\/span>|([^<]+)/g;
  let match: RegExpExecArray | null = regex.exec(html);
  while (match) {
    if (match[1]) {
      // It's a span open
      // classes can be multiple, e.g., "hljs-keyword hljs-strong"
      const classes = match[1].split(" ");
      activeClasses.unshift(...classes); // Push to front of stack
    } else if (match[0] === "</span>") {
      activeClasses.shift();
    } else if (match[2]) {
      const text = unescapeHTML(match[2]);
      const textLines = text.split(/\r?\n/);

      textLines.forEach((textLine, i) => {
        if (i > 0) {
          currentLine++;
          currentOffset = 0;
        }

        if (textLine.length > 0) {
          let type = 0;
          for (const cls of activeClasses) {
            if (classToType[cls]) {
              type = classToType[cls];
              break;
            }
          }

          if (type > 0 && currentLine < totalLines) {
            linesTokens[currentLine].push(currentOffset, textLine.length, type);
          }
          currentOffset += textLine.length;
        }
      });
    }
    match = regex.exec(html);
  }

  return linesTokens;
}

self.onmessage = (e: MessageEvent) => {
  const { id, fullText, language, totalLines } = e.data;

  try {
    let hljsLang = language;
    if (language === "rs") hljsLang = "rust";
    if (language === "py") hljsLang = "python";
    if (language === "js") hljsLang = "javascript";
    if (language === "ts") hljsLang = "typescript";

    if (!SUPPORTED_HLJS_LANGUAGES.has(hljsLang)) {
      const emptyTokens = Array.from({ length: totalLines }, () => []);
      self.postMessage({ id, tokens: emptyTokens });
      return;
    }

    const highlighted = hljs.highlight(fullText, { language: hljsLang });
    const tokens = parseHtmlFast(highlighted.value, totalLines);

    self.postMessage({ id, tokens });
  } catch (err) {
    console.error("Worker highlight error", err);
    const emptyTokens = Array.from({ length: totalLines }, () => []);
    self.postMessage({ id, tokens: emptyTokens });
  }
};
