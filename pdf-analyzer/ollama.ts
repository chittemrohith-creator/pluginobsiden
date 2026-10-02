/**
 * ollama.ts
 * Local LLM integration via Ollama's /api/generate endpoint, called through
 * Obsidian's requestUrl (native HTTP — avoids CORS entirely). No cloud keys.
 */

import { Notice, requestUrl } from "obsidian";
import { generateApiUrl, PdfAnalyzerSettings } from "./settings";

/** Parsed, validated result of the analysis. */
export interface AnalysisResult {
  summary: string;
  keyTakeaways: string[];
  /** Raw folder string returned by the model (validated by the caller). */
  selectedFolder: string;
}

interface OllamaGenerateResponse {
  response?: string;
  error?: string;
}

/** Builds the strict JSON-mode prompt sent to the local model. */
export function buildPrompt(
  pdfText: string,
  folderCandidates: string[],
  fallbackFolder: string
): string {
  const folderList = folderCandidates.length
    ? folderCandidates.map((f) => ` - "${f}"`).join("\n")
    : ` - "${fallbackFolder}"`;

  return [
    "You are a document analysis assistant running locally inside Obsidian.",
    "Read the PDF text below and respond with ONLY a single valid JSON object.",
    "Do not wrap it in markdown code fences. Do not add any commentary.",
    "",
    "The JSON object must have exactly these keys:",
    '  "summary": a concise 2-4 sentence plain-text summary of the document,',
    '  "key_takeaways": an array of 3-6 short plain-text bullet strings,',
    `  "selected_folder": the single best destination folder for this document.`,
    "",
    "selected_folder MUST be an EXACT string match of one item from this list of existing vault folders:",
    folderList,
    `If no folder is a good fit, use exactly "${fallbackFolder}".`,
    "Never invent a new folder name and never include a filename in the path.",
    "",
    "PDF TEXT START",
    pdfText,
    "PDF TEXT END",
    "",
    "Return only the JSON object now:",
  ].join("\n");
}

/**
 * Robustly extracts a JSON object from a chatty LLM response: tries direct
 * parse, strips code fences, then falls back to brace-matching.
 */
export function parseLlmJson(raw: string, fallbackFolder: string): AnalysisResult {
  const candidates: string[] = [];
  const trimmed = raw.trim();
  candidates.push(trimmed);

  // Strip ```json ... ``` fences if present.
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) candidates.push(fenceMatch[1].trim());

  // Brace-match the first {...} block.
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) candidates.push(trimmed.slice(start, end + 1));

  let parsed: unknown = null;
  for (const candidate of candidates) {
    try {
      parsed = JSON.parse(candidate);
      break;
    } catch {
      /* try next candidate */
    }
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      "The local model did not return valid JSON. Try a stronger model (e.g. llama3) or lower the max-text setting."
    );
  }

  const obj = parsed as Record<string, unknown>;

  const summary =
    typeof obj.summary === "string" && obj.summary.trim()
      ? obj.summary.trim()
      : "(No summary provided.)";

  let keyTakeaways: string[] = [];
  if (Array.isArray(obj.key_takeaways)) {
    keyTakeaways = obj.key_takeaways
      .map((t) => (typeof t === "string" ? t.trim() : ""))
      .filter((t) => t.length > 0);
  } else if (typeof obj.key_takeaways === "string") {
    keyTakeaways = obj.key_takeaways
      .split(/\r?\n/)
      .map((t) => t.replace(/^[-*•]\s*/, "").trim())
      .filter((t) => t.length > 0);
  }

  const selectedFolder =
    typeof obj.selected_folder === "string" && obj.selected_folder.trim()
      ? obj.selected_folder.trim()
      : fallbackFolder;

  return { summary, keyTakeaways, selectedFolder };
}

/** Calls Ollama /api/generate (non-streaming) and returns the raw response text. */
export async function callOllama(
  settings: PdfAnalyzerSettings,
  prompt: string
): Promise<string> {
  const url = generateApiUrl(settings.ollamaEndpoint);

  let res;
  try {
    res = await requestUrl({
      url,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings.modelName,
        prompt,
        stream: false,
        format: "json",
        options: { temperature: 0.1 },
      }),
      throw: false,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    new Notice(
      `Cannot reach Ollama at ${url}. Is it running? (Try \`ollama serve\` and \`ollama pull ${settings.modelName}\`)`,
      8000
    );
    throw new Error(`Ollama connection failed: ${message}`);
  }

  if (res.status === 404) {
    throw new Error(
      `Model "${settings.modelName}" was not found by Ollama. Pull it first: ollama pull ${settings.modelName}`
    );
  }
  if (res.status < 200 || res.status >= 300) {
    const bodyText = res.text || JSON.stringify(res.json);
    throw new Error(`Ollama returned HTTP ${res.status}: ${bodyText.slice(0, 300)}`);
  }

  const json = res.json as OllamaGenerateResponse;
  if (json.error) {
    throw new Error(`Ollama error: ${json.error}`);
  }
  if (typeof json.response !== "string" || !json.response.trim()) {
    throw new Error("Ollama returned an empty response.");
  }
  return json.response;
}
