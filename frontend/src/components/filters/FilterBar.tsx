export interface FilterChip {
  label: string;
  value: string;
}

export interface FilterBarProps {
  chips: FilterChip[];
}

export function FilterBar({ chips }: FilterBarProps) {
  return (
    <div className="filter-bar">
      {chips.map((chip) => (
        <button key={`${chip.label}-${chip.value}`} className="filter-chip" type="button">
          <span className="filter-chip__label">{chip.label}</span>
          <strong>{chip.value}</strong>
        </button>
      ))}
    </div>
  );
}
