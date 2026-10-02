/**
 * settings.ts
 * Plugin settings, defaults, persistence loader and the Settings Tab UI.
 */

import { App, PluginSettingTab, Setting } from "obsidian";
import type LocalPdfAnalyzerPlugin from "./main";

/** Shape of the persisted plugin settings. */
export interface PdfAnalyzerSettings {
  /** Base URL of the local Ollama server (no trailing slash). */
  ollamaEndpoint: string;
  /** Model name passed to Ollama's /api/generate, e.g. "llama3" or "mistral". */
  modelName: string;
  /** Folder used when the LLM cannot pick a valid existing folder. */
  fallbackFolder: string;
  /** Max characters of extracted PDF text sent to the model (context guard). */
  maxTextChars: number;
}

/** Sensible defaults — strictly local, no cloud keys anywhere. */
export const DEFAULT_SETTINGS: PdfAnalyzerSettings = {
  ollamaEndpoint: "http://127.0.0.1:11434",
  modelName: "llama3",
  fallbackFolder: "Inbox",
  maxTextChars: 12000,
};

/** Full /api/generate URL derived from the configured base endpoint. */
export function generateApiUrl(endpoint: string): string {
  const trimmed = endpoint.trim().replace(/\/+$/, "");
  return `${trimmed}/api/generate`;
}

/** Normalizes user input so relative paths never escape or double up slashes. */
export function normalizeFolderPath(folder: string): string {
  return folder
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .replace(/([^:]\/)\/+/g, "$1");
}

/** Loads settings from disk and merges them with defaults (forward-compatible). */
export async function loadSettings(
  plugin: LocalPdfAnalyzerPlugin
): Promise<PdfAnalyzerSettings> {
  const stored = await plugin.loadData();
  return { ...DEFAULT_SETTINGS, ...(stored ?? {}) };
}

/** The settings tab rendered in Obsidian's Settings > Community Plugins. */
export class PdfAnalyzerSettingTab extends PluginSettingTab {
  private readonly plugin: LocalPdfAnalyzerPlugin;

  constructor(app: App, plugin: LocalPdfAnalyzerPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Local LLM endpoint")
      .setDesc(
        "Base URL of your Ollama server. The plugin calls <code>/api/generate</code> on it."
      )
      .addText((text) =>
        text
          .setPlaceholder("http://127.0.0.1:11434")
          .setValue(this.plugin.settings.ollamaEndpoint)
          .onChange(async (value) => {
            this.plugin.settings.ollamaEndpoint = value.trim() || DEFAULT_SETTINGS.ollamaEndpoint;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Model name")
      .setDesc("Model pulled in Ollama, e.g. llama3, mistral, qwen2.5.")
      .addText((text) =>
        text
          .setPlaceholder("llama3")
          .setValue(this.plugin.settings.modelName)
          .onChange(async (value) => {
            this.plugin.settings.modelName = value.trim() || DEFAULT_SETTINGS.modelName;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Fallback folder")
      .setDesc(
        "Where notes go when the model cannot confidently pick an existing folder. Must be a vault-relative path like Inbox or 00 Inbox."
      )
      .addText((text) =>
        text
          .setPlaceholder("Inbox")
          .setValue(this.plugin.settings.fallbackFolder)
          .onChange(async (value) => {
            this.plugin.settings.fallbackFolder = normalizeFolderPath(value);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Max text sent to the model")
      .setDesc(
        "Character cap for extracted PDF text included in the prompt. Lower this if small local models choke on long documents."
      )
      .addSlider((slider) =>
        slider
          .setLimits(2000, 40000, 2000)
          .setValue(this.plugin.settings.maxTextChars)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.maxTextChars = value;
            await this.plugin.saveSettings();
          })
      );

    containerEl.createEl("p", {
      text: "No cloud API keys are used. Everything runs against your local Ollama instance.",
      cls: "setting-item-description",
    });
  }
}
