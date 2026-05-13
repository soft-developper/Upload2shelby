import "dotenv/config";
import express, { Request, Response, NextFunction } from "express";
import multer from "multer";
import cors from "cors";
import { ShelbyNodeClient } from "@shelby-protocol/sdk/node";
import { Account, Ed25519PrivateKey, Network } from "@aptos-labs/ts-sdk";
import { createClient } from "@libsql/client";
import path from "path";

// ─── App Setup ───────────────────────────────────────────────────────────────

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: process.env.CLIENT_URL || "http://localhost:5173" }));
app.use(express.json());

// ─── Validate env vars ───────────────────────────────────────────────────────

const PRIVATE_KEY = process.env.SHELBY_PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error("❌  SHELBY_PRIVATE_KEY is missing from .env");
  process.exit(1);
}

// ─── Turso Database ──────────────────────────────────────────────────────────

const turso = createClient({
  url:       process.env.TURSO_DATABASE_URL || "file:uploads.db",
  authToken: process.env.TURSO_AUTH_TOKEN,
});

await turso.execute(`
  CREATE TABLE IF NOT EXISTS uploads (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet     TEXT NOT NULL,
    blob_name  TEXT NOT NULL,
    mime_type  TEXT,
    size_bytes INTEGER,
    expires_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

console.log("✅ Database connected");

// ─── Shelby Client ───────────────────────────────────────────────────────────

const shelbyClient = new ShelbyNodeClient({
  network: Network.SHELBYNET,
  apiKey: process.env.APTOS_API_KEY,
});

const signer = Account.fromPrivateKey({
  privateKey: new Ed25519PrivateKey(PRIVATE_KEY),
});

console.log(`🔑 Signer address: ${signer.accountAddress}`);

// ─── Multer ──────────────────────────────────────────────────────────────────

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
});

// ─── Types ───────────────────────────────────────────────────────────────────

interface UploadedFile {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  blobName: string;
  expiresAt: string;
  signerAddress: string;
}

// ─── POST /api/upload ────────────────────────────────────────────────────────

app.post(
  "/api/upload",
  upload.array("files", 10),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const files = req.files as Express.Multer.File[] | undefined;

      if (!files || files.length === 0) {
        res.status(400).json({ success: false, error: "No files received." });
        return;
      }

      const blobPrefix    = (req.body.blobPrefix   as string) || "uploads";
      const daysToExpire  = Math.max(1, Number(req.body.daysToExpire) || 7);
      const walletAddress = (req.body.walletAddress as string) || "";

      const expirationMicros =
        Date.now() * 1_000 +
        daysToExpire * 24 * 60 * 60 * 1_000_000;

      const results: UploadedFile[] = [];

      for (const file of files) {
        const safeName = path.basename(file.originalname).replace(/\s+/g, "_");
        const blobName = `${blobPrefix}/${Date.now()}-${safeName}`;

        await shelbyClient.upload({
          blobData: file.buffer,
          signer,
          blobName,
          expirationMicros,
        });

        // small delay to avoid nonce conflicts
        await new Promise((resolve) => setTimeout(resolve, 1000));

        const expiresAt = new Date(expirationMicros / 1_000).toISOString();

        // Save to Turso DB — wallet owns this upload
        await turso.execute({
          sql: `INSERT INTO uploads (wallet, blob_name, mime_type, size_bytes, expires_at)
                VALUES (?, ?, ?, ?, ?)`,
          args: [walletAddress, blobName, file.mimetype, file.size, expiresAt],
        });

        results.push({
          originalName:  file.originalname,
          mimeType:      file.mimetype,
          sizeBytes:     file.size,
          blobName,
          expiresAt,
          signerAddress: signer.accountAddress.toString(),
        });
      }

      res.json({ success: true, files: results });
    } catch (err) {
      next(err);
    }
  }
);

// ─── GET /api/history ────────────────────────────────────────────────────────

app.get("/api/history", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const address = req.query.address as string;
    if (!address) {
      res.status(400).json({ success: false, error: "address required" });
      return;
    }

    const [blobsResult, countResult] = await Promise.all([
      turso.execute({
        sql: `SELECT * FROM uploads WHERE wallet = ? ORDER BY created_at DESC LIMIT 20`,
        args: [address],
      }),
      turso.execute({
        sql: `SELECT COUNT(*) as count FROM uploads WHERE wallet = ?`,
        args: [address],
      }),
    ]);

    const blobs = blobsResult.rows.map((r) => ({
      blobName:  r.blob_name  as string,
      mimeType:  r.mime_type  as string,
      sizeBytes: r.size_bytes as number,
      expiresAt: r.expires_at as string,
      createdAt: r.created_at as string,
      isWritten: true,
    }));

    const totalUploads = countResult.rows[0].count as number;

    res.json({ success: true, totalUploads, blobs });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/preview ────────────────────────────────────────────────────────

app.get("/api/preview", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const blobName = req.query.blobName as string;
    if (!blobName) {
      res.status(400).json({ error: "blobName required" });
      return;
    }

    const ext = blobName.split(".").pop()?.toLowerCase() ?? "";
    const imageExts = ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"];
    if (!imageExts.includes(ext)) {
      res.status(415).json({ error: "Not an image" });
      return;
    }

    const relativeBlobName = blobName
      .replace(/^@[^/]+\//, "")
      .trim();

    const blob = await shelbyClient.download({
      account: signer.accountAddress,
      blobName: relativeBlobName,
    });

    const chunks: Uint8Array[] = [];
    const reader = blob.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));

    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
      gif: "image/gif",  webp: "image/webp", svg: "image/svg+xml", avif: "image/avif",
    };

    res.setHeader("Content-Type", mimeMap[ext] || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/health ─────────────────────────────────────────────────────────

app.get("/api/health", (_req, res) => {
  res.json({
    status:    "ok",
    network:   "shelbynet",
    signer:    signer.accountAddress.toString(),
    timestamp: new Date().toISOString(),
  });
});

// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[error]", err.message);
  res.status(500).json({ success: false, error: err.message || "Server error" });
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅ Shelby upload server → http://localhost:${PORT}`);
});
