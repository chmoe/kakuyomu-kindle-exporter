const NodeConstants = {
  ELEMENT_NODE: 1,
  TEXT_NODE: 3
};

class TextNode {
  constructor(text) {
    this.nodeType = NodeConstants.TEXT_NODE;
    this.textContent = text;
  }
}

class ElementNode {
  constructor(tagName, childNodes = []) {
    this.nodeType = NodeConstants.ELEMENT_NODE;
    this.tagName = tagName.toUpperCase();
    this.childNodes = childNodes;
  }

  get textContent() {
    return this.childNodes.map((node) => node.textContent || "").join("");
  }
}

class LimitedDocument {
  constructor(html) {
    this.body = {
      firstElementChild: new ElementNode("span", parseInline(stripOuterSpan(html)))
    };
  }

  createElement(tagName) {
    const element = new ElementNode(tagName);
    Object.defineProperty(element, "innerHTML", {
      set(value) {
        element.childNodes = parseInline(value);
      }
    });
    return element;
  }

  querySelectorAll() {
    return [];
  }
}

class LimitedDOMParser {
  parseFromString(html) {
    return new LimitedDocument(html);
  }
}

function stripOuterSpan(html) {
  return String(html || "").replace(/^<span>/i, "").replace(/<\/span>$/i, "");
}

function parseInline(html) {
  const nodes = [];
  let rest = String(html || "");

  while (rest) {
    if (/^<br\s*\/?>/i.test(rest)) {
      nodes.push(new ElementNode("br"));
      rest = rest.replace(/^<br\s*\/?>/i, "");
      continue;
    }

    const rubyMatch = rest.match(/^<ruby>([\s\S]*?)<\/ruby>/i);
    if (rubyMatch) {
      nodes.push(new ElementNode("ruby", parseInline(rubyMatch[1])));
      rest = rest.slice(rubyMatch[0].length);
      continue;
    }

    const simpleMatch = rest.match(/^<(rt|rb|rtc|em|strong|b|i|span)>([\s\S]*?)<\/\1>/i);
    if (simpleMatch) {
      nodes.push(new ElementNode(simpleMatch[1], parseInline(simpleMatch[2])));
      rest = rest.slice(simpleMatch[0].length);
      continue;
    }

    const unknownMatch = rest.match(/^<([a-z][^>]*)>([\s\S]*?)<\/[a-z][^>]*>/i);
    if (unknownMatch) {
      nodes.push(...parseInline(unknownMatch[2]));
      rest = rest.slice(unknownMatch[0].length);
      continue;
    }

    const nextTag = rest.indexOf("<");
    const text = nextTag === -1 ? rest : rest.slice(0, nextTag);
    if (text) nodes.push(new TextNode(text));
    rest = nextTag === -1 ? "" : rest.slice(nextTag);
  }

  return nodes;
}

module.exports = {
  DOMParser: LimitedDOMParser,
  Node: NodeConstants
};
