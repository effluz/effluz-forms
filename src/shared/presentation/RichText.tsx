import type { ReactElement, ReactNode } from "react";
import { type Block, type Inline, parseRichText } from "@/shared/domain/rich-text";

/**
 * Staff-authored rich text from its Markdown-style source. React escapes every text node.
 * See specs/form-definition.md, "Text and languages".
 */
export function RichText(props: { source: string; className?: string | undefined }): ReactElement {
  return <RichBlocks blocks={parseRichText(props.source)} className={props.className} />;
}

/** Already parsed blocks as elements. Links open in a new tab with `rel="noopener"`. */
export function RichBlocks(props: {
  blocks: readonly Block[];
  className?: string | undefined;
}): ReactElement {
  return (
    <div className={props.className}>
      {props.blocks.map((block, index) => {
        switch (block.kind) {
          case "paragraph":
            return <p key={index}>{renderInline(block.children)}</p>;
          case "bullets":
            return (
              <ul key={index}>
                {block.items.map((item, at) => (
                  <li key={at}>{renderInline(item)}</li>
                ))}
              </ul>
            );
          case "numbers":
            return (
              <ol key={index}>
                {block.items.map((item, at) => (
                  <li key={at}>{renderInline(item)}</li>
                ))}
              </ol>
            );
        }
      })}
    </div>
  );
}

function renderInline(nodes: readonly Inline[]): ReactNode {
  return nodes.map((node, index) => {
    switch (node.kind) {
      case "text":
        return node.text;
      case "break":
        return <br key={index} />;
      case "bold":
        return <strong key={index}>{renderInline(node.children)}</strong>;
      case "italic":
        return <em key={index}>{renderInline(node.children)}</em>;
      case "link":
        return (
          <a key={index} href={node.href} target="_blank" rel="noopener">
            {renderInline(node.children)}
          </a>
        );
    }
  });
}
