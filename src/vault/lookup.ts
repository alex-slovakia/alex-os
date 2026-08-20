import { MetadataCache, TAbstractFile, TFile, Vault } from "obsidian";

import { normalizeVaultPath } from "./pure";

export function resolveVaultTarget(
  vault: Vault,
  metadataCache: MetadataCache,
  requestedPath: string
): TAbstractFile | null {
  const path = normalizeVaultPath(requestedPath);
  if (!path) {
    return null;
  }

  const exact = vault.getAbstractFileByPath(path);
  if (exact) {
    return exact;
  }

  if (!/\.[^/]+$/.test(path)) {
    const markdownFile = vault.getAbstractFileByPath(`${path}.md`);
    if (markdownFile) {
      return markdownFile;
    }
  }

  return metadataCache.getFirstLinkpathDest(path.replace(/\.md$/i, ""), "");
}

export async function readFileSafely(vault: Vault, file: TFile): Promise<string> {
  try {
    return await vault.cachedRead(file);
  } catch {
    return "";
  }
}
