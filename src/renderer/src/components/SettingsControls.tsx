import type { ReactNode } from 'react';
import * as RadioGroup from '@radix-ui/react-radio-group';
import * as Switch from '@radix-ui/react-switch';
import { useId } from 'react';
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
  const id = useId();
  return (
    <RadioGroup.Root
      className="setting-radio-group"
      aria-label={label}
      value={value}
      onValueChange={onChange}
      orientation="horizontal"
    >
      {options.map((option, index) => {
        const optionId = `${id}-${index}`;
        return (
          <div className="setting-radio-option" key={option.value}>
            <RadioGroup.Item
              className="setting-radio-item"
              id={optionId}
              value={option.value}
              aria-label={option.label}
            >
              <RadioGroup.Indicator className="setting-radio-indicator" />
            </RadioGroup.Item>
            <label htmlFor={optionId}>{option.label}</label>
          </div>
        );
      })}
    </RadioGroup.Root>
  );
}

export function SettingSwitch({
  label,
  checked,
  onCheckedChange,
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <Switch.Root
      className="setting-switch-root"
      aria-label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
    >
      <Switch.Thumb className="setting-switch-thumb" />
    </Switch.Root>
  );
}
