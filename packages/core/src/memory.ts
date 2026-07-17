import { randomUUID } from "node:crypto";

export type MemoryRecord = {
  id: string;
  workspaceId: string;
  projectId: string;
  text: string;
  tags: string[];
  createdAt: string;
};

export class ScopedMemory {
  #records: MemoryRecord[] = [];

  remember(input: Omit<MemoryRecord, "id" | "createdAt">): MemoryRecord {
    const record: MemoryRecord = { ...input, id: randomUUID(), createdAt: new Date().toISOString() };
    this.#records.unshift(record);
    return record;
  }

  query(workspaceId: string, projectId: string, query: string, limit = 8): MemoryRecord[] {
    const terms = query.toLowerCase().split(/\W+/).filter(Boolean);
    return this.#records
      .filter((record) => record.workspaceId === workspaceId && record.projectId === projectId)
      .map((record) => ({ record, score: terms.reduce((score, term) => score + Number(record.text.toLowerCase().includes(term)), 0) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ record }) => record);
  }
}
