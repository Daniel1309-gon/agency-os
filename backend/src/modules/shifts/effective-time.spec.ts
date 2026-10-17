import { describe, expect, it } from 'vitest';
import { effectiveMinutes, effectiveTimeSegments, type Interval } from './effective-time.port.js';

const DAY = '2026-08-23T';
function at(time: string): Date {
  return new Date(`${DAY}${time}:00.000Z`);
}
function span(from: string, to: string): Interval {
  return { start: at(from), end: at(to) };
}

const shift = [span('06:05', '14:05')];
const wholeShift = [span('06:05', '14:05')];

describe('effectiveMinutes', () => {
  it('subtracts the break from the worked window', () => {
    expect(effectiveMinutes({ approved: shift, sessions: wholeShift, breaks: [span('13:00', '14:05')] })).toBe(415);
  });

  it('never counts time outside the approved shift', () => {
    // La sesion se abrio una hora antes y se cerro una hora despues del turno.
    expect(effectiveMinutes({ approved: shift, sessions: [span('05:05', '15:05')], breaks: [] })).toBe(480);
  });

  it('extends the approved window with an overtime override', () => {
    expect(effectiveMinutes({ approved: [...shift, span('14:05', '16:05')], sessions: [span('06:05', '16:05')], breaks: [] })).toBe(600);
  });

  it('counts overlapping sessions once', () => {
    // Ocho perfiles abiertos a la vez son ocho sesiones, no ocho jornadas.
    const sessions = Array.from({ length: 8 }, () => span('06:05', '14:05'));
    expect(effectiveMinutes({ approved: shift, sessions, breaks: [] })).toBe(480);
  });

  it('collapses overlapping breaks instead of discounting them twice', () => {
    const breaks = [span('10:00', '10:30'), span('10:15', '10:45')];
    expect(effectiveMinutes({ approved: shift, sessions: wholeShift, breaks })).toBe(435);
  });

  it('returns zero when no session ever opened', () => {
    // Consecuencia deliberada de FR-17: el tiempo efectivo mide trabajo, no presencia.
    expect(effectiveMinutes({ approved: shift, sessions: [], breaks: [] })).toBe(0);
  });

  it('ignores inverted and empty intervals instead of going negative', () => {
    expect(effectiveMinutes({ approved: shift, sessions: [span('12:00', '10:00'), span('11:00', '11:00')], breaks: [] })).toBe(0);
  });

  it('handles the night shift that crosses UTC midnight', () => {
    // 22:05 a 06:05 hora Bogota. Colombia no tiene DST, asi que la duracion no depende del huso.
    const night = [{ start: new Date('2026-08-23T03:05:00.000Z'), end: new Date('2026-08-23T11:05:00.000Z') }];
    expect(effectiveMinutes({ approved: night, sessions: night, breaks: [{ start: new Date('2026-08-23T05:00:00.000Z'), end: new Date('2026-08-23T05:30:00.000Z') }] })).toBe(450);
  });

  it('handles a session split by a break in the middle', () => {
    const segments = effectiveTimeSegments({ approved: shift, sessions: wholeShift, breaks: [span('10:00', '10:30')] });
    expect(segments).toEqual([span('06:05', '10:00'), span('10:30', '14:05')]);
  });
});

describe('effectiveTimeSegments reconciles with the total', () => {
  // Reconciliacion pedida por OPS-07: la suma de los tramos es el total, sin huecos ni dobles.
  const cases: Array<{ name: string; input: Parameters<typeof effectiveMinutes>[0] }> = [
    { name: 'sesiones fragmentadas', input: { approved: shift, sessions: [span('06:05', '08:00'), span('09:00', '12:00'), span('12:30', '14:05')], breaks: [span('10:00', '10:20')] } },
    { name: 'break fuera de la sesion', input: { approved: shift, sessions: [span('06:05', '09:00')], breaks: [span('11:00', '11:30')] } },
    { name: 'break cubriendo todo', input: { approved: shift, sessions: wholeShift, breaks: [span('06:05', '14:05')] } },
    { name: 'override desconectado del turno', input: { approved: [...shift, span('18:00', '20:00')], sessions: [span('06:05', '20:00')], breaks: [] } },
  ];

  for (const { name, input } of cases) {
    it(name, () => {
      const segments = effectiveTimeSegments(input);
      const summed = segments.reduce((total, segment) => total + (segment.end.getTime() - segment.start.getTime()), 0);
      expect(Math.round(summed / 60_000)).toBe(effectiveMinutes(input));
      expect(effectiveMinutes(input)).toBeGreaterThanOrEqual(0);
      for (const [index, segment] of segments.entries()) {
        expect(segment.end.getTime()).toBeGreaterThan(segment.start.getTime());
        if (index > 0) expect(segment.start.getTime()).toBeGreaterThanOrEqual(segments[index - 1].end.getTime());
      }
    });
  }

  it('never exceeds the approved window, whatever the sessions do', () => {
    const approvedMinutes = 480;
    for (let offset = -240; offset <= 240; offset += 17) {
      const sessions = [{ start: new Date(at('06:05').getTime() + offset * 60_000), end: new Date(at('14:05').getTime() + offset * 60_000) }];
      const minutes = effectiveMinutes({ approved: shift, sessions, breaks: [] });
      expect(minutes).toBeGreaterThanOrEqual(0);
      expect(minutes).toBeLessThanOrEqual(approvedMinutes);
    }
  });
});
