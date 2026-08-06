/* =====================================================
   config.js — Cấu hình kết nối cơ sở dữ liệu SQL (Supabase)

   👉 CÁCH BẬT ĐỒNG BỘ SQL (xem chi tiết trong README.md):
   1. Tạo project miễn phí tại https://supabase.com
   2. Vào SQL Editor, chạy file supabase-schema.sql
   3. Vào Settings → API, copy "Project URL" và "anon public key"
   4. Dán vào 2 dòng dưới đây rồi lưu file

   Nếu để trống, web vẫn chạy bình thường ở CHẾ ĐỘ CỤC BỘ
   (dữ liệu chỉ lưu trên trình duyệt từng máy).
===================================================== */
const CONFIG = {
  SUPABASE_URL: "https://zzclnrrxycbasippddfl.supabase.co",      // vd: "https://abcdxyz.supabase.co"
  SUPABASE_ANON_KEY: "sb_publishable_X41Gs0E73dQkPo3Ox31L9Q_xUGvViNW", // vd: "eyJhbGciOiJIUzI1NiIs..."
};
