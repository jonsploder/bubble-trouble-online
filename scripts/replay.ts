// Backtest the current netcode against recorded sessions.
//
//   npm run replay                 (reads every .json in traces/)
//   npm run replay -- some/dir
//   npm run replay -- --sweep      (compare alternative netcode settings)
//
// A trace holds, for each player: when their display frames happened, what they were
// holding, and when each packet from each other player arrived. From those we rebuild the
// real links (delay of every packet, which ones were lost) and each player's real input
// timeline, then run today's RollbackSession over it. Because the trace records the
// *conditions* rather than what the old netcode did with them, it stays useful after the
// netcode changes. See scripts/tracelib.ts.
import { loadSessions, runAll, setQuiet, sweep } from './tracelib';
import type { Totals } from './tracelib';

declare const process: { argv: string[]; exit(code: number): never };

const args = process.argv.slice(2);
const dir = args.find((a) => !a.startsWith('--')) ?? 'traces';
const sessions = loadSessions(dir);
if (!sessions.length) { console.log(`No traces in ${dir}/. Run "npm run fetch-traces" first.`); process.exit(0); }

const row = (label: string, T: Totals) =>
  `${label.padEnd(34)} badness ${(T.bad / Math.max(1, T.n)).toFixed(3)}  frozen ${(100 * T.stalled / T.ticks).toFixed(2)}%  slowed ${(100 * T.slowed / T.ticks).toFixed(2)}%  ` +
  `rollback avg ${(T.rollbackFrames / Math.max(1, T.rollbacks)).toFixed(2)}f max ${T.maxRollback}f  other-player error avg ${(T.errSum / T.confirmed).toFixed(2)}px, >8px ${(100 * T.errFrames / T.confirmed).toFixed(2)}%${T.ok ? '' : '  DESYNC'}`;

if (args.includes('--sweep')) {
  console.log(`${sessions.length} sessions\n`);
  for (const { label, T } of sweep(sessions)) console.log(row(label, T));
  process.exit(0);
}
const { T } = runAll(sessions);
setQuiet(false);
console.log(`\n${T.n} session(s) replayed. Mean badness ${(T.bad / Math.max(1, T.n)).toFixed(3)} (lower is better; 0 = no freezes, slowdowns or visible corrections).`);
console.log(row('all sessions, current netcode:', T));
process.exit(T.ok ? 0 : 1);
