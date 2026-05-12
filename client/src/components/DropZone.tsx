import { useCallback, useState, useRef } from "react";
import "./DropZone.css";

interface Props {
  onFiles: (files: File[]) => void;
  disabled: boolean;
}

export default function DropZone({ onFiles, disabled }: Props) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      if (disabled) return;
      const files = Array.from(e.dataTransfer.files);
      if (files.length) onFiles(files);
    },
    [disabled, onFiles]
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []);
      if (files.length) onFiles(files);
      // Reset so the same file can be re-selected
      e.target.value = "";
    },
    [onFiles]
  );

  return (
    <div
      className={`dropzone ${dragging ? "dropzone--active" : ""} ${
        disabled ? "dropzone--disabled" : ""
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => !disabled && inputRef.current?.click()}
      role="button"
      tabIndex={0}
      aria-label="Drop files here or click to browse"
      onKeyDown={(e) => e.key === "Enter" && !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        onChange={handleChange}
        disabled={disabled}
      />
      <div className="dropzone__icon">{dragging ? "⬇" : "◈"}</div>
      <p className="dropzone__primary">
        {dragging ? "Release to add files" : "Drop files here"}
      </p>
      <p className="dropzone__secondary">or click to browse — up to 10 files, 50 MB each</p>
    </div>
  );
}
