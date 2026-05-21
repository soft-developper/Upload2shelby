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
    created_at TEXT DEFAULT (datetime('now')),
    is_public  INTEGER DEFAULT 0,
    downloads  INTEGER DEFAULT 0
  )
`);

await turso.execute(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    wallet     TEXT NOT NULL,
    api_key    TEXT NOT NULL UNIQUE,
    name       TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// Add columns to existing table if they don't exist yet
try {
  await turso.execute(`ALTER TABLE uploads ADD COLUMN is_public INTEGER DEFAULT 0`);
} catch { /* column already exists */ }

try {
  await turso.execute(`ALTER TABLE uploads ADD COLUMN downloads INTEGER DEFAULT 0`);
} catch { /* column already exists */ }

try {
  await turso.execute(`ALTER TABLE uploads ADD COLUMN price REAL DEFAULT 0`);
} catch { /* column already exists */ }

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
      const daysToExpire = Math.max(1, Number(req.body.daysToExpire) || 30);
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

        await new Promise((resolve) => setTimeout(resolve, 1000));

        const expiresAt = new Date(expirationMicros / 1_000).toISOString();

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

      console.log(`[upload] ${results.length} file(s) uploaded by ${walletAddress}`);
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
        sql: `SELECT * FROM uploads WHERE wallet = ? ORDER BY created_at DESC`,
        args: [address],
      }),
      turso.execute({
        sql: `SELECT COUNT(*) as count FROM uploads WHERE wallet = ?`,
        args: [address],
      }),
    ]);

    // ── Limit 50 per category ─────────────────────────────────────────────
    const categories: Record<string, number> = {};

    const blobs = blobsResult.rows
  .map((r) => ({
    blobName:  r.blob_name  as string,
    mimeType:  r.mime_type  as string,
    sizeBytes: r.size_bytes as number,
    expiresAt: r.expires_at as string,
    createdAt: r.created_at as string,
    isWritten: true,
    isPublic:  r.is_public === 1 || r.is_public === "1",
    price:     Number(r.price ?? 0),
  }))
  .filter((b) => {
    const ext = b.blobName.split(".").pop()?.toLowerCase() ?? "";
    let cat = "other";
    if (["jpg","jpeg","png","gif","webp","svg","avif"].includes(ext)) cat = "images";
    else if (["mp4","mov","avi","mkv","webm"].includes(ext)) cat = "videos";
    else if (["mp3","wav","aac","ogg","flac"].includes(ext)) cat = "audio";
    else if (["pdf","doc","docx","txt","xls","xlsx","ppt","pptx"].includes(ext)) cat = "documents";
    else if (["zip","tar","gz","rar","7z"].includes(ext)) cat = "archives";
    categories[cat] = (categories[cat] || 0) + 1;
    return categories[cat] <= 50;
  });

    const totalUploads = countResult.rows[0].count as number;

    console.log(`[history] ${blobs.length} blobs fetched for ${address}`);
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

// ─── POST /api/renew ─────────────────────────────────────────────────────────
//
//  Extends a blob's expiry by re-uploading it with a new expirationMicros.
//  Body: { blobName, walletAddress, daysToExtend }

// ─── POST /api/renew without neglecting the original validity ─────────────────────────────────────────────────────────

app.post("/api/renew", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { blobName, walletAddress, daysToExtend = 30 } = req.body as {
      blobName: string;
      walletAddress: string;
      daysToExtend: number;
    };

    if (!blobName) {
      res.status(400).json({ success: false, error: "blobName required" });
      return;
    }

    const relativeBlobName = blobName.replace(/^@[^/]+\//, "").trim();

    // Fetch current expiry from Turso DB
    const current = await turso.execute({
      sql: `SELECT expires_at FROM uploads WHERE blob_name = ? AND wallet = ?`,
      args: [blobName, walletAddress],
    });

    const currentExpiresAt = current.rows[0]?.expires_at as string | undefined;

    // Base new expiry on current expiry date, not now
    // Final validity = current expiry + added days
    const baseTime = currentExpiresAt
      ? new Date(currentExpiresAt).getTime()
      : Date.now();

    const expirationMicros =
      baseTime * 1_000 + daysToExtend * 24 * 60 * 60 * 1_000_000;

    // Download the existing blob
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
    const blobData = Buffer.concat(chunks.map((c) => Buffer.from(c)));

    // Re-upload with new expiry
    await shelbyClient.upload({
      blobData,
      signer,
      blobName: relativeBlobName,
      expirationMicros,
    });

    const expiresAt = new Date(expirationMicros / 1_000).toISOString();

    // Update Turso DB with new expiry
    await turso.execute({
      sql: `UPDATE uploads SET expires_at = ? WHERE blob_name = ? AND wallet = ?`,
      args: [expiresAt, blobName, walletAddress],
    });

    console.log(`[renew] ${blobName} extended by ${daysToExtend} days from ${currentExpiresAt} → ${expiresAt}`);
    res.json({ success: true, expiresAt });
  } catch (err) {
    next(err);
  }
});


// ─── GET /api/download ───────────────────────────────────────────────────────
//
//  Downloads any blob and streams it to the browser as a file attachment.
//  Query: ?blobName=@0xabc.../uploads/file.mp4

app.get("/api/download", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const blobName = req.query.blobName as string;
    if (!blobName) {
      res.status(400).json({ error: "blobName required" });
      return;
    }

    const relativeBlobName = blobName.replace(/^@[^/]+\//, "").trim();
    const fileName = (blobName.split("/").pop() ?? "file").replace(/^\d+-/, "");

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

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/search ─────────────────────────────────────────────────────────

app.get("/api/search", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const address = req.query.address as string;
    const query = req.query.q as string;

    if (!address) {
      res.status(400).json({ success: false, error: "address required" });
      return;
    }

    if (!query || query.trim().length < 1) {
      res.status(400).json({ success: false, error: "search query required" });
      return;
    }

    const result = await turso.execute({
      sql: `SELECT * FROM uploads 
            WHERE wallet = ? 
            AND blob_name LIKE ? 
            ORDER BY created_at DESC 
            LIMIT 100`,
      args: [address, `%${query.trim()}%`],
    });

    const blobs = result.rows.map((r) => ({
      blobName:  r.blob_name  as string,
      mimeType:  r.mime_type  as string,
      sizeBytes: r.size_bytes as number,
      expiresAt: r.expires_at as string,
      createdAt: r.created_at as string,
      isWritten: true,
    }));

    console.log(`[search] "${query}" → ${blobs.length} results for ${address}`);
    res.json({ success: true, blobs, total: blobs.length });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/toggle-public ─────────────────────────────────────────────────

app.post("/api/toggle-public", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { blobName, walletAddress, isPublic, price = 0 } = req.body as {
      blobName: string;
      walletAddress: string;
      isPublic: boolean;
      price: number;
    };

    if (!blobName || !walletAddress) {
      res.status(400).json({ success: false, error: "blobName and walletAddress required" });
      return;
    }

    await turso.execute({
      sql: `UPDATE uploads SET is_public = ?, price = ? WHERE blob_name = ? AND wallet = ?`,
      args: [isPublic ? 1 : 0, price, blobName, walletAddress],
    });

    console.log(`[marketplace] ${blobName} → ${isPublic ? `public at ${price} ShelbyUSD` : "private"}`);
    res.json({ success: true, isPublic, price });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/marketplace ────────────────────────────────────────────────────

app.get("/api/marketplace", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const category = req.query.category as string | undefined;
    const q = req.query.q as string | undefined;

    const categoryExtMap: Record<string, string[]> = {
      images:    ["jpg","jpeg","png","gif","webp","svg","avif"],
      videos:    ["mp4","mov","avi","mkv","webm"],
      audio:     ["mp3","wav","aac","ogg","flac"],
      documents: ["pdf","doc","docx","txt","xls","xlsx","ppt","pptx"],
      archives:  ["zip","tar","gz","rar","7z"],
    };

    let sql = `SELECT * FROM uploads WHERE is_public = 1`;
    const args: (string | number)[] = [];

    if (q && q.trim().length > 0) {
      sql += ` AND blob_name LIKE ?`;
      args.push(`%${q.trim()}%`);
    }

    if (category && categoryExtMap[category.toLowerCase()]) {
      const exts = categoryExtMap[category.toLowerCase()];
      const placeholders = exts.map(() => `blob_name LIKE ?`).join(" OR ");
      sql += ` AND (${placeholders})`;
      exts.forEach((ext) => args.push(`%.${ext}`));
    }

    sql += ` ORDER BY created_at DESC LIMIT 100`;

    const result = await turso.execute({ sql, args });

    const files = result.rows.map((r) => ({
      blobName:  r.blob_name  as string,
      mimeType:  r.mime_type  as string,
      sizeBytes: r.size_bytes as number,
      expiresAt: r.expires_at as string,
      createdAt: r.created_at as string,
      wallet:    r.wallet     as string,
      downloads: r.downloads  as number,
      price:     Number(r.price ?? 0),
    }));

    res.json({ success: true, files, total: files.length });
  } catch (err) {
    next(err);
  }
});



// ─── POST /api/keys/generate ─────────────────────────────────────────────────
//
//  Generates an API key for a wallet
//  Body: { walletAddress, name }

app.post("/api/keys/generate", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { walletAddress, name } = req.body as {
      walletAddress: string;
      name: string;
    };

    if (!walletAddress) {
      res.status(400).json({ success: false, error: "walletAddress required" });
      return;
    }

    // Generate a simple random API key
    const apiKey = `sk_${Array.from(
      { length: 32 },
      () => Math.random().toString(36)[2]
    ).join("")}`;

    await turso.execute({
      sql: `INSERT INTO api_keys (wallet, api_key, name) VALUES (?, ?, ?)`,
      args: [walletAddress, apiKey, name || "My API Key"],
    });

    console.log(`[keys] new key generated for ${walletAddress}`);
    res.json({ success: true, apiKey });
  } catch (err) {
    next(err);
  }
});

// ─── GET /api/keys ───────────────────────────────────────────────────────────
//
//  Returns all API keys for a wallet (masked)
//  Query: ?address=0xabc...

app.get("/api/keys", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const address = req.query.address as string;
    if (!address) {
      res.status(400).json({ success: false, error: "address required" });
      return;
    }

    const result = await turso.execute({
      sql: `SELECT id, name, api_key, created_at FROM api_keys WHERE wallet = ? ORDER BY created_at DESC`,
      args: [address],
    });

    const keys = result.rows.map((r) => ({
      id:        r.id         as number,
      name:      r.name       as string,
      // mask the key — only show first 8 and last 4 chars
      apiKey:    `${(r.api_key as string).slice(0, 8)}...${(r.api_key as string).slice(-4)}`,
      createdAt: r.created_at as string,
    }));

    res.json({ success: true, keys });
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/keys/:id ────────────────────────────────────────────────────
//
//  Deletes an API key
//  Body: { walletAddress }

app.delete("/api/keys/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { walletAddress } = req.body as { walletAddress: string };

    await turso.execute({
      sql: `DELETE FROM api_keys WHERE id = ? AND wallet = ?`,
      args: [id, walletAddress],
    });

    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ─── AGENT API ───────────────────────────────────────────────────────────────
//
//  Simple endpoints for AI agents and developers to use programmatically.
//  All agent routes require an API key in the Authorization header:
//  Authorization: Bearer sk_your_key_here

async function verifyApiKey(req: Request, res: Response): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ success: false, error: "API key required. Add: Authorization: Bearer sk_your_key" });
    return null;
  }

  const apiKey = authHeader.replace("Bearer ", "").trim();
  const result = await turso.execute({
    sql: `SELECT wallet FROM api_keys WHERE api_key = ?`,
    args: [apiKey],
  });

  if (result.rows.length === 0) {
    res.status(401).json({ success: false, error: "Invalid API key" });
    return null;
  }

  return result.rows[0].wallet as string;
}

// GET /api/agent/search — search public files
app.get("/api/agent/search", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wallet = await verifyApiKey(req, res);
    if (!wallet) return;

    const q = req.query.q as string || "";
    const category = req.query.category as string || "";

    const result = await turso.execute({
      sql: `SELECT * FROM uploads 
            WHERE is_public = 1 
            AND blob_name LIKE ? 
            ORDER BY downloads DESC 
            LIMIT 50`,
      args: [`%${q}%`],
    });

    const files = result.rows.map((r) => ({
      blobName:  r.blob_name  as string,
      mimeType:  r.mime_type  as string,
      sizeBytes: r.size_bytes as number,
      expiresAt: r.expires_at as string,
      downloads: r.downloads  as number,
      // give agent the direct download URL
      downloadUrl: `${process.env.CLIENT_URL?.replace("upload2shelby.vercel.app", "") || ""}${req.protocol}://${req.get("host")}/api/agent/download?blobName=${encodeURIComponent(r.blob_name as string)}`,
    }));

    res.json({ success: true, files, total: files.length });
  } catch (err) {
    next(err);
  }
});

