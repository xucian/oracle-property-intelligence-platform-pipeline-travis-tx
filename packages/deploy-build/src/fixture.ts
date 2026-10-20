export interface FixtureReport {
  bytes: number;
  counts: Record<string, number>;
}
export async function buildFixture(_o: { fullDb: string; outFile: string; log: (m: string) => void }): Promise<FixtureReport> {
  throw new Error('not implemented yet');
}
