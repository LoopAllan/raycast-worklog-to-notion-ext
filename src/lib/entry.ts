export type EntryNodeType = "paragraph" | "bulleted_list_item";

export interface EntryNode {
  type: EntryNodeType;
  text: string;
  children: EntryNode[];
}

const BULLET_PATTERN = /^[-*]\s+/;

function indentWidth(line: string): number {
  const leading = /^[\t ]*/.exec(line)?.[0] ?? "";
  // A tab counts as 4 spaces so mixed indentation still nests sensibly.
  return [...leading].reduce((width, char) => width + (char === "\t" ? 4 : 1), 0);
}

function toNode(content: string): EntryNode {
  return BULLET_PATTERN.test(content)
    ? { type: "bulleted_list_item", text: content.replace(BULLET_PATTERN, ""), children: [] }
    : { type: "paragraph", text: content, children: [] };
}

/**
 * Each non-blank line becomes a block; a line indented deeper than the line
 * above it nests under that line, like a Markdown outline.
 */
export function parseDescription(description: string): EntryNode[] {
  const roots: EntryNode[] = [];
  const stack: { indent: number; node: EntryNode }[] = [];

  for (const rawLine of description.split(/\r?\n/)) {
    const content = rawLine.trim();
    if (content === "") {
      continue;
    }
    const indent = indentWidth(rawLine);
    const node = toNode(content);

    while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1];
    (parent ? parent.node.children : roots).push(node);
    stack.push({ indent, node });
  }

  return roots;
}

export interface EntryInput {
  start: string;
  end: string;
  action: string;
  ticketLine?: string;
  description?: string;
}

export function buildEntryTree({ start, end, action, ticketLine, description }: EntryInput): EntryNode {
  const descriptionNodes = parseDescription(description ?? "");
  const children: EntryNode[] = ticketLine
    ? [{ type: "paragraph", text: ticketLine, children: descriptionNodes }]
    : descriptionNodes;

  return { type: "paragraph", text: `${start} - ${end} ${action}`, children };
}
