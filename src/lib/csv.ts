/**
 * A small RFC 4180 CSV reader: quoted fields, doubled quotes, commas and line
 * breaks inside quotes, CRLF or LF. A leading byte-order mark is dropped and
 * blank lines are skipped. Bank statements are the main use.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const endRow = () => {
    row.push(field);
    if (row.some((f) => f.trim() !== "")) rows.push(row);
    row = [];
    field = "";
  };
  for (let i = 0; i < input.length; i++) {
    const c = input[i]!;
    if (quoted) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") endRow();
    else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length) endRow();
  return rows;
}
