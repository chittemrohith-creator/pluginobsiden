/**
 * main.ts
 * Local PDF Analyzer — Obsidian plugin entry point.
 *
 * Workflow: pick PDF → extract text (pdfjs-dist) → scan vault folders →
 * ask local Ollama model for JSON {summary, key_takeaways, selected_folder} →
 * create note in chosen folder → move the PDF there too.
 * No cloud API keys are ever used.
 */

import {
  FuzzySuggestModal,
  Notice,
  Plugin,
  TFile,
} from "obsidian";
import {
  DEFAULT_SETTINGS,
  loadSettings,
  normalizeFolderPath,
  PdfAnalyzerSettings,
  PdfAnalyzerSettingTab,
} from "./settings";
import { extractPdfText, truncateText } from "./pdf-extract";
import { collectCandidateFolders, fuzzyMatchFolder } from "./vault-scan";
import { buildPrompt, callOllama, parseLlmJson } from "./ollama";
import { writeNoteAndRoutePdf } from "./note-builder";

export default class LocalPdfAnalyzerPlugin extends Plugin {
  settings!: PdfAnalyzerSettings;

  async onload(): Promise<void> {
    this.settings = await loadSettings(this);

    // Ribbon icon trigger.
    this.addRibbonIcon(
      "file-search",
      "Analyze and Categorize PDF",
      () => void this.runWorkflow()
    );

    // Command palette triggers.
    this.addCommand({
      id: "analyze-and-categorize-pdf",
      name: "Analyze and Categorize PDF",
      callback: () => void this.runWorkflow(),
    });

    this.addCommand({
      id: "analyze-active-pdf",
      name: "Analyze currently active PDF",
      callback: () => void this.runWorkflow(true),
    });

    this.addSettingTab(new PdfAnalyzerSettingTab(this.app, this));
  }

  /** Persists settings to data.json in the plugin folder. */
  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async runWorkflow(activeOnly = false): Promise<void> {
    try {
      const pdfFile = activeOnly
        ? await this.getActiveOrPickedPdf()
        : await this.pickPdfFile();
      if (!pdfFile) return; // user cancelled

      new Notice(`Extracting text from "${pdfFile.name}"…`, 3000);
      const rawText = await extractPdfText(this.app, pdfFile);
      const pdfText = truncateText(rawText, this.settings.maxTextChars);

      const folders = collectCandidateFolders(this.app.vault);

      new Notice(
        `Asking local model "${this.settings.modelName}" to analyze & categorize…`,
        4000
      );
      const prompt = buildPrompt(pdfText, folders, this.settings.fallbackFolder);
      const llmRaw = await callOllama(this.settings, prompt);
      const result = parseLlmJson(llmRaw, this.settings.fallbackFolder);

      // Validate the model's folder choice against what actually exists.
      const destination = this.resolveDestination(result.selectedFolder, folders);
      result.selectedFolder = destination;

      const noteFile = await writeNoteAndRoutePdf(
        this.app,
        result,
        pdfFile,
        destination,
        normalizeFolderPath(this.settings.fallbackFolder) ||
          DEFAULT_SETTINGS.fallbackFolder
      );

      new Notice(
        `Done: note created in "${destination}"${
          destination === this.settings.fallbackFolder ? " (fallback)" : ""
        }. Opening…`,
        5000
      );
      await this.app.workspace.getLeaf(false).openFile(noteFile);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Local PDF Analyzer]", error);
      new Notice(`PDF analysis failed: ${message}`, 10000);
    }
  }

  /**
   * Accepts the model's folder string only if it maps to an existing vault
   * folder (exact or rescued via fuzzy match); otherwise falls back to Inbox.
   */
  private resolveDestination(modelChoice: string, candidates: string[]): string {
    const matched = fuzzyMatchFolder(modelChoice, candidates);
    if (matched) return matched;

    const fallback = normalizeFolderPath(this.settings.fallbackFolder);
    if (fallback && candidates.includes(fallback)) return fallback;
    return fallback || DEFAULT_SETTINGS.fallbackFolder;
  }

  /** Returns the active file if it is a PDF; otherwise opens the picker. */
  private async getActiveOrPickedPdf(): Promise<TFile | null> {
    const active = this.app.workspace.getActiveFile();
    if (active && active.extension.toLowerCase() === "pdf") return active;

    new Notice("Active file is not a PDF — opening the PDF picker instead.", 4000);
    return this.pickPdfFromVault();
  }

  /**
   * Fuzzy modal over every PDF in the vault. If the active file is already a
   * PDF, act on it directly.
   */
  private async pickPdfFile(): Promise<TFile | null> {
    const active = this.app.workspace.getActiveFile();
    if (active && active.extension.toLowerCase() === "pdf") {
      return active; // act on the currently open PDF directly
    }
    return this.pickPdfFromVault();
  }

  /** Shows a fuzzy modal listing every PDF in the vault. */
  private async pickPdfFromVault(): Promise<TFile | null> {
    const pdfFiles = this.app.vault
      .getFiles()
      .filter((f) => f.extension.toLowerCase() === "pdf");

    if (pdfFiles.length === 0) {
      new Notice("No PDF files found in this vault.", 5000);
      return null;
    }

    return new Promise<TFile | null>((resolve) => {
      let chosen: TFile | null = null;

      class PdfPicker extends FuzzySuggestModal<TFile> {
        getItems(): TFile[] {
          return pdfFiles;
        }
        getItemText(file: TFile): string {
          return file.path;
        }
        onChooseItem(file: TFile): void {
          chosen = file;
          resolve(file);
        }
        onClose(): void {
          super.onClose();
          if (!chosen) resolve(null); // user cancelled with Esc
        }
      }

      const picker = new PdfPicker(this.app);
      picker.setPlaceholder("Select a PDF to analyze…");
      picker.open();
    });
  }
}
