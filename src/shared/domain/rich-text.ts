/**
 * The restricted rich-text subset staff can write in the places the form model allows it.
 * See specs/form-definition.md, "Text and languages", and specs/ui-ux/builder.md,
 * "Markdown inputs". The parser only yields this closed set of nodes, never markup, and
 * every renderer escapes the text nodes. Consent text is outside the subset.
 */
export type Inline =
  | { kind: "text"; text: string }
  | { kind: "bold"; children: Inline[] }
  | { kind: "italic"; children: Inline[] }
  | { kind: "link"; href: string; children: Inline[] }
  | { kind: "break" };

export type Block =
  | { kind: "paragraph"; children: Inline[] }
  | { kind: "bullets"; items: Inline[][] }
  | { kind: "numbers"; items: Inline[][] };

const BULLET = /^- (.*)$/;
const NUMBER = /^\d{1,3}\. (.*)$/;
const LINK = /\[([^\]]+)\]\((https:\/\/[^\s()]+)\)/y;
const LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/** Parses the subset into blocks. Anything outside the subset stays literal text. */
export function parseRichText(source: string): Block[] {
  const blocks: Block[] = [];
  let paragraph: Inline[] | null = null;
  let list: { kind: "bullets" | "numbers"; items: Inline[][] } | null = null;

  const closeOpen = () => {
    if (paragraph) blocks.push({ kind: "paragraph", children: paragraph });
    if (list) blocks.push(list);
    paragraph = null;
    list = null;
  };

  for (const line of source.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.trim() === "") {
      closeOpen();
      continue;
    }
    const bullet = BULLET.exec(line);
    const number = bullet ? null : NUMBER.exec(line);
    const item = bullet ?? number;
    if (item) {
      const kind = bullet ? "bullets" : "numbers";
      if (paragraph || (list && list.kind !== kind)) closeOpen();
      list ??= { kind, items: [] };
      list.items.push(parseInline(item[1] ?? "", true));
      continue;
    }
    if (list) closeOpen();
    if (paragraph) {
      paragraph.push({ kind: "break" }, ...parseInline(line, true));
    } else {
      paragraph = parseInline(line, true);
    }
  }
  closeOpen();
  return blocks;
}

/** A plain-text rendering, for notification text and previews. */
export function richTextToPlain(blocks: readonly Block[]): string {
  return blocks
    .map((block) => {
      switch (block.kind) {
        case "paragraph":
          return inlineToPlain(block.children);
        case "bullets":
          return block.items.map((item) => `- ${inlineToPlain(item)}`).join("\n");
        case "numbers":
          return block.items
            .map((item, index) => `${String(index + 1)}. ${inlineToPlain(item)}`)
            .join("\n");
      }
    })
    .join("\n\n");
}

function inlineToPlain(nodes: readonly Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
          return node.text;
        case "break":
          return "\n";
        case "bold":
        case "italic":
          return inlineToPlain(node.children);
        case "link":
          return `${inlineToPlain(node.children)} (${node.href})`;
      }
    })
    .join("");
}

function isHttps(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function isWordChar(char: string | undefined): boolean {
  return char !== undefined && LETTER_OR_DIGIT.test(char);
}

function parseInline(source: string, allowLinks: boolean): Inline[] {
  const nodes: Inline[] = [];
  let literal = "";
  const flush = () => {
    if (literal) nodes.push({ kind: "text", text: literal });
    literal = "";
  };

  let i = 0;
  while (i < source.length) {
    if (source.startsWith("**", i)) {
      const end = source.indexOf("**", i + 2);
      if (end > i + 2) {
        flush();
        nodes.push({ kind: "bold", children: parseInline(source.slice(i + 2, end), allowLinks) });
        i = end + 2;
        continue;
      }
    }
    if (source[i] === "_" && !isWordChar(source[i - 1])) {
      let end = source.indexOf("_", i + 1);
      while (end !== -1 && (end === i + 1 || isWordChar(source[end + 1]))) {
        end = source.indexOf("_", end + 1);
      }
      if (end !== -1) {
        flush();
        nodes.push({ kind: "italic", children: parseInline(source.slice(i + 1, end), allowLinks) });
        i = end + 1;
        continue;
      }
    }
    if (allowLinks && source[i] === "[") {
      LINK.lastIndex = i;
      const match = LINK.exec(source);
      if (match?.[1] && match[2] && isHttps(match[2])) {
        flush();
        nodes.push({ kind: "link", href: match[2], children: parseInline(match[1], false) });
        i += match[0].length;
        continue;
      }
    }
    literal += source.charAt(i);
    i += 1;
  }
  flush();
  return nodes;
}
