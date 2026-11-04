/* =====================================================
   fx.js — Hiệu ứng, hoạt ảnh & tối ưu đồng bộ
   Nạp SAU app.js. Chỉ "bọc" thêm hành vi, không sửa logic gốc.
   Tự tắt hiệu ứng nếu người dùng bật "giảm chuyển động".
===================================================== */
(function () {
  const REDUCE = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  const FINE_POINTER = window.matchMedia && matchMedia("(pointer: fine)").matches;

  /* ---------- 1. TỐI ƯU ĐỒNG BỘ SUPABASE ---------- */
  // • Không tải lại dữ liệu khi tab đang ẩn (tiết kiệm băng thông + quota Supabase)
  // • Không chạy 2 lượt đồng bộ chồng nhau
  // • Quay lại tab → làm mới ngay
  if (typeof sync === "function") {
    const origSync = sync;
    let running = null;
    sync = function (...tables) {
      if (document.hidden && CURRENT_USER) return Promise.resolve();
      if (running && tables.length > 3) return running; // lượt đồng bộ định kỳ (nhiều bảng) đang chạy
      const p = origSync.apply(this, tables).finally(() => { if (running === p) running = null; });
      if (tables.length > 3) running = p;
      return p;
    };
    let lastVisible = Date.now();
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;
      if (CURRENT_USER && DBX.remote && Date.now() - lastVisible > 20000) {
        sync("users", "exams", "lessons", "notices", "comments", "question_reports", "qa_questions", "qa_messages", "presence", "dm_messages");
      }
      lastVisible = Date.now();
    });
    // Báo mất / có mạng
    window.addEventListener("offline", () => toast("Mất kết nối mạng — dữ liệu có thể chưa được lưu", true));
    window.addEventListener("online", () => { toast("Đã có mạng trở lại ✓"); if (CURRENT_USER) sync("users", "exams", "lessons", "results"); });
  }

  /* ---------- 2. TOAST CÓ ICON + HOẠT ẢNH LẶP LẠI ---------- */
  if (typeof toast === "function") {
    const origToast = toast;
    toast = function (msg, isErr) {
      const el = document.getElementById("toast");
      origToast((isErr ? "⚠️ " : "✓ ") + msg.replace(/^[✓⚠️\s]+/u, ""), isErr);
      el.classList.remove("toast-pop"); void el.offsetWidth; el.classList.add("toast-pop");
    };
  }

  if (REDUCE) return; // từ đây trở xuống là hiệu ứng chuyển động

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /* ---------- 3. RIPPLE khi bấm nút ---------- */
  document.addEventListener("pointerdown", (e) => {
    const b = e.target.closest(".btn, .tab-btn, .seg-btn, .opt, .tf-btn, .bn-btn, .side-nav-btn");
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 1.6;
    const s = document.createElement("span");
    s.className = "ripple";
    s.style.cssText = `width:${size}px;height:${size}px;left:${e.clientX - r.left - size / 2}px;top:${e.clientY - r.top - size / 2}px`;
    b.classList.add("has-ripple");
    b.appendChild(s);
    setTimeout(() => s.remove(), 600);
  }, { passive: true });

  /* ---------- 4. ÁNH SÁNG THEO CHUỘT + NGHIÊNG 3D ---------- */
  if (FINE_POINTER) {
    document.addEventListener("pointermove", (e) => {
      const hero = e.target.closest && e.target.closest(".hero");
      if (hero) {
        const r = hero.getBoundingClientRect();
        hero.style.setProperty("--mx", (e.clientX - r.left) + "px");
        hero.style.setProperty("--my", (e.clientY - r.top) + "px");
      }
      const card = e.target.closest && e.target.closest(".card.hoverable");
      if (card) {
        const r = card.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - .5, y = (e.clientY - r.top) / r.height - .5;
        card.style.transform = `perspective(900px) rotateX(${(-y * 4).toFixed(2)}deg) rotateY(${(x * 5).toFixed(2)}deg) translateY(-3px)`;
        card.style.setProperty("--gx", (x + .5) * 100 + "%");
        card.style.setProperty("--gy", (y + .5) * 100 + "%");
      }
    }, { passive: true });
    document.addEventListener("pointerout", (e) => {
      const card = e.target.closest && e.target.closest(".card.hoverable");
      if (card && !card.contains(e.relatedTarget)) card.style.transform = "";
    }, { passive: true });
  }

  /* ---------- 5. HIỆN DẦN KHI CUỘN + ĐẾM SỐ ---------- */
  const io = "IntersectionObserver" in window ? new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); }
    });
  }, { rootMargin: "0px 0px -6% 0px", threshold: .05 }) : null;

  function countUp(el) {
    const txt = el.textContent.trim();
    if (el.dataset.fx || !/^\d{1,7}$/.test(txt)) return;
    el.dataset.fx = "1";
    const target = +txt, t0 = performance.now(), dur = 900;
    if (target < 2) return;
    const tick = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(tick); else el.textContent = target;
    };
    el.textContent = "0";
    requestAnimationFrame(tick);
  }

  function enhance(root) {
    if (!root || root.nodeType !== 1) return;
    const sel = ".rank-row, .admin-row, .qa-card, .comment-item, .chapter-block, .doc-item, .stat-card, .result-row";
    const nodes = root.matches && root.matches(sel) ? [root] : [];
    nodes.push(...$$(sel, root));
    nodes.forEach((n, i) => {
      if (n.dataset.rv) return;
      n.dataset.rv = "1";
      if (!io) return;
      n.classList.add("reveal");
      n.style.setProperty("--rv-delay", Math.min(i % 12, 8) * 40 + "ms");
      io.observe(n);
    });
    $$(".hero-stat b, .stat-card b", root).forEach(countUp);
  }

  const main = $("#main");
  if (main) {
    new MutationObserver((muts) => {
      muts.forEach((m) => m.addedNodes.forEach(enhance));
    }).observe(main, { childList: true, subtree: true });
  }

  /* ---------- 6. PHÁO GIẤY khi điểm cao ---------- */
  function confetti() {
    const cv = document.createElement("canvas");
    cv.className = "confetti-canvas";
    cv.width = innerWidth; cv.height = innerHeight;
    document.body.appendChild(cv);
    const ctx = cv.getContext("2d");
    const colors = ["#2946C8", "#A8730F", "#C8232C", "#1E7B45", "#FFD8A8", "#7D96FF"];
    const P = Array.from({ length: 140 }, () => ({
      x: innerWidth / 2 + (Math.random() - .5) * 120, y: innerHeight * .35,
      vx: (Math.random() - .5) * 15, vy: -Math.random() * 14 - 3,
      w: 6 + Math.random() * 6, h: 4 + Math.random() * 5, r: Math.random() * 6.28, vr: (Math.random() - .5) * .4,
      c: colors[(Math.random() * colors.length) | 0],
    }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, cv.width, cv.height);
      P.forEach((p) => {
        p.vy += .38; p.vx *= .99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.fillStyle = p.c;
        ctx.globalAlpha = Math.max(0, 1 - (t - t0) / 3200);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (t - t0 < 3200) requestAnimationFrame(frame); else cv.remove();
    })(t0);
  }
  if (typeof renderResult === "function") {
    const origResult = renderResult;
    renderResult = function (m) {
      origResult.apply(this, arguments);
      try { if (LAST_RESULT && LAST_RESULT.score10 >= 8) setTimeout(confetti, 450); } catch (e) {}
    };
  }

  /* ---------- 7. Đổi giao diện sáng/tối: nút xoay ---------- */
  const tb = $("#theme-btn");
  if (tb) tb.addEventListener("click", () => {
    tb.classList.remove("spin"); void tb.offsetWidth; tb.classList.add("spin");
  });

  // Hiệu ứng cho nội dung đã có sẵn lúc nạp
  enhance(main);
})();
