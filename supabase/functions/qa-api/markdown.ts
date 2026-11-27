// An issue's rich text (the editor's sanitised HTML) as Markdown, for an AI
// tool to read: headings, emphasis, code, links, lists, tables, mentions as
// their names. Pure: the browser tests read it too.

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

const decode = (text: string) =>
  text.replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, e: string) => ENTITIES[e])
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));

export function htmlToMarkdown(html: string): string {
  if (!html) return "";
  // Code blocks first, set aside with their own line breaks; elsewhere a
  // line break in the HTML is only a space.
  const blocks: string[] = [];
  let s = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<pre[^>]*>\s*(?:<code[^>]*>)?([\s\S]*?)(?:<\/code>)?\s*<\/pre>/gi, (_, code: string) => {
      blocks.push(decode(code.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/\n+$/, ""));
      return `\n\n\uE000${blocks.length - 1}\uE000\n\n`;
    })
    .replace(/\r?\n/g, " ");

  // Tables: a row per line, cells between pipes, a rule under the first row.
  s = s.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_, body: string) => {
    const rows = [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) =>
      [...r[1].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((c) => c[1].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()));
    if (!rows.length) return "";
    const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
    return `\n\n${[line(rows[0]), line(rows[0].map(() => "---")), ...rows.slice(1).map(line)].join("\n")}\n\n`;
  });

  // Ordered lists number their items; others bullet them.
  s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, (_, body: string) => {
    let n = 0;
    return `\n${body.replace(/<li[^>]*>/gi, () => `\n${++n}. `)}\n`;
  });
  s = s
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/(ul|ol|li)>|<(ul)[^>]*>/gi, "\n")
    .replace(/<h([1-6])[^>]*>/gi, (_, n: string) => `\n\n${"#".repeat(Number(n))} `)
    .replace(/<\/h[1-6]>/gi, "\n\n")
    .replace(/<(strong|b)(\s[^>]*)?>|<\/(strong|b)>/gi, "**")
    .replace(/<(em|i)(\s[^>]*)?>|<\/(em|i)>/gi, "_")
    .replace(/<\/?code[^>]*>/gi, "`")
    .replace(/<a [^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, text: string) => `[${text.replace(/<[^>]+>/g, "")}](${href})`)
    .replace(/<blockquote[^>]*>/gi, "\n\n> ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/blockquote>|<\/div>/gi, "\n\n")
    .replace(/<[^>]+>/g, "");

  return decode(s)
    .split("\n").map((l) => l.replace(/[ \t]+/g, " ").replace(/^ (?=\S)/, "").trimEnd()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\uE000(\d+)\uE000/g, (_, i: string) => `\`\`\`\n${blocks[Number(i)]}\n\`\`\``)
    .trim();
}
