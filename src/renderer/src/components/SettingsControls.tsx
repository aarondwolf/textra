import type { ReactNode } from 'react';
import { HelpTooltip } from './HelpTooltip';

export function SettingPair({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: ReactNode;
}) {
  return (
    <div className="setting-pair">
      <div className="setting-pair-label">
        <span>{label}</span>
        {help && <HelpTooltip label={`Help: ${label}`} content={help} />}
      </div>
      <div className="setting-pair-control">{children}</div>
    </div>
  );
}

export function RadioChoice({
  label,
  value,
  onChange,
  options = [
    { value: 'on', label: 'On' },
    { value: 'off', label: 'Off' },
  ],
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options?: Array<{ value: string; label: string }>;
}) {
  return (
    <fieldset className="setting-radio-group" aria-label={label}>
      {options.map((option) => (
        <label className="setting-radio-option" key={option.value}>
          <input
            type="radio"
            name={label}
            value={option.value}
            checked={value === option.value}
            onChange={() => onChange(option.value)}
          />
          <span>{option.label}</span>
        </label>
      ))}
    </fieldset>
  );
}

export function SettingSwitch({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
}) {
  return (
    <label className="texlab-toggle setting-switch">
      <input
        type="checkbox"
        role="switch"
        aria-label={label}
        checked={checked}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
    </label>
  );
}
