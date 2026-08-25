// Colouring @mentions inside a rendered message.
//
// ReactMarkdown gives no hook for "part of a text node", so this is a small
// remark plugin: it walks the tree, splits text nodes on @token, and emits a
// link node carrying a class. MessageStream renders those as spans rather than
// anchors — a mention is a marker, not a destination.
//
// Written by hand rather than with unist-util-visit, which is not a direct
// dependency of this project. The tree is small and the walk is six lines.

import {MENTION_TOKEN_PATTERN} from '@/lib/channels';

type Node = {
  type: string;
  value?: string;
  children?: Node[];
  url?: string;
  data?: {hProperties?: Record<string, string>};
};

const MENTION = /@([A-Za-z0-9._-]{2,40})/g;

// `known` is the set of tokens that actually resolve. An @something that matches
// nobody stays plain text, so the colour means "this reached a person or an
// agent" rather than "this had an @ in front of it".
export function mentionHighlight(known: Set<string>) {
  return () => (tree: Node) => walk(tree, known);
}

function walk(node: Node, known: Set<string>): void {
  if (!node.children) return;

  const out: Node[] = [];
  let changed = false;

  for (const child of node.children) {
    // Never rewrite inside a link or code span: an email address and a code
    // sample both contain things that look like mentions and are not.
    if (child.type === 'text' && node.type !== 'link' && node.type !== 'inlineCode') {
      const parts = split(child.value ?? '', known);
      if (parts.length > 1) {
        changed = true;
        out.push(...parts);
        continue;
      }
    }
    walk(child, known);
    out.push(child);
  }

  if (changed) node.children = out;
}

function split(value: string, known: Set<string>): Node[] {
  const out: Node[] = [];
  let last = 0;

  MENTION.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MENTION.exec(value)) !== null) {
    const token = match[1].toLowerCase();
    if (!known.has(token) || !MENTION_TOKEN_PATTERN.test(match[1])) continue;

    if (match.index > last) {
      out.push({type: 'text', value: value.slice(last, match.index)});
    }
    out.push({
      type: 'link',
      url: '#mention',
      data: {hProperties: {className: 'c92-mention'}},
      children: [{type: 'text', value: match[0]}]
    });
    last = match.index + match[0].length;
  }

  if (out.length === 0) return [{type: 'text', value}];
  if (last < value.length) out.push({type: 'text', value: value.slice(last)});
  return out;
}
