/**
 * pdf-extract.ts
 * Extracts raw text from a PDF using pdfjs-dist, bundled locally so it works
 * inside Obsidian's Electron environment without any worker/CSP issues.
 */

import { App, TFile } from "obsidian";
// Bundled UMD build of pdf.js — esbuild inlines it into main.js.
// The legacy build runs without Workers/Promise.allSettled, which fits
// Obsidian's Electron renderer environment.
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";

/** Minimal shape of the pages we care about (keeps the API surface narrow). */
interface PdfTextItemLike {
  str: string;
  hasEOL?: boolean;
}

interface PdfPageLike {
  getTextContent(): Promise<{ items: PdfTextItemLike[] }>;
}

interface PdfDocumentLike {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfPageLike>;
  destroy(): Promise<void> | void;
}

/**
 * Reads a vault PDF file and returns its extracted plain text.
 * Throws with a human-readable message if the PDF is unreadable.
 */
export async function extractPdfText(app: App, file: TFile): Promise<string> {
  // readBinary returns a Blob; convert via the standard API (no missing-method risk).
  const buffer: ArrayBuffer = await app.vault.readBinary(file);

  let doc: PdfDocumentLike;
  try {
    const loadingTask = pdfjsLib.getDocument({
      data: new Uint8Array(buffer),
      // Keep everything local/offline: no CMap/standard-font fetching.
      disableFontFace: true,
      isEvalSupported: false,
      verbosity: 0,
    });
    doc = (await loadingTask.promise) as PdfDocumentLike;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Could not open PDF "${file.name}": ${message}`);
  }

  const pageTexts: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber++) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();

      let pageText = "";
      for (const item of content.items) {
        if (typeof item.str !== "string") continue;
        pageText += item.str;
        // pdf.js marks line breaks with hasEOL; join words otherwise.
        pageText += item.hasEOL ? "\n" : " ";
      }

      const cleaned = pageText.replace(/[ \t]+\n/g, "\n").trim();
      if (cleaned.length > 0) {
        pageTexts.push(cleaned);
      }
    }
  } finally {
    // Always release the document to free WASM/worker memory.
    try {
      await doc.destroy();
    } catch {
      /* ignore teardown errors */
    }
  }

  const fullText = pageTexts.join("\n\n");
  if (fullText.trim().length === 0) {
    throw new Error(
      `No selectable text found in "${file.name}". It may be a scanned/image-only PDF (OCR is out of scope for this plugin).`
    );
  }
  return fullText;
}

/**
 * Truncates text to a character budget while snapping to a paragraph boundary
 * so the model still sees clean input.
 */
export function truncateText(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastParagraph = cut.lastIndexOf("\n\n");
  const bounded = lastParagraph > maxChars * 0.5 ? cut.slice(0, lastParagraph) : cut;
  return `${bounded.trimEnd()}\n\n[...document truncated by plugin...]`;
}
