/** Internal identity tracking for one provider-defined response/choice scope. */
export class ToolCallIdTracker {
  private owners = new Map<string, string>();
  private conflicted = new Set<string>();

  /** Return newly disqualified coordinates when an ID names multiple calls. */
  observe(id: unknown, sourceKey: string): readonly string[] {
    if (typeof id !== "string" || id.length === 0) return [];
    const owner = this.owners.get(id);
    if (owner === undefined) {
      this.owners.set(id, sourceKey);
      return [];
    }
    if (owner === sourceKey) return [];
    const affected: string[] = [];
    // Keep the first owner. Every additional collision costs constant work,
    // and each affected coordinate gets at most one retained diagnostic.
    for (const key of [owner, sourceKey]) {
      if (this.conflicted.has(key)) continue;
      this.conflicted.add(key);
      affected.push(key);
    }
    return affected;
  }
}
