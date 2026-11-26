import { STEPS, CURRENT_PHASE } from './steps';
import { useUI } from '../store/uiStore';
import { FloorPlanPanel } from '../steps/FloorPlanPanel';
import { WallsPanel } from '../steps/WallsPanel';
import { ServicesPanel } from '../steps/ServicesPanel';
import { FurniturePanel } from '../steps/FurniturePanel';
import { AppliancesPanel } from '../steps/AppliancesPanel';
import { CountertopPanel } from '../steps/CountertopPanel';
import { OutputsPanel } from '../steps/OutputsPanel';

export function Sidebar() {
  const step = useUI((s) => s.step);
  const open = useUI((s) => s.sidebarOpen);
  const setUI = useUI((s) => s.set);
  const def = STEPS.find((s) => s.id === step)!;

  return (
    <aside className={`sidebar${open ? ' open' : ''}`}>
      <nav className="steps" aria-label="Design steps">
        {STEPS.map((s, i) => (
          <button
            key={s.id}
            className={`step${s.id === step ? ' active' : ''}${s.phase > CURRENT_PHASE ? ' locked' : ''}`}
            onClick={() => setUI({ step: s.id, sidebarOpen: true, tool: 'select', placing: null })}
            title={s.phase > CURRENT_PHASE ? `${s.title} — coming in phase ${s.phase}` : s.title}
          >
            <span className="step-num">{i + 1}</span>
            <span className="step-icon" aria-hidden>
              {s.icon}
            </span>
            <span className="step-label">{s.short}</span>
          </button>
        ))}
      </nav>
      <section className="panel">
        <header className="panel-head">
          <h2>
            {STEPS.indexOf(def) + 1}. {def.title}
          </h2>
          <button className="btn icon only-mobile" onClick={() => setUI({ sidebarOpen: false })} aria-label="Close panel">
            ✕
          </button>
        </header>
        <div className="panel-body">
          {step === 'floor' && <FloorPlanPanel />}
          {step === 'walls' && <WallsPanel />}
          {step === 'services' && <ServicesPanel />}
          {step === 'furniture' && <FurniturePanel />}
          {step === 'appliances' && <AppliancesPanel />}
          {step === 'countertop' && <CountertopPanel />}
          {step === 'outputs' && <OutputsPanel />}
        </div>
        <footer className="panel-foot">
          <button
            className="btn"
            disabled={STEPS.indexOf(def) === 0}
            onClick={() => setUI({ step: STEPS[STEPS.indexOf(def) - 1].id })}
          >
            ← Back
          </button>
          <button
            className="btn primary"
            disabled={STEPS.indexOf(def) === STEPS.length - 1}
            onClick={() => setUI({ step: STEPS[STEPS.indexOf(def) + 1].id })}
          >
            Next →
          </button>
        </footer>
      </section>
    </aside>
  );
}
