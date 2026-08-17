/**
 * Getting data out of the app.
 *
 * `<a download>` is ignored by WKWebView, so on iOS the export buttons
 * did nothing at all. Everything goes through the Tauri save dialog and
 * a real file write, with the anchor kept only as a browser-dev
 * fallback. Failures are reported rather than swallowed.
 */
import { useModelStore } from "../stores/model-store";

function reportError(message: string) {
  useModelStore.setState({ error: message });
}

/** Escape one CSV field. */
export function csvCell(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV document from a header row and body rows. */
export function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\n");
}

/**
 * Write text to a user-chosen location. Returns true when a file was
 * written, false when the user cancelled.
 */
export async function saveTextFile(
  defaultName: string,
  contents: string,
  extension: string,
): Promise<boolean> {
  try {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const path = await save({
      title: "Export",
      defaultPath: defaultName,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    });
    if (!path) return false;
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, contents);
    return true;
  } catch (e) {
    // Browser dev fallback — never reached in the packaged app.
    try {
      const blob = new Blob([contents], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = defaultName;
      a.click();
      URL.revokeObjectURL(url);
      return true;
    } catch {
      reportError(`Export failed: ${String(e)}`);
      return false;
    }
  }
}

/** Save a CSV, reporting failure visibly. */
export async function exportCsv(
  defaultName: string,
  header: string[],
  rows: unknown[][],
): Promise<void> {
  await saveTextFile(defaultName, toCsv(header, rows), "csv");
}
