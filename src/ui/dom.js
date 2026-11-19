/** Tiny DOM helpers — no framework, keeps the bundle lean. */
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(9)) {
    if (c == null || c === false) continue;
    node.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c);
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function slider({ label, value, min, max, step = 0.01, unit = '', onInput, format }) {
  const out = el('output', { class: 'num' }, format ? format(value) : fmt(value, unit));
  const input = el('input', {
    type: 'range', min, max, step, value,
    oninput: (e) => {
      const v = parseFloat(e.target.value);
      out.textContent = format ? format(v) : fmt(v, unit);
      onInput(v);
    },
  });
  const row = el('div', { class: 'field' },
    el('div', { class: 'field-head' }, el('label', {}, label), out),
    input,
  );
  row.setValue = (v) => { input.value = v; out.textContent = format ? format(v) : fmt(v, unit); };
  return row;
}

export function toggle({ label, value, onChange }) {
  const input = el('input', { type: 'checkbox', onchange: (e) => onChange(e.target.checked) });
  input.checked = !!value;
  return el('label', { class: 'switch-row' }, el('span', {}, label), el('span', { class: 'switch' }, input, el('i')));
}

export function colorField({ label, value, onChange }) {
  const input = el('input', { type: 'color', value, oninput: (e) => onChange(e.target.value) });
  return el('label', { class: 'color-row' }, el('span', {}, label), input);
}

export function segmented({ options, value, onChange }) {
  const wrap = el('div', { class: 'segmented' });
  const buttons = options.map((o) =>
    el('button', {
      class: o.value === value ? 'on' : '',
      onclick: () => {
        buttons.forEach((b, i) => b.classList.toggle('on', options[i].value === o.value));
        onChange(o.value);
      },
    }, o.label),
  );
  wrap.append(...buttons);
  return wrap;
}

export function field(label, input, hint) {
  return el('div', { class: 'field' },
    el('div', { class: 'field-head' }, el('label', {}, label), hint ? el('span', { class: 'hint' }, hint) : null),
    input,
  );
}

export function numberInput({ value, step = 0.01, onChange, min, max }) {
  const input = el('input', {
    class: 'text-input', type: 'number', value,
    step, min, max,
    onchange: (e) => onChange(parseFloat(e.target.value) || 0),
  });
  return input;
}

export function fmt(v, unit = '') {
  if (Math.abs(v) >= 100) return v.toFixed(0) + unit;
  if (Math.abs(v) >= 10) return v.toFixed(1) + unit;
  return v.toFixed(2) + unit;
}

export function icon(path, size = 18) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.7');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.innerHTML = path;
  return svg;
}
