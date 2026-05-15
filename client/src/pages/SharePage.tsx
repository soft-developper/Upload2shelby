import { useEffect, useState } from "react";
import "../App.css";

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
}

function getFileType(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"].includes(ext)) return "image";
  if (["mp4", "mov", "avi", "mkv", "webm"].includes(ext)) return "video";
  if (["mp3", "wav", "aac", "ogg", "flac"].includes(ext)) return "audio";
  if (ext === "pdf") return "pdf";
  return "file";
}

export default function SharePage() {
  const params = new URLSearchParams(window.location.search);
  const blobName = params.get("blob") ?? "";
  const fileName = (blobName.split("/").pop() ?? "file").replace(/^\d+-/, "");
  const fileType = getFileType(fileName);

  const [loading, setLoading] = useState(false);

  const handleDownload = () => {
    setLoading(true);
    const url = `${API}/api/download?blobName=${encodeURIComponent(blobName)}`;
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    a.click();
    setTimeout(() => setLoading(false), 2000);
  };

  if (!blobName) {
    return (
      <div className="app" style={{ textAlign: "center", paddingTop: 80 }}>
        <p style={{ color: "var(--text-muted)" }}>No file specified.</p>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-top">
          <div className="logo">
            <span className="logo-icon">◈</span>
            <span className="logo-text">Shelby<em>Easy</em></span>
          </div>
        </div>
        <p className="tagline">Shared file from Shelby decentralized storage</p>
      </header>

      <main className="app-main">
        <div className="share-page">
          <div className="share-page__icon">
            {fileType === "image" ? (
              <img
                src={`${API}/api/preview?blobName=${encodeURIComponent(blobName)}`}
                alt={fileName}
                className="share-page__preview"
                onError={(e) => (e.currentTarget.style.display = "none")}
              />
            ) : (
              <div className="share-page__filetype">
                {fileType === "video" ? "🎬" :
                 fileType === "audio" ? "🎵" :
                 fileType === "pdf"   ? "📄" : "📁"}
              </div>
            )}
          </div>

          <h2 className="share-page__name">{fileName}</h2>

          <div className="share-page__meta">
            <span>Stored on Shelby Protocol</span>
            <span>·</span>
            <span>Decentralized · On-chain</span>
          </div>

          <button
            className="btn btn--primary share-page__download"
            onClick={handleDownload}
            disabled={loading}
          >
            {loading ? "Preparing download..." : "⬇ Download file"}
          </button>

          <p className="share-page__footer">
            Want to store your own files?{" "}
            <a href="/" className="confirm__link">Try ShelbyEasy</a>
          </p>
        </div>
      </main>
    </div>
  );
}
