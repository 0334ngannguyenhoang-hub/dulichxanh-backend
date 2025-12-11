// check_image_links.js
import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { v2 as cloudinary } from "cloudinary";

// ============================
// CONNECT DATABASE
// ============================
mongoose
  .connect(process.env.MONGO_URL)
  .then(() => console.log("📦 MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB error:", err));

const PostSchema = new mongoose.Schema({
  title: String,
  thumbnail: String,
  content: String,
});
const Post = mongoose.model("Post", PostSchema);

// ============================
// CHECK URL EXISTS
// ============================
async function checkUrl(url) {
  try {
    const res = await fetch(url, { method: "HEAD" });
    return res.ok;
  } catch {
    return false;
  }
}

// ============================
// MAIN CHECKER
// ============================
async function runCheck() {
  const posts = await Post.find({});
  console.log(`📌 Đang kiểm tra ${posts.length} bài viết...\n`);

  const bad = [];

  for (const post of posts) {
    let issues = [];

    // ------------------------------
    // 1) CHECK THUMBNAIL
    // ------------------------------
    if (!post.thumbnail) {
      issues.push("❌ Thumbnail: không có");
    } else if (!post.thumbnail.includes("cloudinary.com")) {
      issues.push(`⚠️ Thumbnail không phải Cloudinary → ${post.thumbnail}`);
    } else {
      const ok = await checkUrl(post.thumbnail);
      if (!ok) issues.push(`❌ Thumbnail bị 404 → ${post.thumbnail}`);
    }

    // ------------------------------
    // 2) CHECK IMAGE INSIDE CONTENT
    // ------------------------------
    const matches = post.content?.match(/https?:\/\/[^\s"'<>]+/g) || [];
    const images = matches.filter((u) =>
      u.match(/\.(jpg|jpeg|png|gif|webp)/i)
    );

    for (const img of images) {
      const ok = await checkUrl(img);
      if (!ok) issues.push(`❌ Ảnh trong content bị lỗi → ${img}`);
    }

    // ------------------------------
    // GHI NHẬN KẾT QUẢ
    // ------------------------------
    if (issues.length > 0) {
      bad.push({ title: post.title, issues });
    }
  }

  // ================================
  // IN KẾT QUẢ
  // ================================
  if (bad.length === 0) {
    console.log("🎉 Tất cả ảnh đều OK, bạn có thể deploy!");
  } else {
    console.log("\n=============================");
    console.log("⚠️ CÁC BÀI CÓ ẢNH LỖI:");
    console.log("=============================\n");

    bad.forEach((p) => {
      console.log(`🔸 ${p.title}`);
      p.issues.forEach((i) => console.log("   → " + i));
      console.log("");
    });
  }

  process.exit(0);
}

runCheck();
