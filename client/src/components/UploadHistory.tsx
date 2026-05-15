import { useEffect, useState } from "react";
import "./UploadHistory.css";

interface Props {
  walletAddress: string;
  refresh?: number;
}

interface HistoryItem {
  blobName: string;
  mimeType: string;
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

function daysUntilExpiry(expiresAt: string): number {
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
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

export default function UploadHistory({ walletAddress, refresh = 0 }: Props) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [totalUploads, setTotalUploads] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renewing, setRenewing] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);

  const fetchHistory = () => {
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
  };

useEffect(() => { fetchHistory(); }, [walletAddress ]); 
 
  // ── Derived dashboard stats ──────────────────────────────────────────────
  const totalSize = history.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);
  const expiringThisWeek = history.filter((f) => {
    const days = daysUntilExpiry(f.expiresAt);
    return days >= 0 && days <= 7;
  }).length;

  // ── Renew blob ────────────────────────────────────────────────────────────
  const handleRenew = async (blobName: string) => {
    setRenewing(blobName);
    try {
      const res = await fetch(`${API}/api/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobName, walletAddress, daysToExtend: 360 }),
      });
      const data = await res.json();
      if (data.success) {
        setRefresh((r) => r + 1);
      } else {
        alert("Renewal failed: " + data.error);
      }
    } catch {
      alert("Renewal failed — server unreachable");
    } finally {
      setRenewing(null);
    }
  };

  // ── Download blob ─────────────────────────────────────────────────────────
  const handleDownload = async (item: HistoryItem) => {
    const fileName = (item.blobName.split("/").pop() ?? "file").replace(/^\d+-/, "");
    const url = `${API}/api/download?blobName=${encodeURIComponent(item.blobName)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
  };

  // ── Share blob ────────────────────────────────────────────────────────────
  const handleShare = (item: HistoryItem) => {
    const encoded = encodeURIComponent(item.blobName);
    const link = `${window.location.origin}/share?blob=${encoded}`;
    setShareLink(link);
    navigator.clipboard.writeText(link).catch(() => {});
  };

  return (
    <section className="history">

      {/* ── Dashboard Stats ─────────────────────────────────────────────── */}
      {totalUploads > 0 && (
        <div className="dashboard">
          <div className="dashboard__stat">
            <span className="dashboard__value">{totalUploads}</span>
            <span className="dashboard__label">Total uploads</span>
          </div>
          <div className="dashboard__stat">
            <span className="dashboard__value">{formatBytes(totalSize)}</span>
            <span className="dashboard__label">Storage used</span>
          </div>
          <div className="dashboard__stat">
            <span className={`dashboard__value ${expiringThisWeek > 0 ? "dashboard__value--warn" : ""}`}>
              {expiringThisWeek}
            </span>
            <span className="dashboard__label">Expiring this week</span>
          </div>
        </div>
      )}

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="history__header">
        <h2 className="history__title">Upload History</h2>
        {totalUploads > 0 && (
          <div className="history__stats">
            {totalUploads > 20 && (
              <span className="history__showing">showing last 20</span>
            )}
          </div>
        )}
      </div>

      {/* ── Share link toast ────────────────────────────────────────────── */}
      {shareLink && (
        <div className="share-toast">
          <span>Link copied to clipboard</span>
          <code className="share-toast__link">{shareLink}</code>
          <button className="share-toast__close" onClick={() => setShareLink(null)}>×</button>
        </div>
      )}

      {loading && <p className="history__state">Loading...</p>}
      {error && <p className="history__state history__state--error">{error}</p>}
      {!loading && !error && history.length === 0 && (
        <p className="history__state">No uploads found for this wallet.</p>
      )}

      {/* ── File list ───────────────────────────────────────────────────── */}
      {history.length > 0 && (
        <ul className="history__list">
          {history.map((item, i) => {
            const days = daysUntilExpiry(item.expiresAt);
            const isExpiringSoon = days >= 0 && days <= 3;
            const isExpired = days < 0;

            return (
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
                    <span className={
                      isExpired ? "history__status--error" :
                      isExpiringSoon ? "history__status--warn" :
                      "history__status--done"
                    }>
                      {isExpired
                        ? "Expired"
                        : days === 0
                        ? "Expires today"
                        : `Exp. in ${days}d`}
                    </span>
                  </div>
                </div>

                {/* ── Action buttons ───────────────────────────────────── */}
                <div className="history__actions">
                  <button
                    className="history__btn history__btn--share"
                    onClick={() => handleShare(item)}
                    title="Copy share link"
                  >
                    🔗
                  </button>
                  <button
                    className="history__btn history__btn--download"
                    onClick={() => handleDownload(item)}
                    title="Download file"
                  >
                    ⬇
                  </button>
                  {!isExpired && (
                    <button
                      className="history__btn history__btn--renew"
                      onClick={() => handleRenew(item.blobName)}
                      disabled={renewing === item.blobName}
                      title="Extend expiry by 360 days"
                    >
                      {renewing === item.blobName ? "..." : "↻"}
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
