import parseDiff from "parse-diff";

export interface Hunk {
  file: string;
  header: string;
  newStart: number;
  newEnd: number;
  addedLines: string[];
  rawHunk: string;
  isNew: boolean;
  isDeleted: boolean;
  hasAdditions: boolean;
}

function cleanFileName(name: string): string {
  let f = (name ?? "").trim();
  if (f.length >= 2) {
    const first = f[0];
    const last = f[f.length - 1];
    if (
      (first === '"' && last === '"') ||
      (first === "'" && last === "'")
    ) {
      f = f.slice(1, -1);
    }
  }
  if (f.startsWith("a/") || f.startsWith("b/")) {
    f = f.slice(2);
  }
  return f;
}

export function normalize(raw: string): Hunk[] {
  if (!raw || !raw.trim()) return [];
  const files = parseDiff(raw);
  const out: Hunk[] = [];

  for (const f of files) {
    let file = f.to ?? f.from ?? "";
    if (!file || file === "/dev/null" || file === "dev/null") {
      file = f.from ?? "";
    }
    if (!file || file === "/dev/null" || file === "dev/null") {
      continue;
    }
    file = cleanFileName(file);
    if (!file || file === "/dev/null" || file === "dev/null") {
      continue;
    }

    const isNew = f.new === true || f.from === "/dev/null";
    const isDeleted = f.deleted === true || f.to === "/dev/null";

    for (const chunk of f.chunks) {
      const header: string = chunk.content;
      const newStart: number = chunk.newStart;
      const count: number = chunk.newLines;
      const newEnd = count <= 0 ? newStart : newStart + count - 1;

      const addedLines: string[] = [];
      const prefixed: string[] = [];
      for (const c of chunk.changes) {
        const content = (c as { content?: unknown }).content;
        if (typeof content !== "string") continue;
        prefixed.push(content);
        if (
          c.type === "add" &&
          content.startsWith("+") &&
          content !== "\\ No newline at end of file"
        ) {
          addedLines.push(content.slice(1));
        }
      }

      const rawHunk = header + "\n" + prefixed.join("\n");
      out.push({
        file,
        header,
        newStart,
        newEnd,
        addedLines,
        rawHunk,
        isNew,
        isDeleted,
        hasAdditions: addedLines.length > 0,
      });
    }
  }

  return out;
}
