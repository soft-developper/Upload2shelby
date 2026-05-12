import type { QueuedFile } from "../types";
import "./UploadQueue.css";

interface Props {
  queue: QueuedFile[];
  isUploading: boolean;
  onRemove: (id: string) => void;
  onUpload: () => void;
  onClear: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function fileIcon(type: string): string {
  if (type.startsWith("image/")) return "🖼";
  if (type.startsWith("video/")) return "🎬";
  if (type.startsWith("audio/")) return "🎵";
  if (type === "application/pdf") return "📄";
  if (type.includes("zip") || type.includes("tar")) return "🗜";
  return "📁";
}

export default function UploadQueue({
  queue,
  isUploading,
  onRemove,
  onUpload,
  onClear,
}: Props) {
  const hasPending = queue.some((f) => f.status === "pending");
  const hasDone = queue.some((f) => f.status === "done");

  return (
    <section className="queue">
      <div className="queue__header">
        <h2 className="queue__title">Upload Queue <span className="queue__count">{queue.length}</span></h2>
        <div className="queue__actions">
          {hasDone && (
            <button className="btn btn--ghost" onClick={onClear}>
              Clear done
            </button>
          )}
          {hasPending && !isUploading && (
            <button className="btn btn--primary" onClick={onUpload}>
              Upload all
            </button>
          )}
          {isUploading && (
            <span className="queue__uploading-label">Uploading…</span>
          )}
        </div>
      </div>

      <ul className="queue__list">
        {queue.map((qf) => (
          <li key={qf.id} className={`queue__item queue__item--${qf.status}`}>
            <span className="queue__item-icon">{fileIcon(qf.file.type)}</span>

            <div className="queue__item-info">
              <span className="queue__item-name" title={qf.file.name}>
                {qf.file.name}
              </span>
              <span className="queue__item-size">{formatBytes(qf.file.size)}</span>

              {qf.status === "uploading" && (
                <div className="progress">
                  <div
                    className="progress__bar"
                    style={{ width: `${qf.progress}%` }}
                  />
                </div>
              )}

              {qf.status === "error" && (
                <span className="queue__item-error">{qf.error}</span>
              )}
            </div>

            <div className="queue__item-status">
              {qf.status === "pending" && (
                <span className="badge badge--pending">Pending</span>
              )}
              {qf.status === "uploading" && (
                <span className="badge badge--uploading">{qf.progress}%</span>
              )}
              {qf.status === "done" && (
                <span className="badge badge--done">✓ Done</span>
              )}
              {qf.status === "error" && (
                <span className="badge badge--error">✗ Error</span>
              )}
            </div>

            {qf.status !== "uploading" && (
              <button
                className="queue__remove"
                onClick={() => onRemove(qf.id)}
                aria-label="Remove file"
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
