// Tests evaluate selected top-level parts of the browser scripts. These helpers
// locate code by its tokens rather than its exact formatting.

function pattern(code) {
  return new RegExp(
    [...code.replace(/\s+/g, '')].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'),
    'g',
  );
}

export function find(source, code, from = 0) {
  const re = pattern(code);
  re.lastIndex = from;
  const match = re.exec(source);
  if (!match) throw new Error(`Code not found: ${code}`);
  return match.index;
}

// From the start of `start` up to (not including) the start of `end`.
export function between(source, start, end) {
  const from = find(source, start);
  return source.slice(from, find(source, end, from));
}

// One complete top-level statement: it ends where the next line starts in
// column 0 with something other than a closing bracket.
export function statement(source, start) {
  const from = find(source, start);
  const next = /\n(?![\s})\]])/g;
  next.lastIndex = from;
  const match = next.exec(source);
  return source.slice(from, match ? match.index : source.length);
}
