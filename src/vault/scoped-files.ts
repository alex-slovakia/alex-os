import type { TAbstractFile, TFile, TFolder, Vault } from "obsidian";

import { isPathInsideFolder, normalizeVaultPath } from "./pure";

export function isVaultFile(value: TAbstractFile | null): value is TFile {
  return value !== null
    && "extension" in value
    && typeof value.extension === "string"
    && "stat" in value;
}

export function isVaultFolder(value: TAbstractFile | null): value is TFolder {
  return value !== null && "children" in value && Array.isArray(value.children);
}

function isProtectedPath(path: string, configDir: string): boolean {
  const normalizedConfigDir = normalizeVaultPath(configDir);
  return normalizedConfigDir.length > 0 && isPathInsideFolder(path, normalizedConfigDir);
}

/**
 * Reads only explicitly configured folder subtrees. Empty/root paths are ignored so
 * a malformed setting can never turn a dashboard refresh into a whole-vault scan.
 */
export function collectConfiguredMarkdownFiles(
  vault: Vault,
  folderPaths: readonly string[],
): TFile[] {
  const files = new Map<string, TFile>();
  const visitedFolders = new Set<string>();

  const visit = (folder: TFolder): void => {
    const folderPath = normalizeVaultPath(folder.path);
    if (visitedFolders.has(folderPath) || isProtectedPath(folderPath, vault.configDir)) return;
    visitedFolders.add(folderPath);

    for (const child of folder.children) {
      if (isProtectedPath(child.path, vault.configDir)) continue;
      if (isVaultFile(child)) {
        if (child.extension.toLocaleLowerCase("en-US") === "md") files.set(child.path, child);
      } else if (isVaultFolder(child)) {
        visit(child);
      }
    }
  };

  for (const requestedPath of folderPaths) {
    const path = normalizeVaultPath(requestedPath);
    if (!path || isProtectedPath(path, vault.configDir)) continue;
    const root = vault.getAbstractFileByPath(path);
    if (isVaultFolder(root)) visit(root);
  }

  return [...files.values()];
}
