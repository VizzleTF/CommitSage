// Tiny DOM construction helpers. No framework, no HTML sinks — strings always
// become text nodes, so no user value can reach innerHTML through here.

function applyAttr(
    node: HTMLElement,
    k: string,
    v: string | boolean | number | null | undefined,
): void {
    if (v === null || v === undefined || v === false) {
        return;
    }
    if (k === 'class') {
        node.className = String(v);
    } else if (k.startsWith('on')) {
        return; // handlers attached separately
    } else {
        node.setAttribute(k, v === true ? '' : String(v));
    }
}

function appendChildNode(node: HTMLElement, c: Node | string | null | undefined): void {
    if (c === null || c === undefined) {
        return;
    }
    // Strings become text nodes (never parsed as HTML); only already-built
    // DOM nodes are appended as-is. No user value reaches an HTML sink.
    if (typeof c === 'string') {
        node.appendChild(document.createTextNode(c));
    } else {
        node.appendChild(c);
    }
}

export function el<K extends keyof HTMLElementTagNameMap>(
    tag: K,
    attrs?: Record<string, string | boolean | number | null | undefined>,
    children: Array<Node | string | null | undefined> = [],
): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (attrs) {
        for (const [k, v] of Object.entries(attrs)) {
            applyAttr(node, k, v);
        }
    }
    for (const c of children) {
        appendChildNode(node, c);
    }
    return node;
}
