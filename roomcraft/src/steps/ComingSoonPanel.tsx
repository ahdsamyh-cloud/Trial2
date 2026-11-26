import type { StepDef } from '../components/steps';

const PLANS: Record<string, string[]> = {
  services: ['Sockets, switches, light & AC points', 'Water inlets, drains, gas line', 'Beams, slabs, drop ceilings, skirting', 'Doors, windows and columns'],
  furniture: ['Parametric kitchen, wardrobe and room modules', 'Board thickness & materials per module/panel', 'Edge banding, handles, hardware auto-count', 'Drag onto walls with snapping'],
  appliances: ['Sinks, hobs, hoods, ovens, fridges…', 'Automatic cabinet cut-outs'],
  countertop: ['Stone library, thickness, overhang, backsplash', 'Sink/hob cut-outs and L/U joints', 'Countertop sheet layout'],
  outputs: ['Cut list (CSV/Excel)', 'Sheet nesting with kerf', 'Hardware list & cost estimate', 'PDF drawings'],
};

export function ComingSoonPanel({ step }: { step: StepDef }) {
  return (
    <div className="coming-soon">
      <p className="badge">Phase {step.phase}</p>
      <p>This step is planned for phase {step.phase}. It will include:</p>
      <ul>
        {(PLANS[step.id] ?? []).map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );
}
