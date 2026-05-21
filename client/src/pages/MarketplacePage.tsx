import { useEffect, useState } from "react";
import { useWallet } from "@aptos-labs/wallet-adapter-react";
import WalletBar from "../components/WalletBar";
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
  price: number;
}

const API = import.meta.env.VITE_API_URL || "http://localhost:4000";
const SIGNER_ADDRESS = import.meta.env.VITE_SIGNER_ADDRESS || "";
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

function PriceTag({ price }: { price: number }) {
  return (
    <span className={`price-tag ${price === 0 ? "price-tag--free" : "price-tag--paid"}`}>
      {price === 0 ? "Free" : `${price} ShelbyUSD`}
    </span>
  );
}

async function downloadFile(blobName: string, apiUrl: string) {
  const fileName = (blobName.split("/").pop() ?? "file").replace(/^\d+-/, "");
  const response = await fetch(`${apiUrl}/api/download?blobName=${encodeURIComponent(blobName)}`);
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function MarketplacePage() {
  const { connected, account, signAndSubmitTransaction } = useWallet();
  const [files, setFiles] = useState<MarketplaceFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [purchasing, setPurchasing] = useState<string | null>(null);
  const [purchased, setPurchased] = useState<Set<string>>(new Set());
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const fetchFiles = (q = "", category = "All") => {
    setLoading(true);
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (category !== "All") params.set("category", category.toLowerCase());
    fetch(`${API}/api/marketplace?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => { if (data.success) setFiles(data.files); })
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

  const showStatus = (msg: string) => {
    setStatusMsg(msg);
    setTimeout(() => setStatusMsg(null), 5000);
  };

  // ── Free download ─────────────────────────────────────────────────────────
  const handleFreeDownload = async (file: MarketplaceFile) => {
    try {
      const res = await fetch(`${API}/api/purchase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blobName: file.blobName,
          txHash: "free",
          buyerAddress: account?.address.toString() ?? "anonymous",
        }),
      });
      const data = await res.json();
      if (data.authorized) {
        showStatus("Starting download...");
        await downloadFile(file.blobName, API);
        showStatus("Download complete ✓");
      }
    } catch {
      showStatus("Download failed — please try again");
    }
  };

  // ── Paid purchase ─────────────────────────────────────────────────────────
  const handlePurchase = async (file: MarketplaceFile) => {
    if (!connected || !account) {
      showStatus("Connect your wallet to buy files");
      return;
    }

    setPurchasing(file.blobName);

    try {
      // Step 1 — send payment
      showStatus("Step 1 of 3 — Confirm payment in your wallet...");

      const amountInMicro = Math.round(file.price * 1_000_000);
      const recipient = SIGNER_ADDRESS || file.wallet;

      const response = await signAndSubmitTransaction({
        data: {
          function: "0x1::coin::transfer",
          typeArguments: ["0x1::aptos_coin::AptosCoin"],
          functionArguments: [recipient, amountInMicro.toString()],
        },
      });

      if (!response?.hash) {
        showStatus("Payment was rejected. No charge made.");
        return;
      }

      // Step 2 — authorize with server
      showStatus("Step 2 of 3 — Authorizing download...");

      const verifyRes = await fetch(`${API}/api/purchase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          blobName: file.blobName,
          txHash: response.hash,
          buyerAddress: account.address.toString(),
        }),
      });

      const verifyData = await verifyRes.json();

      if (!verifyData.authorized) {
        showStatus("Authorization failed: " + (verifyData.error ?? "unknown error"));
        return;
      }

      // Step 3 — download
      showStatus("Step 3 of 3 — Payment confirmed ✓ Starting download...");
      setPurchased((prev) => new Set(prev).add(file.blobName));
      await downloadFile(file.blobName, API);
      setTimeout(() => showStatus("Download complete ✓"), 1000);

    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Purchase failed";
      if (message.toLowerCase().includes("reject") || message.toLowerCase().includes("cancel")) {
        showStatus("Payment cancelled. No charge made.");
      } else {
        showStatus("Error: " + message);
      }
    } finally {
      setPurchasing(null);
    }
  };

  const handleShare = (file: MarketplaceFile) => {
    const encoded = encodeURIComponent(file.blobName);
    const link = `${window.location.origin}/share?blob=${encoded}`;
    navigator.clipboard.writeText(link).catch(() => {});
    showStatus("Share link copied to clipboard");
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-top">
          <div className="logo">
            <span className="logo-icon">◈</span>
            <span className="logo-text">Shelby<em>Easy</em></span>
          </div>
          <div className="header-nav">
            <WalletBar />
            <a href="/" className="header-nav__link">← Upload</a>
          </div>
        </div>
        <p className="tagline">Browse and buy public files on Shelby decentralized storage</p>
      </header>

      <main className="app-main">

        {statusMsg && (
          <div className="mkt-status">{statusMsg}</div>
        )}

        <div className="mkt-search">
          <input
            type="text"
            className="mkt-search__input"
            placeholder="Search public files..."
            value={searchQuery}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>

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

        <div className="mkt-stats">
          <span>{files.length} file{files.length !== 1 ? "s" : ""} available</span>
          <span className="mkt-stats__sep">·</span>
          <span>{files.filter((f) => f.price === 0).length} free</span>
          <span className="mkt-stats__sep">·</span>
          <span>{files.filter((f) => f.price > 0).length} paid</span>
        </div>

        {loading && <p className="history__state">Loading...</p>}

        {!loading && files.length === 0 && (
          <p className="history__state">No public files yet. Be the first to share!</p>
        )}

        {!loading && files.length > 0 && (
          <div className="mkt-grid">
            {files.map((file, i) => {
              const fileName = (file.blobName.split("/").pop() ?? "").replace(/^\d+-/, "");
              const isBuying = purchasing === file.blobName;
              const alreadyOwned = purchased.has(file.blobName);
              const isMine = account?.address.toString() === file.wallet;

              return (
                <div key={i} className="mkt-card">
                  <div className="mkt-card__preview">
                    {isImage(file.blobName) ? (
                      <img
                        src={`${API}/api/preview?blobName=${encodeURIComponent(file.blobName)}`}
                        alt={fileName}
                        className="mkt-card__img"
                        onError={(e) => { e.currentTarget.style.display = "none"; }}
                      />
                    ) : (
                      <div className="mkt-card__icon">{getFileIcon(file.blobName)}</div>
                    )}
                    <div className="mkt-card__price-overlay">
                      <PriceTag price={file.price} />
                    </div>
                  </div>

                  <div className="mkt-card__body">
                    <p className="mkt-card__name" title={fileName}>{fileName}</p>
                    <p className="mkt-card__meta">
                      {formatBytes(file.sizeBytes)}
                      <span className="history__sep">·</span>
                      {file.downloads} downloads
                    </p>
                    <p className="mkt-card__wallet" title={file.wallet}>
                      by {isMine ? "you" : shortWallet(file.wallet)}
                    </p>
                  </div>

                  <div className="mkt-card__actions">
                    <button
                      className="btn btn--ghost mkt-card__btn"
                      onClick={() => handleShare(file)}
                    >
                      🔗
                    </button>

                    {isMine ? (
                      <button className="btn btn--ghost mkt-card__btn" disabled>
                        Your file
                      </button>
                    ) : file.price === 0 ? (
                      <button
                        className="btn btn--primary mkt-card__btn"
                        onClick={() => handleFreeDownload(file)}
                      >
                        ⬇ Free
                      </button>
                    ) : alreadyOwned ? (
                      <button
                        className="btn btn--primary mkt-card__btn"
                        onClick={() => downloadFile(file.blobName, API)}
                      >
                        ⬇ Download
                      </button>
                    ) : (
                      <button
                        className="btn btn--primary mkt-card__btn mkt-card__btn--buy"
                        onClick={() => handlePurchase(file)}
                        disabled={isBuying}
                      >
                        {isBuying ? "Buying..." : `Buy ${file.price} SUSD`}
                      </button>
                    )}
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
