import { useEffect, useState } from 'react';
import { usePrefs } from '../store/uiStore';
import { formatLength, parseLength } from '../model/units';

interface Props {
  value: number;
  onChange: (mm: number) => void;
  min?: number;
  max?: number;
  label?: string;
  title?: string;
  id?: string;
}

/** Text field showing a length in the user's units; accepts any unit when typing ("2.4m", "8' 6\""). */
export function LengthInput({ value, onChange, min = 1, max = 1e6, label, title, id }: Props) {
  const units = usePrefs((s) => s.units);
  const fmt = (mm: number) => formatLength(mm, units, { suffix: units === 'ftin' });
  const [text, setText] = useState(fmt(value));
  const [error, setError] = useState(false);
  useEffect(() => {
    setText(fmt(value));
    setError(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, units]);

  const commit = () => {
    const mm = parseLength(text, units);
    if (mm === null || mm < min || mm > max) {
      setError(true);
      return;
    }
    setError(false);
    if (Math.abs(mm - value) > 0.01) onChange(Math.round(mm * 10) / 10);
    else setText(fmt(value));
  };

  const input = (
    <span className={`length-input${error ? ' error' : ''}`} title={title}>
      <input
        id={id}
        value={text}
        inputMode="decimal"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') {
            setText(fmt(value));
            setError(false);
          }
          e.stopPropagation();
        }}
      />
      {units !== 'ftin' && <em>{units}</em>}
    </span>
  );
  if (!label) return input;
  return (
    <label className="field">
      <span>{label}</span>
      {input}
    </label>
  );
}
