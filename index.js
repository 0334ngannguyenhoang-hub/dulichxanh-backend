import dotenv from "dotenv";
dotenv.config();

import express from "express";
import mongoose from "mongoose";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import multer from "multer";
import { fileURLToPath } from "url";
import path from "path";

// Cloudinary
import { v2 as cloudinary } from "cloudinary";
import { CloudinaryStorage } from "multer-storage-cloudinary";

// ============================
// CLOUDINARY CONFIG
// ============================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// ============================
// ESM __dirname FIX
// ============================
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
  .catch(err => console.log("❌ MongoDB ERROR:", err));

// ============================
// USER MODEL
// ============================
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["writer", "editor", "admin"], default: "writer" },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", UserSchema);

// ============================
// POST MODEL
// ============================
const PostSchema = new mongoose.Schema({
  title: String,
  sapo: String,
  author: String,
  authorId: String,
  thumbnail: String,
  tags: String,
  content: String,

  type: { type: String, default: "normal" },
  emagPage: String,

  category: [String],
  status: { type: String, default: "draft" },
  createdAt: { type: Date, default: Date.now }
});

const Post = mongoose.model("Post", PostSchema);

// ============================
// AUTH MIDDLEWARE
// ============================
function requireAuth(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "Missing Authorization header" });

  const token = auth.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Invalid Authorization header" });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: "Forbidden" });
    next();
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

    if (await User.findOne({ username }))
      return res.status(400).json({ error: "username already exists" });

    const hash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = new User({ username, passwordHash: hash });
    await user.save();

    const token = jwt.sign({ id: user._id, username, role: user.role }, JWT_SECRET);
    res.json({ message: "User created", user, token });
  } catch (err) {
    console.error("REGISTER ERROR:", err);
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
      { id: user._id, username: user.username, role: user.role },
      JWT_SECRET
    );

    res.json({ message: "Login success", user, token });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================
// POSTS API
// ============================
app.get("/posts", requireAuth, async (req, res) => {
  try {
    const q = req.query.status ? { status: req.query.status } : {};
    const posts = await Post.find(q).sort({ createdAt: -1 });
    res.json(posts);
  } catch (err) {
    console.error("GET /posts ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

app.post("/posts", requireAuth, async (req, res) => {
  try {
    const data = { ...req.body, authorId: req.user.id };
    const newPost = await Post.create(data);
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
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

app.delete("/posts/:id", requireAuth, async (req, res) => {
  try {
    await Post.findByIdAndDelete(req.params.id);
    res.json({ message: "Deleted" });
  } catch {
    res.status(500).json({ error: "Server error" });
  }
});

app.patch("/posts/:id/publish", requireAuth, async (req, res) => {
  const updated = await Post.findByIdAndUpdate(req.params.id, { status: "published" }, { new: true });
  res.json(updated);
});

app.patch("/posts/:id/unpublish", requireAuth, async (req, res) => {
  const updated = await Post.findByIdAndUpdate(req.params.id, { status: "draft" }, { new: true });
  res.json(updated);
});

app.get("/posts/:id", requireAuth, async (req, res) => {
  const post = await Post.findById(req.params.id);
  if (!post) return res.status(404).json({ error: "Post not found" });
  res.json(post);
});

// ============================
// CLOUDINARY UPLOAD
// ============================
const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder: "dulichxanh",
    allowed_formats: ["jpg", "jpeg", "png", "webp"]
  }
});

const upload = multer({ storage });

app.post("/upload", upload.single("image"), (req, res) => {
  try {
    if (!req.file || !req.file.path) {
      return res.status(400).json({ error: "Upload failed" });
    }
    res.json({ url: req.file.path });
  } catch (err) {
    console.error("UPLOAD ERROR:", err);
    res.status(500).json({ error: "Server error" });
  }
});

// ============================
// PUBLIC API
// ============================
app.get("/public/posts", async (req, res) => {
  const posts = await Post.find({ status: "published" }).sort({ createdAt: -1 });
  res.json(posts);
});

app.get("/public/posts/:id", async (req, res) => {
  const id = req.params.id;
  if (!mongoose.Types.ObjectId.isValid(id))
    return res.status(400).json({ error: "Invalid id" });

  const post = await Post.findById(id);
  if (!post || post.status !== "published")
    return res.status(404).json({ error: "Post not found" });

  res.json(post);
});

app.get("/public/category/:slug", async (req, res) => {
  const posts = await Post.find({
    status: "published",
    category: { $in: [req.params.slug] }
  }).sort({ createdAt: -1 });
  res.json(posts);
});

app.get("/public/search", async (req, res) => {
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
});

// ============================
// HOME API
// ============================
app.get("/home", async (req, res) => {
  const all = await Post.find({ status: "published" }).sort({ createdAt: -1 });

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

  const highlight = all[0];
  const recent = all.slice(1, 3);

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

  res.json({
    highlight,
    recent,
    tintuc: groups.tintuc.slice(0, 4),
    trainghiem: groups.trainghiem.slice(0, 4),
    guongmat: groups.guongmat.slice(0, 4),
    gochocthuat: groups.gochocthuat.slice(0, 4),
    multimedia: groups.multimedia.slice(0, 4)
  });
});

// ============================
// START SERVER
// ============================
app.listen(PORT, () =>
  console.log(`🚀 Server chạy tại PORT: ${PORT}`)
);
