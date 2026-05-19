import { useEffect, useState, useCallback, useRef } from "react";
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

type FileCategory = "Images" | "Videos" | "Audio" | "Documents" | "Archives" | "Other";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function getCategory(blobName: string): FileCategory {
  const ext = blobName.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg","jpeg","png","gif","webp","svg","avif"].includes(ext)) return "Images";
  if (["mp4","mov","avi","mkv","webm"].includes(ext)) return "Videos";
  if (["mp3","wav","aac","ogg","flac"].includes(ext)) return "Audio";
  if (["pdf","doc","docx","txt","xls","xlsx","ppt","pptx"].includes(ext)) return "Documents";
  if (["zip","tar","gz","rar","7z"].includes(ext)) return "Archives";
  return "Other";
}

function getCategoryIcon(cat: FileCategory): string {
  const icons: Record<FileCategory, string> = {
    Images: "🖼", Videos: "🎬", Audio: "🎵",
    Documents: "📄", Archives: "🗜", Other: "📁",
  };
  return icons[cat];
}

function daysUntilExpiry(expiresAt: string): number {
  const diff = new Date(expiresAt).getTime() - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function HistoryThumb({ item }: { item: HistoryItem }) {
  const cat = getCategory(item.blobName);
  const [imgError, setImgError] = useState(false);

  if (cat === "Images" && !imgError) {
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
  return (
    <div className="history__thumb history__thumb--icon">
      <span>{getCategoryIcon(cat)}</span>
    </div>
  );
}

function RenewModal({
  blobName,
  walletAddress,
  onClose,
  onSuccess,
}: {
  blobName: string;
  walletAddress: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(false);

  const handleRenew = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/api/renew`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blobName, walletAddress, daysToExtend: days }),
      });
      const data = await res.json();
      if (data.success) {
        onSuccess();
        onClose();
      } else {
        alert("Renewal failed: " + data.error);
      }
    } catch {
      alert("Renewal failed — server unreachable");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h3 className="modal__title">Extend Expiry</h3>
          <button className="modal__close" onClick={onClose}>×</button>
        </div>
        <div className="modal__body">
          <p className="modal__label">Extend by <strong>{days} days</strong></p>
          <input
            type="range"
            min={30}
            max={360}
            step={30}
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="modal__slider"
          />
          <div className="modal__slider-labels">
            <span>30d</span>
            <span>180d</span>
            <span>360d</span>
          </div>
          <p className="modal__hint">
            New expiry: {new Date(Date.now() + days * 86400000).toLocaleDateString()}
          </p>
        </div>
        <div className="modal__footer">
          <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn--primary" onClick={handleRenew} disabled={loading}>
            {loading ? "Extending..." : `Extend ${days} days`}
          </button>
        </div>
      </div>
    </div>
  );
}

function FileItem({
  item,
  onDownload,
  onShare,
  onRenew,
}: {
  item: HistoryItem;
  onDownload: (item: HistoryItem) => void;
  onShare: (item: HistoryItem) => void;
  onRenew: (blobName: string) => void;
}) {
  const days = daysUntilExpiry(item.expiresAt);
  const isExpiringSoon = days >= 0 && days <= 3;
  const isExpired = days < 0;

  return (
    <li className="history__item">
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
            {isExpired ? "Expired" : days === 0 ? "Expires today" : `Exp. in ${days}d`}
          </span>
        </div>
      </div>
      <div className="history__actions">
        <button
          className="history__btn history__btn--share"
          onClick={() => onShare(item)}
          title="Copy share link"
        >🔗</button>
        <button
          className="history__btn history__btn--download"
          onClick={() => onDownload(item)}
          title="Download"
        >⬇</button>
        {!isExpired && (
          <button
            className="history__btn history__btn--renew"
            onClick={() => onRenew(item.blobName)}
            title="Extend expiry"
          >↻</button>
        )}
      </div>
    </li>
  );
}

export default function UploadHistory({ walletAddress, refresh = 0 }: Props) {
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [totalUploads, setTotalUploads] = useState<number>(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renewTarget, setRenewTarget] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [renewRefresh, setRenewRefresh] = useState(0);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<HistoryItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

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
          const cats = Array.from(
            new Set(data.blobs.map((b: HistoryItem) => getCategory(b.blobName)))
          );
          const initial: Record<string, boolean> = {};
          cats.forEach((c) => { initial[c as string] = false; });
          setOpenCategories(initial);
        } else {
          setError(data.error || "Failed to load history");
        }
      })
      .catch(() => setError("Could not reach server"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchHistory(); }, [walletAddress, refresh, renewRefresh]);

  const handleSearch = useCallback((q: string) => {
    setSearchQuery(q);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (q.trim().length === 0) {
      setSearchResults(null);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `${API}/api/search?address=${walletAddress}&q=${encodeURIComponent(q.trim())}`
        );
        const data = await res.json();
        if (data.success) setSearchResults(data.blobs);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, [walletAddress]);

  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults(null);
  };

  const totalSize = history.reduce((sum, f) => sum + (f.sizeBytes || 0), 0);
  const expiringThisWeek = history.filter((f) => {
    const d = daysUntilExpiry(f.expiresAt);
    return d >= 0 && d <= 7;
  }).length;

  const grouped = history.reduce<Record<FileCategory, HistoryItem[]>>(
    (acc, item) => {
      const cat = getCategory(item.blobName);
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(item);
      return acc;
    },
    {} as Record<FileCategory, HistoryItem[]>
  );

  const categoryOrder: FileCategory[] = ["Images", "Videos", "Audio", "Documents", "Archives", "Other"];
  const activeCategories = categoryOrder.filter((c) => grouped[c]?.length > 0);

  const handleDownload = (item: HistoryItem) => {
    const fileName = (item.blobName.split("/").pop() ?? "file").replace(/^\d+-/, "");
    const url = `${API}/api/download?blobName=${encodeURIComponent(item.blobName)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
  };

  const handleShare = (item: HistoryItem) => {
    const encoded = encodeURIComponent(item.blobName);
    const link = `${window.location.origin}/share?blob=${encoded}`;
    setShareLink(link);
    navigator.clipboard.writeText(link).catch(() => {});
  };

  const toggleCategory = (cat: string) => {
    setOpenCategories((prev) => ({ ...prev, [cat]: !prev[cat] }));
  };

  return (
    <section className="history">

      {renewTarget && (
        <RenewModal
          blobName={renewTarget}
          walletAddress={walletAddress}
          onClose={() => setRenewTarget(null)}
          onSuccess={() => setRenewRefresh((r) => r + 1)}
        />
      )}

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

      <div className="history__header">
        <h2 className="history__title">Upload History</h2>
        <div className="search">
          <input
            type="text"
            className="search__input"
            placeholder="Search files..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
          {searchQuery && (
            <button className="search__clear" onClick={clearSearch}>×</button>
          )}
          {searching && <span className="search__spinner">⟳</span>}
        </div>
      </div>

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

      {searchResults !== null && (
        <div className="search-results">
          <div className="search-results__header">
            <span className="search-results__count">
              {searchResults.length} result{searchResults.length !== 1 ? "s" : ""} for "{searchQuery}"
            </span>
          </div>
          {searchResults.length === 0 ? (
            <p className="history__state">No files match your search.</p>
          ) : (
            <ul className="history__list">
              {searchResults.map((item, i) => (
                <FileItem
                  key={i}
                  item={item}
                  onDownload={handleDownload}
                  onShare={handleShare}
                  onRenew={setRenewTarget}
                />
              ))}
            </ul>
          )}
        </div>
      )}

      {searchResults === null && activeCategories.map((cat) => (
        <div key={cat} className="history__group">
          <button
            className="history__group-header"
            onClick={() => toggleCategory(cat)}
          >
            <span className="history__group-icon">{getCategoryIcon(cat)}</span>
            <span className="history__group-title">{cat}</span>
            <span className="history__group-count">{grouped[cat].length}</span>
            <span className="history__group-chevron">
              {openCategories[cat] ? "▲" : "▼"}
            </span>
          </button>

          {openCategories[cat] && (
            <ul className="history__list">
              {grouped[cat].map((item, i) => (
                <FileItem
                  key={i}
                  item={item}
                  onDownload={handleDownload}
                  onShare={handleShare}
                  onRenew={setRenewTarget}
                />
              ))}
            </ul>
          )}
        </div>
      ))}
    </section>
  );
}
