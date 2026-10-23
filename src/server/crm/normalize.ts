/** Words that don't distinguish one company from another. */
const NOISE = new Set([
  "the",
  "pvt",
  "private",
  "ltd",
  "limited",
  "llp",
  "llc",
  "inc",
  "co",
  "company",
  "corp",
  "corporation",
  "fz",
  "fze",
  "fzco",
  "fzllc",
  "plc",
  "gmbh",
  "india",
]);

/**
 * A comparable form of a client name for duplicate checks: lower case, no
 * punctuation, no company suffixes. "Star Sports India Pvt. Ltd." and
 * "STAR SPORTS" both become "star sports".
 */
export function normalizeClientName(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean);
  const meaningful = words.filter((w) => !NOISE.has(w));
  // A name made only of noise words ("The Company") keeps them.
  return (meaningful.length ? meaningful : words).join(" ");
}

/** "https://www.Example.com/about" → "example.com". */
export function websiteDomain(website: string | null | undefined): string | null {
  if (!website) return null;
  const host = website
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0];
  return host || null;
}
