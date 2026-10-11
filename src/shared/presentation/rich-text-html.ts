import type { Block, Inline } from "@/shared/domain/rich-text";

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes text for an HTML text node or a double-quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ESCAPES[char] ?? char);
}

/**
 * The blocks as an HTML string for email. Every text node and `href` is escaped. The styles
 * are fixed strings from the email layout, never staff input; links carry no `target`, mail
 * clients open them themselves. See specs/system/email.md and specs/system/security.md,
 * "Staff-authored content".
 */
export function richTextToHtml(
  blocks: readonly Block[],
  style: { link: string; paragraph: string },
): string {
  const inline = (nodes: readonly Inline[]): string =>
    nodes
      .map((node) => {
        switch (node.kind) {
          case "text":
            return escapeHtml(node.text);
          case "break":
            return "<br>";
          case "bold":
            return `<strong>${inline(node.children)}</strong>`;
          case "italic":
            return `<em>${inline(node.children)}</em>`;
          case "link":
            return `<a href="${escapeHtml(node.href)}" style="${style.link}">${inline(node.children)}</a>`;
        }
      })
      .join("");
  const items = (list: readonly (readonly Inline[])[]): string =>
    list.map((item) => `<li>${inline(item)}</li>`).join("");

  return blocks
    .map((block) => {
      switch (block.kind) {
        case "paragraph":
          return `<p style="${style.paragraph}">${inline(block.children)}</p>`;
        case "bullets":
          return `<ul style="${style.paragraph}">${items(block.items)}</ul>`;
        case "numbers":
          return `<ol style="${style.paragraph}">${items(block.items)}</ol>`;
      }
    })
    .join("");
}
