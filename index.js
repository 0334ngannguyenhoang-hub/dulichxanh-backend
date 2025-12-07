import dotenv from "dotenv";
dotenv.config();

import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

// Fix __dirname for ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================
// APP INIT
// ============================
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || "dev_secret";
const SALT_ROUNDS = 10;

// ============================
// CONNECT MONGODB
// ============================
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("🌿 MongoDB connected"))
  .catch((err) => console.log("❌ MongoDB ERROR:", err));

// ============================
// USER SCHEMA & MODEL
// ============================
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["writer", "editor", "admin"], default: "writer" },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", UserSchema);

// ============================
// POST SCHEMA & MODEL
// ============================
const PostSchema = new mongoose.Schema({
  title: String,
  sapo: String,
  author: String,
  authorId: String,
  thumbnail: String,
  tags: String,
  content: String,

  // E-magazine page (Canva Website URL)
  type: { type: String, default: "normal" }, // "normal" hoặc "emagazine"
  emagPage: String, // ví dụ: https://yourname.my.canva.site/xxx

  category: [String],
  status: { type: String, default: "draft" },
  createdAt: { type: Date, default: Date.now }
});

const Post = mongoose.model("Post", PostSchema);

// ============================
// AUTH MIDDLEWARE
// ============================
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ error: "Missing Authorization header" });

  const token = authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Invalid Authorization header" });

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (allowedRoles.includes(req.user.role)) return next();
    return res.status(403).json({ error: "Forbidden" });
  };
}

