import { useEffect, useState } from "react";
import "./UploadHistory.css";

interface Props {
  walletAddress: string;
}

interface HistoryItem {
  blobName: string;
  expiresAt: string;
  createdAt: string;
  sizeBytes: number;
  isWritten: boolean;
}

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function getFileType(blobName: string): "image" | "video" | "audio" | "pdf" | "zip" | "file" {
  const ext = blobName.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"].includes(ext)) return "image";
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "video";
  if (["mp3", "wav", "aac", "ogg", "flac"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  if (["zip", "tar", "gz", "rar", "7z"].includes(ext)) return "zip";
  return "file";
}

function FileIcon({ type }: { type: ReturnType<typeof getFileType> }) {
  const icons: Record<string, string> = {
    video: "🎬", audio: "🎵", pdf: "📄", zip: "🗜", file: "📁",
  };
  return (
    <div className="history__thumb history__thumb--icon">
      <span>{icons[type] ?? "📁"}</span>
    </div>
  );
}

function HistoryThumb({ item }: { item: HistoryItem }) {
  const type = getFileType(item.blobName);
  const [imgError, setImgError] = useState(false);

  if (type === "image" && !imgError) {
    return (
      <div className="history__thumb">
        <img
          src={`${API}/api/preview?blobName=${encodeURIComponent(item.blobName)}`}
          alt={item.blobName.split("/").pop()}
          className="history__thumb-img"
          onError={() => setImgError(true)}
          loading="lazy"
        />
      </div>
    );
  }

  return <FileIcon type={type} />;
}

export default function UploadHistory({ walletAddress }: Props) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [totalUploads, setTotalUploads] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!walletAddress) return;
    setLoading(true);
    setError(null);
    fetch(`${API}/api/history?address=${walletAddress}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) {
          setHistory(data.blobs);
          setTotalUploads(data.totalUploads);
        } else {
          setError(data.error || "Failed to load history");
        }
      })
      .catch(() => setError("Could not reach server"))
      .finally(() => setLoading(false));
  }, [walletAddress]);

  return (
    <section className="history">
      <div className="history__header">
        <h2 className="history__title">Upload History</h2>
        {totalUploads > 0 && (
          <div className="history__stats">
            <span className="history__total">
              {totalUploads} total upload{totalUploads !== 1 ? "s" : ""}
            </span>
            {totalUploads > 20 && (
              <span className="history__showing">showing last 20</span>
            )}
          </div>
        )}
      </div>

      {loading && <p className="history__state">Loading...</p>}
      {error && <p className="history__state history__state--error">{error}</p>}
      {!loading && !error && history.length === 0 && (
        <p className="history__state">No uploads found for this wallet.</p>
      )}

      {history.length > 0 && (
        <ul className="history__list">
          {history.map((item, i) => (
            <li key={i} className="history__item">
              <HistoryThumb item={item} />
              <div className="history__item-body">
                <div className="history__blob-name" title={item.blobName}>
                  {(item.blobName.split("/").pop() ?? "").replace(/^\d+-/, "")}
                </div>
                <div className="history__meta">
                  <span>{formatBytes(item.sizeBytes)}</span>
                  <span className="history__sep">·</span>
                  <span>{new Date(item.createdAt).toLocaleDateString()}</span>
                  <span className="history__sep">·</span>
                  <span>Exp. {new Date(item.expiresAt).toLocaleDateString()}</span>
                  <span className="history__sep">·</span>
                  <span className={item.isWritten ? "history__status--done" : "history__status--pending"}>
                    {item.isWritten ? "✓" : "⏳"}
                  </span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
