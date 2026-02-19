export type AudienceCsvPreviewRow = {
  lineNumber: number;
  email: string;
  firstName: string;
  lastName: string;
  tags: string[];
  isValidEmail: boolean;
  isDuplicateInCsv: boolean;
  isExistingContact: boolean;
};

export type AudienceCsvPreviewData = {
  headers: string[];
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateInCsvCount: number;
  duplicateExistingCount: number;
  previewRows: AudienceCsvPreviewRow[];
  detectedTags: string[];
  hasEmailColumn: boolean;
};

export const AUDIENCE_CSV_TEMPLATE = [
  "email,first_name,last_name,tags",
  "jane@example.com,Jane,Smith,all;buyers",
  "john@example.com,John,Doe,all;sellers",
].join("\n");

function normalizeHeaderKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function splitAudienceTags(raw: string): string[] {
  if (!raw.trim()) return [];
  return Array.from(
    new Set(
      raw
        .split(/[;,|]/g)
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean)
    )
  );
}

export function isLikelyEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim().toLowerCase());
}

export function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

export function parseAudienceCsv(
  csvContent: string,
  existingEmails: Set<string> = new Set<string>()
): AudienceCsvPreviewData | null {
  const lines = csvContent
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) return null;

  const headers = parseCsvLine(lines[0]).map((header) => header.trim());
  if (headers.length === 0) return null;

  const headerMeta = headers.map((header, index) => ({
    index,
    key: normalizeHeaderKey(header),
  }));

  const pickHeaderIndex = (keys: string[]): number | undefined =>
    headerMeta.find((item) => keys.includes(item.key))?.index;

  const emailIndex = pickHeaderIndex(["email", "emailaddress", "eaddress"]);
  const firstNameIndex = pickHeaderIndex(["firstname", "fname", "first"]);
  const lastNameIndex = pickHeaderIndex(["lastname", "lname", "last"]);
  const tagsIndex = pickHeaderIndex(["tags", "tag", "segment", "segments", "group", "groups"]);

  const dataRows = lines.slice(1).map((line, rowIndex) => ({
    lineNumber: rowIndex + 2,
    cells: parseCsvLine(line),
  }));

  const emailCounts = new Map<string, number>();
  for (const row of dataRows) {
    const fallbackEmail = row.cells.find((cell) => cell.includes("@")) || "";
    const rawEmail = (emailIndex !== undefined ? row.cells[emailIndex] : fallbackEmail) || "";
    const email = rawEmail.trim().toLowerCase();
    if (!isLikelyEmail(email)) continue;
    emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
  }

  const previewRows: AudienceCsvPreviewRow[] = [];
  const detectedTags = new Set<string>();
  let validRows = 0;
  let invalidRows = 0;
  let duplicateInCsvCount = 0;
  let duplicateExistingCount = 0;

  for (const row of dataRows) {
    const fallbackEmail = row.cells.find((cell) => cell.includes("@")) || "";
    const rawEmail = (emailIndex !== undefined ? row.cells[emailIndex] : fallbackEmail) || "";
    const email = rawEmail.trim().toLowerCase();
    const isValid = isLikelyEmail(email);
    const firstName = (firstNameIndex !== undefined ? row.cells[firstNameIndex] : "") || "";
    const lastName = (lastNameIndex !== undefined ? row.cells[lastNameIndex] : "") || "";
    const rawTags = (tagsIndex !== undefined ? row.cells[tagsIndex] : "") || "";
    const tags = splitAudienceTags(rawTags);

    if (isValid) validRows += 1;
    else invalidRows += 1;

    const isDuplicateInCsv = isValid && (emailCounts.get(email) || 0) > 1;
    const isExistingContact = isValid && existingEmails.has(email);
    if (isDuplicateInCsv) duplicateInCsvCount += 1;
    if (isExistingContact) duplicateExistingCount += 1;

    for (const tag of tags) {
      if (tag !== "all") detectedTags.add(tag);
    }

    if (previewRows.length < 10) {
      previewRows.push({
        lineNumber: row.lineNumber,
        email,
        firstName,
        lastName,
        tags,
        isValidEmail: isValid,
        isDuplicateInCsv,
        isExistingContact,
      });
    }
  }

  return {
    headers,
    totalRows: dataRows.length,
    validRows,
    invalidRows,
    duplicateInCsvCount,
    duplicateExistingCount,
    previewRows,
    detectedTags: Array.from(detectedTags),
    hasEmailColumn: emailIndex !== undefined,
  };
}

export function triggerCsvDownload(filename: string, content: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}
