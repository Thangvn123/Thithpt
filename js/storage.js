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

  async list(table, orderCol, cols) {
    if (!this.remote) return LocalDB.list(table);
    const order = orderCol || "created_at";
    const pageSize = 1000; // PostgREST (Supabase) chỉ trả tối đa 1000 dòng/lần mặc định — phải phân trang mới lấy hết
    let all = [];
    let from = 0;
    while (true) {
      const to = from + pageSize - 1;
      const res = await fetch(this.base + table + "?select=" + (cols || "*") + "&order=" + order + ".asc", {
        headers: { ...this.headers, Range: from + "-" + to },
      });
      if (!res.ok && res.status !== 206) throw new Error("SQL: không đọc được bảng " + table + " (HTTP " + res.status + ")");
      const page = await res.json();
      all = all.concat(page);
      if (page.length < pageSize) break; // trang cuối rồi, ít hơn 1 trang đầy nghĩa là hết dữ liệu
      from += pageSize;
    }
    return all;
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

  /* Ghi đè 1 dòng theo khoá chính — an toàn hơn xoá-rồi-ghi (không có khoảng hở giữa 2 bước,
     nên nếu mạng bị gián đoạn thì dữ liệu cũ vẫn còn nguyên, không bao giờ bị mất trắng). */
  async upsert(table, row, conflictCol) {
    if (!this.remote) { LocalDB.remove(table, conflictCol, row[conflictCol]); return LocalDB.insert(table, row); }
    const res = await fetch(this.base + table + "?on_conflict=" + conflictCol, {
      method: "POST",
      headers: { ...this.headers, Prefer: "resolution=merge-duplicates,return=minimal" },
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

  async removeMany(table, col, values) {
    if (!values || values.length === 0) return;
    if (!this.remote) { values.forEach((v) => LocalDB.remove(table, col, v)); return; }
    const list = values.map((v) => encodeURIComponent(v)).join(",");
    const res = await fetch(this.base + table + "?" + col + "=in.(" + list + ")", {
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

/* =====================================================
   PW — Băm mật khẩu (SHA-256 + muối ngẫu nhiên)
   • Mật khẩu mới luôn được băm trước khi lưu
   • Tài khoản cũ (lưu chữ thường) vẫn đăng nhập được và
     TỰ ĐỘNG được nâng cấp lên bản băm ở lần đăng nhập kế tiếp
   Lưu ý: băm phía trình duyệt chỉ giảm rủi ro lộ mật khẩu gốc,
   KHÔNG thay thế Supabase Auth + Row Level Security.
===================================================== */
const PW = {
  ok: !!(window.crypto && crypto.subtle),
  async _sha(text) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  },
  async hash(plain) {
    if (!this.ok) return plain; // trình duyệt không hỗ trợ (cần HTTPS) → giữ nguyên
    const salt = Array.from(crypto.getRandomValues(new Uint8Array(12))).map((b) => b.toString(16).padStart(2, "0")).join("");
    return "sha256$" + salt + "$" + (await this._sha(salt + plain));
  },
  isHashed(stored) { return typeof stored === "string" && stored.startsWith("sha256$"); },
  async verify(stored, plain) {
    if (!this.isHashed(stored)) return stored === plain;
    if (!this.ok) return false;
    const [, salt, h] = stored.split("$");
    return (await this._sha(salt + plain)) === h;
  },
};
