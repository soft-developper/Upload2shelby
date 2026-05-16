import "./DurationSlider.css";

interface Props {
  days: number;
  onChange: (days: number) => void;
  disabled: boolean;
}

export default function DurationSlider({ days, onChange, disabled }: Props) {
  return (
    <div className={`duration ${disabled ? "duration--disabled" : ""}`}>
      <div className="duration__header">
        <span className="duration__label">Storage duration</span>
        <span className="duration__value">{days} days</span>
      </div>
      <input
        type="range"
        min={30}
        max={360}
        step={30}
        value={days}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="duration__slider"
      />
      <div className="duration__marks">
        <span>30d</span>
        <span>90d</span>
        <span>180d</span>
        <span>270d</span>
        <span>360d</span>
      </div>
      <p className="duration__hint">
        Files will be stored until{" "}
        <strong>{new Date(Date.now() + days * 86400000).toLocaleDateString()}</strong>
      </p>
    </div>
  );
}
