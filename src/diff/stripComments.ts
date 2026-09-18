const PREFIXES: Record<string, string[]> = {
  typescript: ["//"],
  javascript: ["//"],
  java: ["//"],
  c: ["//"],
  cpp: ["//"],
  csharp: ["//"],
  go: ["//"],
  rust: ["//"],
  kotlin: ["//"],
  swift: ["//"],
  php: ["//"],
  scala: ["//"],
  dart: ["//"],
  svelte: ["//", "<!--"],
  vue: ["//", "<!--"],
  css: ["//", "/*", "*"],
  scss: ["//", "/*", "*"],
  less: ["//", "/*", "*"],
  python: ["#"],
  ruby: ["#"],
  shell: ["#"],
  bash: ["#"],
  yaml: ["#"],
  toml: ["#"],
  dockerfile: ["#"],
  perl: ["#"],
  r: ["#"],
  makefile: ["#"],
  graphql: ["#"],
  haskell: ["--"],
  lua: ["--"],
  sql: ["--"],
  ini: ["#", ";"],
  html: ["<!--"],
  xml: ["<!--"],
  markdown: ["<!--"],
};

export function stripContextComments(
  text: string,
  language: string,
): string {
  if (!text) return text;
  const key = (language ?? "").toLowerCase();
  const prefixes = PREFIXES[key];
  if (!prefixes || prefixes.length === 0) return text;

  const lines = text.split("\n");
  const kept = lines.filter((line) => {
    const t = line.trimStart();
    if (t === "") return true;
    for (const p of prefixes) {
      if (t.startsWith(p)) return false;
    }
    return true;
  });
  return kept.join("\n");
}
