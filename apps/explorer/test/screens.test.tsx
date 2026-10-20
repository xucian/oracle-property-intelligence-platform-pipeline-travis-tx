import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createClient } from '@travis/api-client';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ApiProvider } from '../src/api.js';
import { hashOnMainThread } from '../src/lib/hash.js';
import type { SqlEngine } from '../src/lib/duckdb.js';
import { Agent } from '../src/screens/Agent.js';
import { Manifest } from '../src/screens/Manifest.js';
import { Mcp } from '../src/screens/Mcp.js';
import { QueryLayer } from '../src/screens/QueryLayer.js';
import { Records } from '../src/screens/Records.js';
import { Runs } from '../src/screens/Runs.js';
import { Search } from '../src/screens/Search.js';
import { Summary } from '../src/screens/Summary.js';
import { Verify } from '../src/screens/Verify.js';
import { MANIFEST_CID, RUN_ID, mockApi, realGroups, type Mock } from './fixtures.js';

function renderWithApi(ui: ReactElement, mock: Mock = mockApi()) {
  const client = createClient({
    baseUrl: 'https://api.example',
    fetch: mock.fetch,
    sleep: async () => {},
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ApiProvider client={client}>{ui}</ApiProvider>
    </QueryClientProvider>,
  );
  return { ...view, mock };
}

describe('Run summary (demo step 1)', () => {
  it('shows the completed run, sources, coverage, record counts, timestamps and limitations', async () => {
    renderWithApi(<Summary />);
    expect(await screen.findByText(RUN_ID)).toBeTruthy();
    expect(screen.getAllByText(/Travis County, TX/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('441,939').length).toBeGreaterThan(0); // properties
    expect(screen.getByText('377,962')).toBeTruthy(); // with coordinates
    expect(screen.getByText(MANIFEST_CID)).toBeTruthy();
    expect(
      (await screen.findAllByText('tcad-2026-certified-appraisal-export')).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/2026-10-18 14:35:20Z/)).toBeTruthy(); // started_at
    expect(screen.getByText(/bbb\.org/)).toBeTruthy();
    expect(screen.getByText(/http_403_source_block/)).toBeTruthy();
  });
});

describe('Records by source (demo step 2)', () => {
  it('lists each source with counts, collection time and provenance, with BBB as the API reports it', async () => {
    renderWithApi(<Records />);
    expect(await screen.findByText('Uploaded records by source')).toBeTruthy();
    expect(screen.getByText('Ownership')).toBeTruthy();
    expect(screen.getByText('Coordinates')).toBeTruthy();
    expect(screen.getAllByText(/BBB blocked \(http_403_source_block\)/).length).toBeGreaterThan(0);
    expect(await screen.findAllByTestId('property-card')).toHaveLength(1);
    const permit = await screen.findByTestId('permit-card');
    expect(within(permit).getByText('Christine Valdez')).toBeTruthy();
    expect(within(permit).getByText(/source austin-issued-construction-permits/)).toBeTruthy();
    expect(within(permit).getAllByText(/fetched 2026-10-17 12:24:23Z/).length).toBeGreaterThan(0);
  });
});

describe('Query layer (demo step 3)', () => {
  function fakeEngine() {
    const registered: { name: string; urls: string[] }[] = [];
    const engine: SqlEngine = {
      version: async () => 'v1.5.6',
      registerTables: async (tables) => void registered.push(...tables),
      query: async (sql) => ({ columns: ['rows'], rows: [[sql.length]], elapsedMs: 3 }),
    };
    return { engine, registered };
  }

  it('states the DuckDB-backed, server-less layer and runs SQL over mirrored parts, showing CIDs', async () => {
    const { engine, registered } = fakeEngine();
    renderWithApi(<QueryLayer loadEngine={async () => engine} />);
    expect(await screen.findByText(/no database server/)).toBeTruthy();
    const select = await screen.findByLabelText('Group and shard');
    fireEvent.change(select, { target: { value: 'property_improvement/s0013' } });
    fireEvent.click(screen.getByText('Row counts per table'));
    fireEvent.click(screen.getByText('Run query'));
    const read = await screen.findByTestId('cids-read');
    const tablesCid = realGroups()['property_improvement/s0013']?.tables as string;
    expect(registered.length).toBeGreaterThan(0);
    expect(
      registered.flatMap((t) => t.urls).every((u) => u.startsWith(`/tables/${tablesCid}/`)),
    ).toBe(true);
    expect(within(read).getAllByText(/^bafkrei|^bafybei/).length).toBeGreaterThan(0);
    expect(await screen.findByText(/1 rows in 3 ms/)).toBeTruthy();
  });
});

describe('Manifest (demo step 4)', () => {
  it('pages the 3,285 real objects and derives gateway URLs from the CIDs', async () => {
    renderWithApi(<Manifest />);
    expect(await screen.findByText(/3,285 objects/)).toBeTruthy();
    expect(screen.getByText(MANIFEST_CID)).toBeTruthy();
    expect(screen.getAllByTestId('manifest-row')).toHaveLength(100);
    expect(screen.getByText(/Page 1 of 33/)).toBeTruthy();
    const first = screen.getAllByTestId('manifest-row')[0] as HTMLElement;
    const cid = within(first).getAllByRole('link')[0]?.getAttribute('href') ?? '';
    expect(cid).toMatch(/^https:\/\/ipfs\.filebase\.io\/ipfs\/baguq/);
    expect(cid).toContain('?format=raw'); // first objects are directory roots
    expect(within(first).getAllByRole('link')[1]?.getAttribute('href')).toMatch(
      /^https:\/\/gateway\.pinata\.cloud\/ipfs\//,
    );
    fireEvent.click(screen.getByText('Next'));
    expect(await screen.findByText(/Page 2 of 33/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Filter manifest'), {
      target: { value: 'property_improvement/s0013/tables/address/' },
    });
    await waitFor(() => expect(screen.getAllByTestId('manifest-row')).toHaveLength(1));
  });
});

describe('Verify (demo step 5)', () => {
  it('fetches the real part from both gateways and reports a match', async () => {
    const part = readFileSync(join(import.meta.dirname, 'fixtures', 'part-bafkreiedxun32.parquet'));
    const seen: string[] = [];
    const fetchMock = async (url: string) => {
      seen.push(url);
      return new Response(new Uint8Array(part), { status: 200 });
    };
    renderWithApi(<Verify deps={{ fetch: fetchMock as never, hash: hashOnMainThread }} />);
    fireEvent.click(await screen.findByText('Smallest file part'));
    fireEvent.click(screen.getByText('Verify on both gateways'));
    expect((await screen.findByTestId('overall')).textContent).toBe('match');
    expect(seen.map((u) => new URL(u).hostname).sort()).toEqual([
      'gateway.pinata.cloud',
      'ipfs.filebase.io',
    ]);
    expect(screen.getAllByTestId('gateway-row')).toHaveLength(2);
    expect(screen.getByTestId('cors-note').textContent).toMatch(
      /gateway\.pinata\.cloud answered the probes with 429/,
    );
  });

  it('shows a gateway timeout as unverified, not a mismatch', async () => {
    const fetchMock = async () => new Response('slow', { status: 504 });
    renderWithApi(<Verify deps={{ fetch: fetchMock as never, hash: hashOnMainThread }} />);
    fireEvent.click(await screen.findByText('A directory root'));
    fireEvent.click(screen.getByText('Verify on both gateways'));
    expect((await screen.findByTestId('overall')).textContent).toBe('unverified');
  });
});

describe('Run history (demo step 6)', () => {
  it('lists every run with its manifest CID and the 177 <group>/<shard> roots', async () => {
    renderWithApi(<Runs />);
    const cards = await screen.findAllByTestId('run-card');
    expect(cards).toHaveLength(2);
    const full = cards[0] as HTMLElement;
    expect(within(full).getByText(MANIFEST_CID)).toBeTruthy();
    expect(within(full).getByText('177 group roots')).toBeTruthy();
    expect(within(full).getByText('county/s0001')).toBeTruthy();
    expect(within(cards[1] as HTMLElement).getByText(/n\/a \(not published\)/)).toBeTruthy();
  });
});

describe('Lead queries (demo steps 7 and 8)', () => {
  it('finds roofs older than 15 years around a typed center and shows basis, coordinates and provenance', async () => {
    const { mock } = renderWithApi(<Search />);
    fireEvent.change(screen.getByLabelText('Latitude'), { target: { value: '30.2672' } });
    fireEvent.change(screen.getByLabelText('Longitude'), { target: { value: '-97.7431' } });
    fireEvent.click(screen.getByText('Use coordinates'));
    fireEvent.click(screen.getByText('Search'));
    const card = await screen.findByTestId('property-card');
    expect(within(card).getByText('196364')).toBeTruthy(); // property_id
    expect(within(card).getByText('0207200906')).toBeTruthy(); // geo_id
    expect(within(card).getByText('year_built')).toBeTruthy(); // roof_age_basis
    expect(within(card).getByText(/30\.26814, -97\.68377/)).toBeTruthy();
    expect(within(card).getByText(/source tcad-2026-certified-appraisal-export/)).toBeTruthy();
    const call = mock.calls.find((c) => c.includes('/v1/properties/search')) as string;
    expect(call).toContain('roof_age_min=15');
    expect(call).toContain('open_permits=false');
    expect(call).toContain('lat=30.2672');
    expect(call).toContain('radius_miles=5');
  });

  it('lists open and stalled roofing permits with contractor attribution and BBB status', async () => {
    const { mock } = renderWithApi(<Search />);
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'permits' } });
    fireEvent.click(screen.getByText('Search'));
    const card = await screen.findByTestId('permit-card');
    expect(within(card).getByText('2014-132181 BP')).toBeTruthy();
    expect(within(card).getByText('Valdez Remodeling & Weatherization Inc.')).toBeTruthy();
    expect(within(card).getByText('Christine Valdez')).toBeTruthy();
    expect(within(card).getByText(/BBB blocked/)).toBeTruthy();
    expect(within(card).getByText(/2\.2 y \(809 d\)/)).toBeTruthy();
    expect(
      mock.calls.some(
        (c) => c.includes('/v1/permits/search') && c.includes('status_group=open%2Cstalled'),
      ),
    ).toBe(true);
  });

  it('resolves a place name through /v1/search-centers', async () => {
    const { mock } = renderWithApi(<Search />);
    fireEvent.change(screen.getByLabelText('Place'), { target: { value: 'Austin' } });
    fireEvent.click(screen.getByText('Find place'));
    await waitFor(() =>
      expect(screen.getByTestId('center').textContent).toMatch(/AUSTIN \(30\.26814, -97\.68377\)/),
    );
    expect(mock.calls).toContain('GET /v1/search-centers?q=Austin');
  });

  it('runs the free-text permit search', async () => {
    const { mock } = renderWithApi(<Search />);
    fireEvent.change(screen.getByLabelText('Question'), { target: { value: 'text' } });
    fireEvent.click(screen.getByText('Search'));
    await screen.findByTestId('permit-card');
    expect(
      mock.calls.some((c) => c.includes('/v1/permits/text-search?') && c.includes('q=re-roof')),
    ).toBe(true);
  });
});

describe('Agent panel', () => {
  it('shows the API 503 agent_unavailable message until T9', async () => {
    renderWithApi(<Agent />);
    fireEvent.click(screen.getByText('Ask the agent'));
    const note = await screen.findByTestId('agent-unavailable');
    expect(note.textContent).toContain('agent_unavailable');
    expect(note.textContent).toContain('the model is not enabled yet');
    expect(note.textContent).toContain('fixture-request');
  });
});

describe('MCP panel', () => {
  it('shows the endpoint, an example tools/call and a live tools/list', async () => {
    const mock = mockApi();
    renderWithApi(<Mcp />, mock);
    expect(screen.getByTestId('mcp-endpoint').textContent).toBe('https://api.example/v1/mcp');
    expect(screen.getByTestId('mcp-curl').textContent).toContain('"method":"tools/call"');
    expect(await screen.findByText('search_properties')).toBeTruthy();
    expect(mock.calls).toContain('POST /v1/mcp');
  });
});

describe('Provenance sanity', () => {
  it('passes every mocked response through the contract schemas (a violation would surface as an error)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderWithApi(<Summary />);
    await screen.findByText(RUN_ID);
    expect(screen.queryByRole('alert')).toBeNull();
    spy.mockRestore();
  });
});
