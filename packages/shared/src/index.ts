export interface WorkspaceSummary {
  id: string;
  displayName: string;
  absolutePath: string;
}

export function normalizeDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}