// ============================
// AUTH ROUTES
// ============================
app.post("/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password)
      return res.status(400).json({ error: "username & password required" });

    const existing = await User.findOne({ username });
    if (existing)
      return res.status(400).json({ error: "username already exists" });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = new User({ username, passwordHash: hash });
    await user.save();

    const token = jwt.sign(
      {
        id: user._id.toString(),
        username: user.username,
        role: user.role
      },
      JWT_SECRET
    );

    res.json({ message: "User created", user, token });
  } catch (err) {
    console.error("POST /auth/register ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ username });
    if (!user) return res.status(400).json({ error: "User not found" });

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(400).json({ error: "Wrong password" });

    const token = jwt.sign(
      {
        id: user._id.toString(),
        username: user.username,
        role: user.role
      },
      JWT_SECRET
    );

    res.json({ message: "Login success", user, token });
  } catch (err) {
    console.error("POST /auth/login ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================
// POSTS API
// ============================
app.get("/posts", requireAuth, async (req, res) => {
  try {
    const status = req.query.status;
    const q = status ? { status } : {};
    const posts = await Post.find(q).sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    console.error("GET /posts ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/posts", requireAuth, async (req, res) => {
  try {
    const data = req.body;
    data.authorId = req.user.id;
    const newPost = new Post(data);
    await newPost.save();
    res.json({ message: "Created", newPost });
  } catch (err) {
    console.error("POST /posts ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.put("/posts/:id", requireAuth, async (req, res) => {
  try {
    const updated = await Post.findByIdAndUpdate(req.params.id, req.body, { new: true });
    res.json(updated);
  } catch (err) {
    console.error("PUT /posts/:id ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/posts/:id", requireAuth, async (req, res) => {
  try {
    await Post.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch (err) {
    console.error("DELETE /posts/:id ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/posts/:id/publish", requireAuth, async (req, res) => {
  try {
    const updated = await Post.findByIdAndUpdate(
      req.params.id,
      { status: "published" },
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    console.error("PATCH publish ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/posts/:id/unpublish", requireAuth, async (req, res) => {
  try {
    const updated = await Post.findByIdAndUpdate(
      req.params.id,
      { status: "draft" },
      { new: true }
    );
    res.json(updated);
  } catch (err) {
    console.error("PATCH unpublish ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// GET post by id (admin)
app.get("/posts/:id", requireAuth, async (req, res) => {
  try {
    const post = await Post.findById(req.params.id);
    if (!post) return res.status(404).json({ error: "Post not found" });
    res.json(post);
  } catch (err) {
    console.error("GET /posts/:id ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================
// UPLOAD API
// ============================

// Tạo thư mục uploads nếu chưa có
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Serve static files
app.use("/uploads", express.static(uploadDir));

// Multer config
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname)),
});

const upload = multer({ storage });

// Upload route
app.post("/upload", upload.single("image"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    const fileUrl = `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`;
    res.json({ url: fileUrl });
  } catch (err) {
    console.error("POST /upload ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================
// PUBLIC API (NO AUTH) — for website readers
// ============================

// 1️⃣ GET all published posts
app.get("/public/posts", async (req, res) => {
  try {
    const posts = await Post.find({ status: "published" })
      .sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    console.error("GET /public/posts ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 2️⃣ GET single post (public) — safe (checks ObjectId)
app.get("/public/posts/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({ error: "Invalid post id" });
    }

    const post = await Post.findById(id);
    if (!post || post.status !== "published") {
      return res.status(404).json({ error: "Post not found" });
    }
    res.json(post);
  } catch (err) {
    console.error("GET /public/posts/:id ERROR:", err);
    res.status(500).json({ error: "Server error", detail: err.message });
  }
});

// 3️⃣ GET posts by category slug (child categories)
app.get("/public/category/:slug", async (req, res) => {
  try {
    const slug = req.params.slug;

    const posts = await Post.find({
      status: "published",
      category: { $in: [slug] }
    }).sort({ createdAt: -1 });

    res.json(posts);

  } catch (err) {
    console.error("GET /public/category/:slug ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// 4️⃣ SEARCH posts (title + sapo + tags)
app.get("/public/search", async (req, res) => {
  try {
    const q = req.query.q || "";

    const posts = await Post.find({
      status: "published",
      $or: [
        { title: { $regex: q, $options: "i" } },
        { sapo: { $regex: q, $options: "i" } },
        { tags: { $regex: q, $options: "i" } }
      ]
    });

    res.json(posts);

  } catch (err) {
    console.error("GET /public/search ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================
// HOME API (Tiêu điểm + 5 chuyên mục lớn)
// ============================

app.get("/home", async (req, res) => {
  try {
    // Lấy tất cả bài đã xuất bản và sort mới nhất → cũ nhất
    const all = await Post.find({ status: "published" })
      .sort({ createdAt: -1 });

    if (all.length === 0)
      return res.json({
        highlight: null,
        recent: [],
        tintuc: [],
        trainghiem: [],
        guongmat: [],
        gochocthuat: [],
        multimedia: []
      });

    // -----------------------------
    // 1️⃣ TIÊU ĐIỂM — Không theo chuyên mục
    // -----------------------------
    const highlight = all[0];        // Bài mới nhất
    const recent = all.slice(1, 3);  // 2 bài tiếp theo

    // -----------------------------
    // 2️⃣ NHÓM THEO CHUYÊN MỤC LỚN
    // -----------------------------
    const groups = {
      tintuc: [],
      trainghiem: [],
      guongmat: [],
      gochocthuat: [],
      multimedia: []
    };

    all.forEach(post => {
      if (!Array.isArray(post.category)) return;

      post.category.forEach(cat => {
        if (["tin-trong-nuoc", "tin-the-gioi"].includes(cat))
          groups.tintuc.push(post);

        if (["am-thuc", "diem-den", "ba-lo-du-lich", "di-chuyen-xanh"].includes(cat))
          groups.trainghiem.push(post);

        if (["nguoi-dan-xanh", "su-gia-van-hoa", "doanh-nghiep-xanh"].includes(cat))
          groups.guongmat.push(post);

        if (["cong-nghe-xanh", "tri-thuc-ben-vung", "du-lieu-chinh-sach"].includes(cat))
          groups.gochocthuat.push(post);

        if (["anh", "video", "infographic", "emagazine"].includes(cat))
          groups.multimedia.push(post);
      });
    });

    // -----------------------------
    // 3️⃣ TRẢ DỮ LIỆU VỀ CHO FRONTEND
    // -----------------------------
    res.json({
      highlight: highlight,
      recent: recent,
      tintuc: groups.tintuc.slice(0, 4),
      trainghiem: groups.trainghiem.slice(0, 4),
      guongmat: groups.guongmat.slice(0, 4),
      gochocthuat: groups.gochocthuat.slice(0, 4),
      multimedia: groups.multimedia.slice(0, 4)
    });

  } catch (err) {
    console.error("GET /home ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================
// START SERVER
// ============================
app.listen(PORT, () =>
  console.log(`🚀 Server chạy tại PORT: ${PORT}`)
);
