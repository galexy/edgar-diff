import type { Node } from 'domhandler';
import { isTag, isText } from 'domhandler';

/** Accumulate text from all descendant text nodes. <br> tags produce a space. */
export function getTextContent(node: Node): string {
  if (isText(node)) {
    return node.data;
  }
  if (isTag(node)) {
    if (node.name === 'br') {
      return ' ';
    }
    const children = node.children;
    let result = '';
    for (let i = 0; i < children.length; i++) {
      result += getTextContent(children[i]);
    }
    return result;
  }
  return '';
}
