import { useClashes, useSuggestions } from '../store/derived';
import { useUI } from '../store/uiStore';
import { applySuggestion } from '../store/actions';
import type { TargetRef } from '../model/checks';
import type { Selection } from '../store/uiStore';

function toSelection(t: TargetRef): Selection {
  switch (t.kind) {
    case 'module':
      return { kind: 'module', id: t.id, ids: [t.id] };
    case 'appliance':
      return { kind: 'appliance', id: t.id };
    default:
      return { kind: t.kind, id: t.id };
  }
}

export function ChecksButton() {
  const issues = useClashes();
  const sugg = useSuggestions();
  const setUI = useUI((s) => s.set);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.length - errors;
  return (
    <button
      className={`btn checks-btn${errors ? ' has-errors' : warns ? ' has-warnings' : ''}`}
      onClick={() => setUI({ checksOpen: !useUI.getState().checksOpen })}
      title="Clash detection & design suggestions"
      data-tour="checks"
    >
      {errors ? `⚠ ${errors}` : warns ? `! ${warns}` : '✓'}
      <span className="hide-mobile">{errors + warns ? ' clashes' : ' no clashes'}</span>
      {sugg.length > 0 && <b className="badge-dot">{sugg.length}</b>}
    </button>
  );
}

export function ChecksDrawer() {
  const open = useUI((s) => s.checksOpen);
  const setUI = useUI((s) => s.set);
  const issues = useClashes();
  const sugg = useSuggestions();
  if (!open) return null;
  return (
    <aside className="checks">
      <header>
        <h2>Checks</h2>
        <button className="btn icon" onClick={() => setUI({ checksOpen: false })} aria-label="Close">
          ✕
        </button>
      </header>
      <h3>Clashes ({issues.length})</h3>
      {!issues.length && <p className="hint">No clashes: furniture clears sockets, pipes, beams, columns, door swings and windows.</p>}
      <ul className="issues">
        {issues.map((i) => (
          <li key={i.id} className={i.severity}>
            <button onClick={() => i.targets[0] && setUI({ selection: toSelection(i.targets[0]) })}>
              <span className="sev">{i.severity === 'error' ? '⛔' : i.severity === 'warning' ? '⚠' : 'ℹ'}</span>
              {i.message}
            </button>
          </li>
        ))}
      </ul>
      <h3>Suggestions ({sugg.length})</h3>
      {!sugg.length && <p className="hint">Nothing to suggest right now.</p>}
      <ul className="issues">
        {sugg.map((s) => (
          <li key={s.id} className="info">
            <div>
              <span className="sev">💡</span>
              <span
                className={s.targets[0] ? 'linkish' : ''}
                onClick={() => s.targets[0] && setUI({ selection: toSelection(s.targets[0]) })}
              >
                {s.message}
              </span>
            </div>
            {s.action && (
              <button className="btn small primary" onClick={() => applySuggestion(s.action!)}>
                {s.actionLabel ?? 'Apply'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </aside>
  );
}
