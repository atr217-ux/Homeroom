"use client";

type Props = {
  value: boolean;
  onChange: (next: boolean) => void;
  ariaLabel: string;
};

// Small pill-shaped toggle matching ThemeToggle's visual style.
export default function SettingToggle({ value, onChange, ariaLabel }: Props) {
  return (
    <button
      onClick={() => onChange(!value)}
      aria-pressed={value}
      aria-label={ariaLabel}
      className="relative inline-flex items-center w-14 h-8 rounded-full transition-colors flex-shrink-0"
      style={{ background: value ? "var(--purple)" : "var(--border-2)" }}
    >
      <span
        className="absolute top-1 w-6 h-6 rounded-full shadow-md transition-transform"
        style={{
          background: "var(--surface)",
          transform: value ? "translateX(28px)" : "translateX(4px)",
        }}
      />
    </button>
  );
}
