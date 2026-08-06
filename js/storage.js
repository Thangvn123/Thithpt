/* =====================================================
   storage.js — Lớp dữ liệu 2 chế độ:
   • SQL (Supabase/PostgreSQL) nếu đã cấu hình js/config.js
     → dữ liệu ĐỒNG BỘ CHUNG cho mọi người, mọi thiết bị
   • localStorage nếu chưa cấu hình → chạy cục bộ trên máy

   Cả hai chế độ dùng chung một giao diện:
     DBX.list(table)             → mảng bản ghi
     DBX.insert(table, row)      → thêm bản ghi
     DBX.remove(table, col, val) → xoá theo điều kiện
===================================================== */

const DBX = {
  remote: false,
  base: "",
  headers: null,

  init() {
    if (typeof CONFIG !== "undefined" && CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY) {
      this.remote = true;
      this.base = CONFIG.SUPABASE_URL.replace(/\/+$/, "") + "/rest/v1/";
      this.headers = {
        apikey: CONFIG.SUPABASE_ANON_KEY,
        Authorization: "Bearer " + CONFIG.SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      };
    }
  },

  async list(table) {
    if (!this.remote) return LocalDB.list(table);
    const res = await fetch(this.base + table + "?select=*&order=created_at.asc", { headers: this.headers });
    if (!res.ok) throw new Error("SQL: không đọc được bảng " + table + " (HTTP " + res.status + ")");
    return res.json();
  },

  async insert(table, row) {
    if (!this.remote) return LocalDB.insert(table, row);
    const res = await fetch(this.base + table, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify(row),
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error("SQL: không lưu được vào " + table + " — " + t.slice(0, 180));
    }
  },

  async remove(table, col, value) {
    if (!this.remote) return LocalDB.remove(table, col, value);
    const res = await fetch(this.base + table + "?" + col + "=eq." + encodeURIComponent(value), {
      method: "DELETE",
      headers: this.headers,
    });
    if (!res.ok) throw new Error("SQL: không xoá được ở bảng " + table);
  },
};

/* ---------- Chế độ cục bộ (localStorage) ---------- */
const LocalDB = {
  key: (t) => "ptt_tbl_" + t,

  list(table) {
    try {
      const raw = localStorage.getItem(this.key(table));
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      console.error(e);
      return [];
    }
  },

  insert(table, row) {
    const rows = this.list(table);
    rows.push(row);
    try {
      localStorage.setItem(this.key(table), JSON.stringify(rows));
    } catch (e) {
      throw new Error("Bộ nhớ trình duyệt đã đầy — hãy dùng file nhỏ hơn hoặc dán link video thay vì tải file.");
    }
  },

  remove(table, col, value) {
    const rows = this.list(table).filter((r) => r[col] !== value);
    localStorage.setItem(this.key(table), JSON.stringify(rows));
  },
};

/* ---------- Tiện ích ---------- */
const DB = {
  base64Size(dataUrl) {
    const i = dataUrl.indexOf(",");
    return Math.round((dataUrl.length - i - 1) * 0.75);
  },
  formatSize(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / 1024 / 1024).toFixed(2) + " MB";
  },
};

/* =====================================================
   AUTH — Đăng ký / đăng nhập qua Supabase Auth
   (email xác minh tự động; chỉ hoạt động ở chế độ SQL)
===================================================== */
const AUTH = {
  headers() {
    return { apikey: CONFIG.SUPABASE_ANON_KEY, "Content-Type": "application/json" };
  },
  base() {
    return CONFIG.SUPABASE_URL.replace(/\/+$/, "") + "/auth/v1";
  },

  async signUp(email, password, name) {
    const r = await fetch(this.base() + "/signup", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ email, password, data: { name } }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.msg || j.error_description || j.message || "Đăng ký thất bại");
    return j;
  },

  async signIn(email, password) {
    const r = await fetch(this.base() + "/token?grant_type=password", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ email, password }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error_description || j.msg || j.message || "Đăng nhập thất bại");
    return j;
  },

  async resend(email) {
    const r = await fetch(this.base() + "/resend", {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ type: "signup", email }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      throw new Error(j.msg || j.error_description || "Không gửi lại được email");
    }
  },

  async updatePassword(accessToken, newPassword) {
    const r = await fetch(this.base() + "/user", {
      method: "PUT",
      headers: { ...this.headers(), Authorization: "Bearer " + accessToken },
      body: JSON.stringify({ password: newPassword }),
    });
    const j = await r.json();
    if (!r.ok) throw new Error(j.msg || j.error_description || j.message || "Đổi mật khẩu thất bại");
    return j;
  },
};
