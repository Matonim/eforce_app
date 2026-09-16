import { formatDuration, formatNumber, formatRaceTime } from '../lib/format.js';

/**
 * The end-of-season competition, one announcement at a time. The server only sends the steps the
 * Game Master has already revealed, so this renders the latest one.
 */
export function RaceScreen({ race, teams, myTeamId = null, children }) {
  // Teams only receive the revealed steps; the GM receives all of them, so index by race.step.
  const step = race.steps[race.step] ?? race.steps.at(-1);
  const byId = Object.fromEntries(teams.map((t) => [t.id, t]));
  const discipline = race.disciplines.find((d) => d.id === step.disciplineId) ?? null;

  return (
    <section className="card race">
      <header className="race__head">
        <div>
          <h2 className="race__title">{step.title}</h2>
          <p className="muted">{step.subtitle}</p>
        </div>
        <span className="race__progress muted small">
          {race.step + 1}/{race.totalSteps}
        </span>
      </header>
      {children}
      <StepBody step={step} discipline={discipline} byId={byId} myTeamId={myTeamId} />
    </section>
  );
}

function StepBody({ step, discipline, byId, myTeamId }) {
  const unit = discipline?.unit ?? '';
  switch (step.kind) {
    case 'intro':
      return <p className="race__lead">The season is over. Ten disciplines, one trophy — let's go.</p>;

    case 'static-preliminary':
      return (
        <>
          <ResultTable
            rows={step.rows}
            byId={byId}
            myTeamId={myTeamId}
            columns={['score', 'points']}
            emptyMessage="Small field: every team goes straight to the finals."
          />
          <p className="race__lead">
            Through to the finals: {step.finalistIds.map((id) => byId[id]?.name ?? id).join(', ')}
          </p>
        </>
      );

    case 'static-finals':
      return (
        <>
          <ResultTable rows={step.rows} byId={byId} myTeamId={myTeamId} columns={['finalScore', 'points']} />
          <h3 className="subhead">Discipline standings</h3>
          <ResultTable rows={step.standings} byId={byId} myTeamId={myTeamId} columns={['points']} compact />
        </>
      );

    case 'timed':
      return <ResultTable rows={step.rows} byId={byId} myTeamId={myTeamId} columns={['time', 'points']} unit={unit} />;

    case 'efficiency':
      return <ResultTable rows={step.rows} byId={byId} myTeamId={myTeamId} columns={['energy', 'points']} unit={unit} />;

    case 'endurance-lap':
      return (
        <>
          {step.retirements.map((dnf) => (
            <p key={dnf.teamId} className="race__retire">
              🚩 <strong>{byId[dnf.teamId]?.name ?? dnf.teamId}</strong> is out on lap {dnf.lap} — {dnf.reason}.
            </p>
          ))}
          <FastestLap fastestLap={step.fastestLap} byId={byId} />
          <LapBoard order={step.order} fastestLap={step.fastestLap} byId={byId} myTeamId={myTeamId} />
        </>
      );

    case 'endurance-result':
      return (
        <>
          <FastestLap fastestLap={step.fastestLap} byId={byId} />
          <ResultTable rows={step.rows} byId={byId} myTeamId={myTeamId} columns={['endurance', 'bestLap', 'points']} unit={unit} />
        </>
      );

    case 'totals':
      return <ResultTable rows={step.rows} byId={byId} myTeamId={myTeamId} columns={['total']} />;

    case 'podium':
      return (
        <ol className="podium">
          {step.rows.map((row) => (
            <li key={row.teamId} className={`podium__place podium__place--${row.place}`}>
              <span className="podium__medal">{['🥇', '🥈', '🥉'][row.place - 1]}</span>
              <span className="swatch swatch--lg" style={{ background: byId[row.teamId]?.color }} />
              <span className="podium__name">{byId[row.teamId]?.name ?? row.teamId}</span>
              <span className="podium__points">{formatNumber(row.total)} pts</span>
            </li>
          ))}
        </ol>
      );

    default:
      return null;
  }
}

const HEADINGS = {
  score: 'Score',
  finalScore: 'Finals',
  time: 'Time',
  energy: 'Energy used',
  endurance: 'Total time',
  bestLap: 'Best lap',
  points: 'Points',
  total: 'Total',
};