// GET /api/agent/download — download any public file or your own private file
app.get("/api/agent/download", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const wallet = await verifyApiKey(req, res);
    if (!wallet) return;

    const blobName = req.query.blobName as string;
    if (!blobName) {
      res.status(400).json({ success: false, error: "blobName required" });
      return;
    }

    // Check file exists and agent has access (public OR owns it)
    const check = await turso.execute({
      sql: `SELECT * FROM uploads WHERE blob_name = ? AND (is_public = 1 OR wallet = ?)`,
      args: [blobName, wallet],
    });

    if (check.rows.length === 0) {
      res.status(403).json({ success: false, error: "File not found or access denied" });
      return;
    }

    const relativeBlobName = blobName.replace(/^@[^/]+\//, "").trim();
    const fileName = (blobName.split("/").pop() ?? "file").replace(/^\d+-/, "");

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

    // Increment download count
    await turso.execute({
      sql: `UPDATE uploads SET downloads = downloads + 1 WHERE blob_name = ?`,
      args: [blobName],
    });

    res.setHeader("Content-Disposition", `attachment; filename="${fileName}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.setHeader("Content-Length", buffer.length);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
});

// POST /api/agent/upload — upload a file programmatically
app.post(
  "/api/agent/upload",
  upload.array("files", 10),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const wallet = await verifyApiKey(req, res);
      if (!wallet) return;

      const files = req.files as Express.Multer.File[] | undefined;
      if (!files || files.length === 0) {
        res.status(400).json({ success: false, error: "No files received" });
        return;
      }

      const daysToExpire = Math.max(1, Number(req.body.daysToExpire) || 30);
      const isPublic = req.body.isPublic === "true" ? 1 : 0;
      const blobPrefix = (req.body.blobPrefix as string) || "uploads";

      const expirationMicros =
        Date.now() * 1_000 + daysToExpire * 24 * 60 * 60 * 1_000_000;

      const results = [];

      for (const file of files) {
        const safeName = path.basename(file.originalname).replace(/\s+/g, "_");
        const blobName = `${blobPrefix}/${Date.now()}-${safeName}`;

        await shelbyClient.upload({
          blobData: file.buffer,
          signer,
          blobName,
          expirationMicros,
        });

        await new Promise((resolve) => setTimeout(resolve, 1000));

        const expiresAt = new Date(expirationMicros / 1_000).toISOString();

        await turso.execute({
          sql: `INSERT INTO uploads (wallet, blob_name, mime_type, size_bytes, expires_at, is_public)
                VALUES (?, ?, ?, ?, ?, ?)`,
          args: [wallet, blobName, file.mimetype, file.size, expiresAt, isPublic],
        });

        results.push({
          originalName: file.originalname,
          blobName,
          expiresAt,
          sizeBytes: file.size,
          isPublic: isPublic === 1,
        });
      }

      console.log(`[agent] ${results.length} file(s) uploaded by ${wallet}`);
      res.json({ success: true, files: results });
    } catch (err) {
      next(err);
    }
  }
);

// ─── POST /api/purchase ──────────────────────────────────────────────────────
//
//  Verifies a ShelbyUSD payment on-chain then returns the download.
//  Body: { blobName, txHash, buyerAddress }

app.post("/api/purchase", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { blobName, txHash, buyerAddress } = req.body as {
      blobName: string;
      txHash: string;
      buyerAddress: string;
    };

    if (!blobName || !txHash || !buyerAddress) {
      res.status(400).json({ success: false, error: "blobName, txHash and buyerAddress required" });
      return;
    }

    // Fetch file details from DB
    const fileResult = await turso.execute({
      sql: `SELECT * FROM uploads WHERE blob_name = ? AND is_public = 1`,
      args: [blobName],
    });

    if (fileResult.rows.length === 0) {
      res.status(404).json({ success: false, error: "File not found or not public" });
      return;
    }

    const file = fileResult.rows[0];
    const price = Number(file.price ?? 0);
    const ownerWallet = file.wallet as string;

    // If file is free, skip payment verification
    if (price === 0) {
      // Increment downloads
      await turso.execute({
        sql: `UPDATE uploads SET downloads = downloads + 1 WHERE blob_name = ?`,
        args: [blobName],
      });
      res.json({ success: true, authorized: true });
      return;
    }

    // Verify the transaction on Aptos blockchain
    // Wait longer for transaction to be indexed

await new Promise((resolve) => setTimeout(resolve, 5000));

// Try multiple times in case indexing is slow
let tx: any = null;
let attempts = 0;

while (attempts < 5) {
  const aptosRes = await fetch(
    `https://api.testnet.aptoslabs.com/v1/transactions/by_hash/${txHash}`,
    {
      headers: {
        "Authorization": `Bearer ${process.env.APTOS_API_KEY || ""}`,
      },
    }
  );

  if (aptosRes.ok) {
    tx = await aptosRes.json();
    break;
  }

  attempts++;
  await new Promise((resolve) => setTimeout(resolve, 3000));
}

if (!tx) {
  res.status(400).json({ success: false, error: "Transaction not found on chain after multiple attempts" });
  return;
}

    if (!aptosRes.ok) {
      res.status(400).json({ success: false, error: "Transaction not found on chain" });
      return;
    }

    const tx = await aptosRes.json() as {
      success: boolean;
      sender: string;
      events?: { type: string; data: { amount: string; to?: string; recipient?: string } }[];
      vm_status?: string;
    };

    // Check transaction succeeded
    if (!tx.success || tx.vm_status !== "Executed successfully") {
      res.status(400).json({ success: false, error: "Transaction did not succeed" });
      return;
    }

    // Check sender matches buyer
    if (tx.sender.toLowerCase() !== buyerAddress.toLowerCase()) {
      res.status(400).json({ success: false, error: "Transaction sender does not match buyer" });
      return;
    }

    // Check payment event — look for a transfer to the file owner
    const transferEvent = tx.events?.find((e) =>
      (e.type.includes("coin") || e.type.includes("fungible_asset")) &&
      (e.data.to?.toLowerCase() === ownerWallet.toLowerCase() ||
       e.data.recipient?.toLowerCase() === ownerWallet.toLowerCase())
    );

    if (!transferEvent) {
      res.status(400).json({ success: false, error: "Payment to file owner not found in transaction" });
      return;
    }

    // Check amount — ShelbyUSD uses 6 decimal places
    const paidAmount = Number(transferEvent.data.amount) / 1_000_000;
    if (paidAmount < price) {
      res.status(400).json({
        success: false,
        error: `Insufficient payment. Expected ${price} ShelbyUSD, got ${paidAmount}`,
      });
      return;
    }

    // Payment verified — increment downloads
    await turso.execute({
      sql: `UPDATE uploads SET downloads = downloads + 1 WHERE blob_name = ?`,
      args: [blobName],
    });

    console.log(`[purchase] ${buyerAddress} bought ${blobName} for ${price} ShelbyUSD (tx: ${txHash})`);
    res.json({ success: true, authorized: true });
  } catch (err) {
    next(err);
  }
});


// ─── Global error handler ─────────────────────────────────────────────────────

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[error]", err.message);
  console.error(err);
  if (res.headersSent) return;
  res.status(500).json({ success: false, error: err.message || "Server error" });
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`✅ Shelby upload server → http://localhost:${PORT}`);
});
