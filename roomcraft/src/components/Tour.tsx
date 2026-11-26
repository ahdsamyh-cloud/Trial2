import { useEffect, useLayoutEffect, useState } from 'react';
import { usePrefs, useUI } from '../store/uiStore';

const STEPS: { sel: string; title: string; body: string }[] = [
  { sel: '.steps', title: 'Work step by step', body: 'Go through the steps from top to bottom: floor plan → walls → services → furniture → appliances → countertop → outputs.' },
  { sel: '.panel', title: 'Step panel', body: 'Each step has its own tools here. Drag items from the libraries onto the plan, or tap an item and then tap the plan.' },
  { sel: '[data-tour="tools"]', title: 'Plan tools', body: 'Select and move, draw rooms, measure distances and pan. The ☰ button toggles the layers (furniture, electrical, plumbing, structure, dimensions).' },
  { sel: '.view-toggle', title: '2D, 3D, split and elevations', body: 'Look at the design as a plan, in 3D (with a walkthrough and exploded view), side by side, or as wall elevations.' },
  { sel: '[data-tour="checks"]', title: 'Clashes & suggestions', body: 'RoomCraft warns you when furniture covers a socket, blocks a pipe, hits a beam or blocks a door, and suggests fixes.' },
  { sel: '.menu-wrap .btn', title: 'Save your work', body: 'Projects autosave in this browser. Use File → Save as .json to keep a copy or move it to another device. Ctrl+Z undoes anything.' },
];

export function Tour() {
  const step = useUI((s) => s.tourStep);
  const setUI = useUI((s) => s.set);
  const setPrefs = usePrefs((s) => s.set);
  const [rect, setRect] = useState<DOMRect | null>(null);

  useLayoutEffect(() => {
    if (step === null) return;
    const el = document.querySelector(STEPS[step]?.sel ?? '');
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);
  useEffect(() => {
    if (step === null) return;
    const onResize = () => {
      const el = document.querySelector(STEPS[step]?.sel ?? '');
      setRect(el ? el.getBoundingClientRect() : null);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [step]);

  if (step === null) return null;
  const s = STEPS[step];
  const end = () => {
    setUI({ tourStep: null });
    setPrefs({ tourDone: true });
  };
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const cardW = Math.min(320, vw - 24);
  let left = 12;
  let top = vh / 2 - 80;
  if (rect) {
    left = rect.right + 12 + cardW < vw ? rect.right + 12 : Math.max(12, Math.min(vw - cardW - 12, rect.left));
    top = rect.right + 12 + cardW < vw ? Math.max(12, Math.min(vh - 200, rect.top)) : Math.min(vh - 200, rect.bottom + 12);
  }
  return (
    <div className="tour" role="dialog" aria-label="Guided tour">
      {rect && <div className="tour-hole" style={{ left: rect.left - 4, top: rect.top - 4, width: rect.width + 8, height: rect.height + 8 }} />}
      <div className="tour-card" style={{ left, top, width: cardW }}>
        <small>
          {step + 1} / {STEPS.length}
        </small>
        <h3>{s.title}</h3>
        <p>{s.body}</p>
        <div className="row">
          <button className="btn" onClick={end}>
            Skip
          </button>
          <span className="spacer" />
          {step > 0 && (
            <button className="btn" onClick={() => setUI({ tourStep: step - 1 })}>
              Back
            </button>
          )}
          <button className="btn primary" onClick={() => (step + 1 < STEPS.length ? setUI({ tourStep: step + 1 }) : end())}>
            {step + 1 < STEPS.length ? 'Next' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  );
}
