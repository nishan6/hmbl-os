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

/** A cell for `toCsv`: text is guarded against spreadsheet formulas, numbers are written as they are. */
export type CsvCell = string | number | bigint | null | undefined;

const quote = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/**
 * Writes rows as CSV with CRLF line ends. Text starting with = + - @ or a tab
 * (other than a plain number like -12.50) gets a leading apostrophe, so a
 * spreadsheet shows it rather than running it.
 */
export function toCsv(rows: CsvCell[][]): string {
  return rows
    .map((r) =>
      r
        .map((c) => {
          if (c === null || c === undefined) return "";
          if (typeof c !== "string") return String(c);
          const formula = /^[=+\-@\t\r]/.test(c) && !/^-?\d+(\.\d+)?$/.test(c);
          return quote(formula ? `'${c}` : c);
        })
        .join(","),
    )
    .join("\r\n")
    .concat("\r\n");
}
