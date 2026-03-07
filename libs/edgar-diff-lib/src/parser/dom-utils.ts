import type { Node } from 'domhandler';
import { isTag, isText } from 'domhandler';

/** Accumulate text from all descendant text nodes. <br> tags produce a space. */
export function getTextContent(node: Node): string {
  if (isText(node)) {
    return node.data;
  }
  if (isTag(node)) {
    if (node.name.toLowerCase() === 'br') {
      return ' ';
    }
    return node.children.map(getTextContent).join('');
  }
  return '';
}
