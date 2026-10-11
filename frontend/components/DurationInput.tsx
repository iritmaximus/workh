import { useEffect, useState } from 'react';
import { formatHM, parseDuration } from '../calc';

interface Props {
  value: number | null;
  onChange: (minutes: number | null) => void;
  placeholder?: string;
  ariaLabel?: string;
  /** Allowed range in minutes; values outside it are marked invalid and not committed. */
  min?: number;
  max?: number;
}

/**
 * Free-text duration field ("7.5", "7.15", "7:15", "7h15"). Valid input is committed as you type;
 * on blur the text is normalised to h:mm. Invalid text is kept and outlined until fixed.
 */
export function DurationInput({ value, onChange, placeholder, ariaLabel, min = -Infinity, max = Infinity }: Props) {
  const [text, setText] = useState(value === null ? '' : formatHM(value));
  const inRange = (m: number | null) => (m !== null && m >= min && m <= max ? m : null);
  const parsed = inRange(parseDuration(text));
  const invalid = text.trim() !== '' && parsed === null;

  // Follow outside changes (another tab's edit merged in, data refreshed), but leave
  // the text alone while it already means the current value — or is being typed.
  useEffect(() => {
    if (value !== parsed && !(value === null && text.trim() === '')) {
      setText(value === null ? '' : formatHM(value));
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- only react to new values
  }, [value]);

  return (
    <input
      className={`duration${invalid ? ' invalid' : ''}`}
      type="text"
      inputMode="decimal"
      value={text}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-invalid={invalid}
      onChange={(e) => {
        setText(e.target.value);
        const p = inRange(parseDuration(e.target.value));
        if (e.target.value.trim() === '') onChange(null);
        else if (p !== null) onChange(p);
      }}
      onBlur={() => {
        if (parsed !== null) setText(formatHM(parsed));
      }}
    />
  );
}
