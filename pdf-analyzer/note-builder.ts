/**
 * note-builder.ts
 * Turns an AnalysisResult into a Markdown note body and handles file routing:
 * create the note in the chosen folder, then move the original PDF there too.
 */

import { App, Notice, TFile, TFolder, normalizePath } from "obsidian";
import { AnalysisResult } from "./ollama";

/** Strips characters Obsidian forbids in filenames and collapses whitespace. */
export function sanitizeNoteName(name: string): string {
  return name
    .replace(/\.pdf$/i, "")
    .replace(/[\\/:*?"|#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

/** Builds the full Markdown content of the analysis note. */
export function buildNoteContent(
  result: AnalysisResult,
  pdfFile: TFile,
  destinationFolder: string
): string {
  const today = new Date().toISOString().slice(0, 10);
  const takeaways = result.keyTakeaways.length
    ? result.keyTakeaways.map((t) => `- ${t}`).join("\n")
    : "- (No key takeaways returned.)";

  return [
    "---",
    `source: "[[${pdfFile.name}]]"`,
    `analyzed: ${today}`,
    `model-folder: "${destinationFolder}"`,
    "tags: [pdf-analysis]",
    "---",
    "",
    `# Analysis: ${sanitizeNoteName(pdfFile.basename)}`,
    "",
    `**Original document:** [[${pdfFile.name}]]`,
    "",
    "## Summary",
    "",
    result.summary,
    "",
    "## Key Takeaways",
    "",
    takeaways,
    "",
  ].join("\n");
}

/** Returns a non-colliding path inside `folder` for `baseName.md`. */
function uniqueNotePath(app: App, folder: string, baseName: string): string {
  let candidate = normalizePath(`${folder}/${baseName}.md`);
  if (!app.vault.getAbstractFileByPath(candidate)) return candidate;

  for (let i = 2; i < 100; i++) {
    candidate = normalizePath(`${folder}/${baseName} ${i}.md`);
    if (!app.vault.getAbstractFileByPath(candidate)) return candidate;
  }
  // Extremely unlikely fallback: timestamped name.
  return normalizePath(`${folder}/${baseName}-${Date.now()}.md`);
}

/**
 * Creates the analysis note in `destinationFolder` (creating the folder only
 * if it is the configured fallback and does not exist yet), then moves the
 * source PDF into the same folder when it isn't already there.
 */
export async function writeNoteAndRoutePdf(
  app: App,
  result: AnalysisResult,
  pdfFile: TFile,
  destinationFolder: string,
  fallbackFolder: string
): Promise<TFile> {
  // Only auto-create the folder when it's the trusted fallback setting —
  // never for arbitrary model output (validated upstream).
  const target = app.vault.getAbstractFileByPath(destinationFolder);
  if (!(target instanceof TFolder)) {
    if (destinationFolder !== fallbackFolder) {
      throw new Error(
        `Destination folder "${destinationFolder}" does not exist; refusing to create it.`
      );
    }
    await app.vault.createFolder(normalizePath(destinationFolder));
  }

  const noteName = sanitizeNoteName(pdfFile.basename) || "PDF Analysis";
  const notePath = uniqueNotePath(app, destinationFolder, noteName);
  const content = buildNoteContent(result, pdfFile, destinationFolder);
  const noteFile = await app.vault.create(notePath, content);

  // Move the PDF alongside its analysis note unless it's already in place.
  const currentDir = pdfFile.parent?.path ?? "";
  if (currentDir !== destinationFolder) {
    try {
      await app.fileManager.renameFile(
        pdfFile,
        normalizePath(`${destinationFolder}/${pdfFile.name}`)
      );
    } catch (error) {
      // Non-fatal: the note was created; warn the user so they can move it.
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Note created, but moving "${pdfFile.name}" failed: ${message}`, 8000);
    }
  }

  return noteFile;
}
