const EXT_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  mdx: "markdown",
  py: "python",
  pyi: "python",
  rb: "ruby",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  swift: "swift",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  cs: "csharp",
  php: "php",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  vue: "vue",
  svelte: "svelte",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "shell",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  toml: "toml",
  xml: "xml",
  xsd: "xml",
  dockerfile: "dockerfile",
  makefile: "makefile",
  mk: "makefile",
  ini: "ini",
  cfg: "ini",
  properties: "ini",
  lua: "lua",
  pl: "perl",
  pm: "perl",
  r: "r",
  scala: "scala",
  dart: "dart",
  hs: "haskell",
};

export function extToLanguage(filePath: string): string {
  if (!filePath) return "plaintext";
  const base = filePath.split(/[\\/]/).pop() ?? filePath;
  const lowerBase = base.toLowerCase();
  if (lowerBase === "dockerfile" || lowerBase.startsWith("dockerfile.")) {
    return "dockerfile";
  }
  if (lowerBase === "makefile" || lowerBase === "gnumakefile") {
    return "makefile";
  }
  if (lowerBase === "containerfile") {
    return "dockerfile";
  }
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) {
    return "plaintext";
  }
  const ext = base.slice(dot + 1).toLowerCase();
  return EXT_MAP[ext] ?? "plaintext";
}
