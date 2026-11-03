// A model field: type any id, or pick one from the provider's whole list.
// (A <datalist> would only suggest ids matching what is already typed, so with
// a model chosen it showed just that one.)
interface Props {
  label: string;
  value: string;
  models: string[];
  onChange: (model: string) => void;
  placeholder?: string;
}

export function ModelPicker({ label, value, models, onChange, placeholder }: Props) {
  return (
    <span className="model-picker">
      <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      {models.length > 0 && (
        <select aria-label={`${label}: elegir de la lista`} value={models.includes(value) ? value : ""} onChange={(e) => e.target.value && onChange(e.target.value)}>
          <option value="">Elegir de la lista ({models.length})</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}
    </span>
  );
}
