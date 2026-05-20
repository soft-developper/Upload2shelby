import { useEffect, useState } from "react";
import "../App.css";
import "./MarketplacePage.css";

interface MarketplaceFile {
  blobName: string;
  mimeType: string;
  sizeBytes: number;
  expiresAt: string;
  createdAt: string;
  wallet: string;
  downloads: number;
}

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

const CATEGORIES = ["All", "Images", "Videos", "Audio", "Documents", "Archives"];

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function getFileIcon(blobName: string): string {
  const ext = blobName.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg","jpeg","png","gif","webp","svg","avif"].includes(ext)) return "🖼";
  if (["mp4","mov","avi","mkv","webm"].includes(ext)) return "🎬";
  if (["mp3","wav","aac","ogg","flac"].includes(ext)) return "🎵";
  if (["pdf","doc","docx","txt","xls","xlsx","ppt","pptx"].includes(ext)) return "📄";
  if (["zip","tar","gz","rar","7z"].includes(ext)) return "🗜";
  return "📁";
}

function isImage(blobName: string): boolean {
  const ext = blobName.split(".").pop()?.toLowerCase() ?? "";
  return ["jpg","jpeg","png","gif","webp","svg","avif"].includes(ext);
}

function shortWallet(wallet: string): string {
  return wallet.slice(0, 6) + "..." + wallet.slice(-4);
}

export default function MarketplacePage() {
  const [files, setFiles] = useState<MarketplaceFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [downloading, setDownloading] = useState<string | null>(null);

  const fetchFiles = (q = "", category = "All") => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category !== "All") params.set("category", category.toLowerCase());

    fetch(`${API}/api/marketplace?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.success) setFiles(data.files);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchFiles(); }, []);

  const handleSearch = (q: string) => {
    setSearchQuery(q);
    fetchFiles(q, activeCategory);
  };

  const handleCategory = (cat: string) => {
    setActiveCategory(cat);
    fetchFiles(searchQuery, cat);
  };

  const handleDownload = async (file: MarketplaceFile) => {
    setDownloading(file.blobName);
    const fileName = (file.blobName.split("/").pop() ?? "file").replace(/^\d+-/, "");
    const url = `${API}/api/download?blobName=${encodeURIComponent(file.blobName)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => setDownloading(null), 2000);
  };

  const handleShare = (file: MarketplaceFile) => {
    const encoded = encodeURIComponent(file.blobName);
    const link = `${window.location.origin}/share?blob=${encoded}`;
    navigator.clipboard.writeText(link).catch(() => {});
    alert("Share link copied to clipboard!");
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-top">
          <div className="logo">
            <span className="logo-icon">◈</span>
            <span className="logo-text">Shelby<em>Easy</em></span>
          </div>
          <div className="mkt-nav">
            <a href="/" className="btn btn--ghost">← Upload</a>
          </div>
        </div>
        <p className="tagline">Browse public files shared on Shelby decentralized storage</p>
      </header>

      <main className="app-main">
        {/* ── Search ── */}
        <div className="mkt-search">
          <input
            type="text"
            className="mkt-search__input"
            placeholder="Search public files..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>

        {/* ── Category filter ── */}
        <div className="mkt-categories">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              className={`mkt-cat ${activeCategory === cat ? "mkt-cat--active" : ""}`}
              onClick={() => handleCategory(cat)}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* ── Stats ── */}
        <div className="mkt-stats">
          <span>{files.length} public file{files.length !== 1 ? "s" : ""} available</span>
        </div>

        {/* ── Files grid ── */}
        {loading && <p className="history__state">Loading...</p>}

        {!loading && files.length === 0 && (
          <p className="history__state">No public files found. Be the first to share!</p>
        )}

        {!loading && files.length > 0 && (
          <div className="mkt-grid">
            {files.map((file, i) => {
              const fileName = (file.blobName.split("/").pop() ?? "").replace(/^\d+-/, "");
              return (
                <div key={i} className="mkt-card">
                  {/* Preview */}
                  <div className="mkt-card__preview">
                    {isImage(file.blobName) ? (
                      <img
                        src={`${API}/api/preview?blobName=${encodeURIComponent(file.blobName)}`}
                        alt={fileName}
                        className="mkt-card__img"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                          e.currentTarget.nextElementSibling?.removeAttribute("style");
                        }}
                      />
                    ) : null}
                    <div
                      className="mkt-card__icon"
                      style={isImage(file.blobName) ? { display: "none" } : {}}
                    >
                      {getFileIcon(file.blobName)}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="mkt-card__body">
                    <p className="mkt-card__name" title={fileName}>{fileName}</p>
                    <p className="mkt-card__meta">
                      {formatBytes(file.sizeBytes)}
                      <span className="history__sep">·</span>
                      {new Date(file.createdAt).toLocaleDateString()}
                      <span className="history__sep">·</span>
                      {file.downloads} ⬇
                    </p>
                    <p className="mkt-card__wallet" title={file.wallet}>
                      by {shortWallet(file.wallet)}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="mkt-card__actions">
                    <button
                      className="btn btn--ghost mkt-card__btn"
                      onClick={() => handleShare(file)}
                    >
                      🔗 Share
                    </button>
                    <button
                      className="btn btn--primary mkt-card__btn"
                      onClick={() => handleDownload(file)}
                      disabled={downloading === file.blobName}
                    >
                      {downloading === file.blobName ? "..." : "⬇ Download"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