function ResultTable({ rows, byId, myTeamId, columns, unit = '', compact = false, emptyMessage = 'Nobody entered this one.' }) {
  if (!rows.length) return <p className="muted">{emptyMessage}</p>;
  return (
    <div className="table-wrap">
      <table className={`table ${compact ? 'table--compact' : ''}`}>
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Team</th>
            {columns.map((c) => (
              <th key={c} scope="col" className="num">
                {HEADINGS[c]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={row.teamId} className={row.teamId === myTeamId ? 'table__me' : undefined}>
              <td>{row.place ?? i + 1}</td>
              <td>
                <span className="swatch" style={{ background: byId[row.teamId]?.color }} /> {byId[row.teamId]?.name ?? row.teamId}
              </td>
              {columns.map((c) => (
                <td key={c} className="num">
                  <Cell row={row} column={c} unit={unit} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Cell({ row, column, unit }) {
  if (column === 'points') return <strong>{formatNumber(row.points)}</strong>;
  if (column === 'total') return <strong>{formatNumber(row.total)}</strong>;
  if (column === 'score' || column === 'finalScore') return formatNumber(row[column] ?? row.score);
  if (column === 'time' || column === 'energy') {
    if (row.status === 'not-entered') return <span className="muted">no driverless car</span>;
    if (row.status === 'no-time') return <span className="muted">no finish</span>;
    return `${formatRaceTime(row.time)} ${unit}`;
  }
  if (column === 'endurance') {
    if (row.status === 'dnf') return <span className="race__dnf">DNF lap {row.dnfLap} — {row.reason}</span>;
    return formatDuration(row.time);
  }
  if (column === 'bestLap') return row.bestLap == null ? <span className="muted">—</span> : `${formatRaceTime(row.bestLap)} s`;
  return null;
}

/** "⏱ Fastest lap: Team Graz, 73.85 s on lap 4" */
function FastestLap({ fastestLap, byId }) {
  if (!fastestLap) return null;
  return (
    <p className="race__fastest">
      ⏱ Fastest lap: <strong>{byId[fastestLap.teamId]?.name ?? fastestLap.teamId}</strong>, {formatRaceTime(fastestLap.time)} s on lap{' '}
      {fastestLap.lap}
    </p>
  );
}

/** Live timing after each endurance lap: total time, gap to the leader, last lap and best lap. */
function LapBoard({ order, fastestLap, byId, myTeamId }) {
  return (
    <div className="table-wrap">
      <table className="table lapboard">
        <thead>
          <tr>
            <th scope="col">#</th>
            <th scope="col">Team</th>
            <th scope="col" className="num">Total time</th>
            <th scope="col" className="num">Gap</th>
            <th scope="col" className="num">Last lap</th>
            <th scope="col" className="num">Best lap</th>
          </tr>
        </thead>
        <tbody>
          {order.map((car, i) => {
            const out = car.status === 'dnf';
            const fastest = fastestLap?.teamId === car.teamId;
            return (
              <tr key={car.teamId} className={[car.teamId === myTeamId && 'table__me', out && 'lapboard__out'].filter(Boolean).join(' ') || undefined}>
                <td>{out ? '—' : i + 1}</td>
                <td>
                  <span className="swatch" style={{ background: byId[car.teamId]?.color }} /> {byId[car.teamId]?.name ?? car.teamId}
                </td>
                <td className="num">{out ? <span className="race__dnf">out after {car.laps} {car.laps === 1 ? 'lap' : 'laps'}</span> : formatDuration(car.total)}</td>
                <td className="num">{out ? '' : car.gap ? `+${car.gap >= 60 ? formatDuration(car.gap) : formatRaceTime(car.gap)}` : <span className="muted">leader</span>}</td>
                <td className="num">{car.lastLap == null ? <span className="muted">—</span> : formatRaceTime(car.lastLap)}</td>
                <td className="num">
                  {car.bestLap == null ? (
                    <span className="muted">—</span>
                  ) : (
                    <>
                      {fastest && (
                        <span className="lapboard__fastest" title="Fastest lap of the race" aria-label="Fastest lap of the race">
                          ⏱{' '}
                        </span>
                      )}
                      {formatRaceTime(car.bestLap)}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
