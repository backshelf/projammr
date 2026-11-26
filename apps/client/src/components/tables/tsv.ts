/**
 * Spreadsheet clipboard interchange for the table's cell selection.
 *
 * `table.getSelectedCellRangesData()` hands back raw values as
 * `[region][row][column]`; turning that into text a spreadsheet accepts (and
 * reading text one produces) is the application's call — the delimiter, how
 * `null` is written, and the quoting rules are all decisions the feature
 * deliberately leaves to us.
 */

const NEEDS_QUOTING = /[\t\n\r"]/;

function serializeField(value: unknown): string {
  if (value == null) return "";
  // A `list` cell's value is a `string[]`; written the way the kind formats
  // it, so it pastes back as the same list.
  const str = Array.isArray(value) ? value.join(", ") : String(value);
  if (!NEEDS_QUOTING.test(str)) return str;
  return `"${str.replace(/"/g, '""')}"`;
}

/**
 * Serializes one selection region (a row-major grid) to TSV. A field holding a
 * tab, newline or quote is wrapped in quotes with inner quotes doubled, so a
 * value that itself contains a tab cannot split into phantom columns when
 * pasted back.
 */
export function gridToTsv(grid: unknown[][]): string {
  return grid.map((row) => row.map(serializeField).join("\t")).join("\n");
}

/**
 * Parses TSV (as produced by a spreadsheet copy) into a row-major grid,
 * honouring quoted fields with doubled inner quotes and embedded
 * tabs/newlines. Bare `\r\n` and `\r` outside quotes are treated as row breaks.
 */
export function tsvToGrid(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i += 1;
        }
      } else {
        field += ch;
        i += 1;
      }
      continue;
    }

    if (ch === '"' && field === "") {
      inQuotes = true;
      i += 1;
    } else if (ch === "\t") {
      pushField();
      i += 1;
    } else if (ch === "\n") {
      pushRow();
      i += 1;
    } else if (ch === "\r") {
      pushRow();
      if (text[i + 1] === "\n") i += 2;
      else i += 1;
    } else {
      field += ch;
      i += 1;
    }
  }

  if (field !== "" || row.length > 0) pushRow();
  return rows;
}
