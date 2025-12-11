// migrate_uploads_to_cloudinary.js
import dotenv from "dotenv";
dotenv.config();

import fs from "fs";
import path from "path";
import mongoose from "mongoose";
import { fileURLToPath } from "url";
import { v2 as cloudinary } from "cloudinary";

// Fix __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// =========================
// 1) CONFIG CLOUDINARY
// =========================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// =========================
// 2) CONNECT MONGO
// =========================
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error", err));


// =========================
// 3) POST MODEL
// =========================
const PostSchema = new mongoose.Schema({
  title: String,
  thumbnail: String,
  content: String,
  createdAt: Date
});
const Post = mongoose.model("Post", PostSchema);


// =========================
// 4) MIGRATION
// =========================
async function migrateUploads() {
  const uploadDir = path.join(__dirname, "uploads");

  if (!fs.existsSync(uploadDir)) {
    console.log("⚠️ Thư mục uploads không tồn tại.");
    process.exit(0);
  }

  const files = fs.readdirSync(uploadDir);
  console.log(`📁 Có ${files.length} file trong uploads/ cần check.`);

  // ========= LẤY CÁC POST CÓ THUMBNAIL LOCAL =========
  const posts = await Post.find({
    thumbnail: { $regex: "^/uploads|uploads|http://localhost|dulichxanh-backend" }
  });

  console.log(`📝 Có ${posts.length} bài viết có thumbnail local cần migrate.`);

  for (const post of posts) {
    try {
      const oldThumb = post.thumbnail;

      // lấy tên file từ URL cũ
      const filename = oldThumb.split("/").pop();
      const localPath = path.join(uploadDir, filename);

      if (!fs.existsSync(localPath)) {
        console.log(`⚠️ File không tìm thấy: ${localPath}`);
        continue;
      }

      console.log(`⬆️ Upload Cloudinary: ${filename} ...`);

      // UPLOAD LÊN CLOUDINARY
      const result = await cloudinary.uploader.upload(localPath, {
        folder: process.env.CLOUDINARY_FOLDER || "dulichxanh",
      });

      // CẬP NHẬT DB
      post.thumbnail = result.secure_url;
      await post.save();

      console.log(`✔️ Đã cập nhật: ${post._id}`);

    } catch (err) {
      console.error("❌ Lỗi migrate:", err);
    }
  }

  console.log("🎉 DONE — Migrate hoàn tất!");
  process.exit(0);
}

migrateUploads();
