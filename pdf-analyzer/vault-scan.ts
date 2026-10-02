/**
 * vault-scan.ts
 * Scans the vault for existing folders (top-level and first-level nested) so
 * the LLM can only choose from folders that actually exist — no chaos.
 */

import { TFolder, Vault } from "obsidian";

/**
 * Returns vault-relative folder paths: every top-level folder plus its direct
 * children (e.g. ["Projects", "Projects/Active", "Notes"]). The root ("") is
 * intentionally excluded so files are never dumped at the vault root.
 */
export function collectCandidateFolders(vault: Vault): string[] {
  const root = vault.getRoot();
  const folders: string[] = [];

  const pushChildren = (parent: TFolder): void => {
    for (const child of parent.children) {
      if (child instanceof TFolder && child.isRoot()) continue;
      folders.push(child.path);
    }
  };

  pushChildren(root); // top-level folders

  for (const child of root.children) {
    if (child instanceof TFolder && !child.isRoot()) {
      pushChildren(child); // first-level nested folders
    }
  }

  return Array.from(new Set(folders)).sort((a, b) => a.localeCompare(b));
}

/** True if `path` matches an existing folder exactly (case-sensitive). */
export function folderExists(vault: Vault, path: string): boolean {
  const folder = vault.getAbstractFileByPath(path);
  return folder instanceof TFolder;
}

/**
 * Best-effort case-insensitive match against the candidate list. Small models
 * sometimes mangle capitalization or add trailing slashes; this rescues those.
 */
export function fuzzyMatchFolder(
  rawSelection: string,
  candidates: string[]
): string | null {
  const cleaned = rawSelection
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");

  if (!cleaned) return null;

  const exact = candidates.find((c) => c === cleaned);
  if (exact) return exact;

  const lowered = cleaned.toLowerCase();
  const ciMatch = candidates.find((c) => c.toLowerCase() === lowered);
  if (ciMatch) return ciMatch;

  // Last resort: model said just the leaf name, e.g. "Active" for "Projects/Active".
  const leafMatch = candidates.find(
    (c) => c.toLowerCase().split("/").pop() === lowered
  );
  return leafMatch ?? null;
}
