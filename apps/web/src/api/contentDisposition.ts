/**
 * Spec 12 §6.1 / AC2 — pull a safe file name out of a `Content-Disposition` header. The header is
 * untrusted input to the `download=` attribute, so the result is stripped of directory parts,
 * control characters and leading dots/spaces, capped at 120 characters (extension kept), and falls
 * back whenever nothing usable is left. Pure, React-free, DOM-free; never throws.
 */
const MAX_LENGTH = 120;

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/g;

function sanitize(raw: string): string {
  const lastSegment = raw.split(/[/\\]/).pop() ?? "";
  let name = lastSegment.replace(CONTROL, "").replace(/^[. ]+/, "").trimEnd();
  if (name.length > MAX_LENGTH) {
    const ext = /\.[A-Za-z0-9]{1,10}$/.exec(name)?.[0] ?? "";
    name = name.slice(0, MAX_LENGTH - ext.length) + ext;
  }
  return name;
}

export function filenameFromContentDisposition(
  header: string | null | undefined,
  fallback = "download",
): string {
  if (!header) return fallback;

  let raw: string | undefined;
  const star = /(?:^|[;\s])filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      raw = decodeURIComponent(star[1]!.trim());
    } catch {
      return fallback; // an undecodable filename* is a bad header; do not fall through to the plain one
    }
  } else {
    const quoted = /(?:^|[;\s])filename\s*=\s*"((?:[^"\\]|\\.)*)"/i.exec(header);
    if (quoted) {
      raw = quoted[1]!.replace(/\\(.)/g, "$1");
    } else {
      raw = /(?:^|[;\s])filename\s*=\s*([^;\s"]+)/i.exec(header)?.[1];
    }
  }
  if (raw === undefined) return fallback;

  const name = sanitize(raw);
  return name === "" ? fallback : name;
}
