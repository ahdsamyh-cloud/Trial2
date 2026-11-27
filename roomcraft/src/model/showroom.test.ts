import { sampleShowroom } from './sample';
import { detectClashes } from './checks';
import { buildCountertop } from './countertop';
import { dimensionLines, furnishedWallIds, furnitureRuns } from './annotations';
import { buildModule } from './furniture';

describe('showroom sample', () => {
  const p = sampleShowroom();
  it('is clash-free', () => {
    expect(detectClashes(p).filter((i) => i.severity !== 'info').map((i) => i.message)).toEqual([]);
  });
  it('makes an L worktop with sink and hob cut-outs', () => {
    const pcs = buildCountertop(p);
    expect(pcs).toHaveLength(2);
    expect(pcs.flatMap((x) => x.cutouts.map((c) => c.kind)).sort()).toEqual(['hob', 'sink']);
  });
  it('opens the cabinets for the built-in ovens and microwave', () => {
    const tall = p.modules.find((m) => m.name === 'Oven tower')!;
    const b = buildModule(tall, p);
    expect(b.panels.filter((x) => x.name.startsWith('Shelf under')).length).toBe(2);
    expect(b.panels.filter((x) => x.role === 'drawer-front')).toHaveLength(2);
    const mw = buildModule(p.modules.find((m) => m.name === 'Microwave unit')!, p);
    expect(mw.panels.filter((x) => x.role === 'door')).toHaveLength(0);
  });
  it('produces runs, dimension lines and furnished walls', () => {
    const runs = furnitureRuns(p);
    expect(runs.map((r) => Math.round(r.u1)).sort()).toEqual([2400, 3400]);
    const dims = dimensionLines(p);
    expect(dims.some((d) => d.kind === 'overall' && Math.round(d.value) === 3400)).toBe(true);
    expect(dims.some((d) => d.kind === 'height' && Math.round(d.value) === 870)).toBe(true);
    expect(furnishedWallIds(p).size).toBe(2);
  });
});
