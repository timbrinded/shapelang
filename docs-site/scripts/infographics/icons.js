export function glyph(name, label = "") {
  const aria = label ? ` role="img" aria-label="${label}"` : ` aria-hidden="true"`;
  return `<span class="hi hi-${name}"${aria}></span>`;
}

export function icon(name, tone = "") {
  return `<span class="icon-disc ${tone}">${glyph(name)}</span>`;
}
