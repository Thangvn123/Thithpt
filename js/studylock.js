/* =====================================================
   studylock.js — Chặn xem bài giảng khi lâu không học
   • Học sinh KHÔNG xem bài giảng / không nộp bài thi quá N ngày (mặc định 7)
     → bị chặn xem video bài giảng, hiện thông báo "liên hệ admin".
   • Đã bị chặn thì chỉ admin mới gỡ được (làm đề không tự mở lại).
   • Lưu trong bảng "settings" có sẵn → KHÔNG cần tạo bảng mới:
       key "study_lock_config"      → { enabled, days, minSeconds, realTimeFrom }
       key "study_lock:<username>"  → { locked, lockedAt, resetAt, manual }
   • Admin, người giải bài không bị áp dụng.
===================================================== */
(function () {
  const DAY = 86400000;
  const CFG_KEY = "study_lock_config";
  const PFX = "study_lock:";
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const SL = (window.StudyLock = {
    cfg: { enabled: true, days: 7, minSeconds: 30, realTimeFrom: 0 },
    states: {},
    ready: false,        // đã đọc được bảng settings → tính năng mới hoạt động
    hasCfgRow: false,
  });

  const isStudent = (u) => !!u && (u.role === "user" || !u.role);

  /* ---------- Đọc dữ liệu từ bảng settings ---------- */
  SL.parse = function (rows) {
    SL.ready = true;
    SL.states = {};
    SL.hasCfgRow = false;
    (rows || []).forEach((r) => {
      if (r.key === CFG_KEY && r.value) {
        SL.cfg = Object.assign({ enabled: true, days: 7, minSeconds: 30, realTimeFrom: 0 }, r.value);
        SL.hasCfgRow = true;
      } else if (typeof r.key === "string" && r.key.startsWith(PFX)) {
        SL.states[r.key.slice(PFX.length)] = r.value || {};
      }
    });
    SL.refresh();
  };

  async function save(key, value) {
    await DBX.upsert("settings", { key, value, updated_at: Date.now() }, "key");
  }

  /* ---------- Đo thời gian xem video thật ----------
     app.js gọi noteWatch mỗi lần có báo cáo tiến độ (~5 giây một lần khi video đang chạy).
     Cộng dồn khoảng thời gian giữa 2 báo cáo liên tiếp của cùng một bài; đủ minSeconds thì ghi nhận "đã học". */
  let lastMarkSave = 0;
  SL.noteWatch = function (lessonId, watchedSeconds) {
    const u = CURRENT_USER;
    if (!SL.ready || !SL.cfg.enabled || !isStudent(u) || !watchedSeconds) return; // chỉ mở trang → không tính
    const now = Date.now(), last = SL._last;
    SL._last = { lessonId, t: now };
    if (!last || last.lessonId !== lessonId) return;
    const gap = (now - last.t) / 1000;
    if (gap <= 0 || gap > 12) return; // ngắt quãng / tạm dừng lâu: không cộng
    const key = "ptt_sl_acc:" + u.username;
    let acc = (+localStorage.getItem(key) || 0) + Math.min(gap, 6);
    if (acc >= (+SL.cfg.minSeconds || 30)) {
      acc = 0;
      const st = Object.assign({}, SL.states[u.username] || {}, { studiedAt: now });
      SL.states[u.username] = st;
      if (now - lastMarkSave > 60000) { lastMarkSave = now; save(PFX + u.username, st).catch((e) => console.warn(e.message)); }
    }
    try { localStorage.setItem(key, acc); } catch (e) {}
  };

  /* ---------- Tính lần học gần nhất ---------- */
  SL.lastStudy = function (username) {
    const st = SL.states[username] || {};
    const u = USERS.find((x) => x.username === username) || {};
    // Chỉ dùng dữ liệu thật: lịch sử xem bài, lịch sử nộp bài, ngày tạo tài khoản, lần admin gỡ chặn
    // studiedAt = lần xem video đủ thời gian (đo thời gian xem thật từ khi cài tính năng)
    let t = Math.max(+u.created_at || 0, +st.resetAt || 0, +st.studiedAt || 0);
    // Dữ liệu cũ (trước khi cài): chỉ tính bài đã xem được ít nhất minSeconds giây
    const minS = +SL.cfg.minSeconds || 30, cutoff = +SL.cfg.realTimeFrom || Infinity;
    (PROGRESS || []).forEach((p) => {
      if (p.username === username && (+p.watched_seconds || 0) >= minS && (+p.created_at || 0) < cutoff) t = Math.max(t, +p.created_at || 0);
    });
    (RESULTS || []).forEach((r) => { if (r.username === username) t = Math.max(t, +r.date || +r.created_at || 0); });
    return t;
  };
  SL.isLocked = (username) => !!(SL.states[username] && SL.states[username].locked);
  SL.daysSince = (username) => { const t = SL.lastStudy(username); return t ? Math.floor((Date.now() - t) / DAY) : null; };
  const overdue = (username) => { const t = SL.lastStudy(username); return t > 0 && Date.now() - t > SL.cfg.days * DAY; };

  /* ---------- Tự động chặn khi quá hạn (chỉ chặn, không tự gỡ) ---------- */
  async function evaluate(u) {
    if (!SL.ready || !SL.cfg.enabled || !isStudent(u) || SL.isLocked(u.username)) return;
    if (SL.lastStudy(u.username) === 0) {
      // Tài khoản chưa có bất kỳ dữ liệu học nào và không có ngày tạo → bắt đầu tính từ lần đăng nhập này
      const st0 = { locked: false, resetAt: Date.now(), firstSeen: true };
      SL.states[u.username] = st0;
      try { await save(PFX + u.username, st0); } catch (e) { console.warn(e.message); }
      return;
    }
    if (!overdue(u.username)) return;
    const st = { locked: true, lockedAt: Date.now(), manual: false };
    SL.states[u.username] = st;
    try { await save(PFX + u.username, st); } catch (e) { console.warn("Không lưu được trạng thái chặn:", e.message); }
  }

  /* ---------- Màn hình thông báo ---------- */
  function adminUser() { return USERS.find((x) => x.role === "admin"); }
  function msgHtml(u) {
    const last = new Date(SL.lastStudy(u.username));
    const st = SL.states[u.username] || {};
    const why = st.manual
      ? "Quản trị viên đã tạm khoá quyền xem bài giảng của bạn."
      : `Bạn đã hơn <b>${SL.cfg.days} ngày</b> chưa học trên hệ thống nên quyền xem video bài giảng tạm thời bị khoá.`;
    return { why, last: last.toLocaleDateString("vi-VN") };
  }
  function lockBody(u) {
    const m = msgHtml(u);
    return `
      <div class="sl-icon" aria-hidden="true">🔒</div>
      <h2 class="sl-title">Bạn đang bị chặn xem bài giảng</h2>
      <p class="sl-text">${m.why}<br/>Hãy <b>liên hệ với admin</b> để được gỡ hạn chế.</p>
      <p class="sl-meta">Lần học gần nhất: ${m.last}</p>
      <div class="sl-actions">
        ${adminUser() ? `<button class="btn btn-primary" id="sl-contact">💬 Nhắn tin cho admin</button>` : ""}
        <button class="btn btn-outline" id="sl-home">Về trang chủ</button>
      </div>`;
  }
  function bindActions(root, closeFn) {
    const c = $("#sl-contact", root); if (c) c.addEventListener("click", () => { closeFn && closeFn(); go("messagedetail", adminUser().username); });
    const h = $("#sl-home", root); if (h) h.addEventListener("click", () => { closeFn && closeFn(); go("exams"); });
  }

  /* Chặn trang bài giảng: trả về true nếu đã chặn */
  SL.guard = function (main) {
    const u = CURRENT_USER;
    if (!SL.ready || !isStudent(u) || !SL.isLocked(u.username)) return false;
    main.innerHTML = `<div class="sl-page card">${lockBody(u)}</div>`;
    bindActions(main);
    return true;
  };

  /* Thông báo phủ trước màn hình khi vừa đăng nhập */
  function showOverlay() {
    const u = CURRENT_USER;
    if ($("#sl-overlay") || !isStudent(u)) return;
    const ov = document.createElement("div");
    ov.id = "sl-overlay"; ov.className = "sl-overlay"; ov.setAttribute("role", "alertdialog"); ov.setAttribute("aria-modal", "true");
    ov.innerHTML = `<div class="sl-box">${lockBody(u).replace('id="sl-home">Về trang chủ', 'id="sl-home">Đã hiểu')}</div>`;
    document.body.appendChild(ov);
    const close = () => ov.remove();
    const home = $("#sl-home", ov);
    if (home) home.addEventListener("click", close, { once: true });
    const c = $("#sl-contact", ov);
    if (c) c.addEventListener("click", () => { close(); go("messagedetail", adminUser().username); });
  }

  /* Gỡ thông báo khi đăng xuất / đổi người dùng */
  SL.clear = function () { const ov = $("#sl-overlay"); if (ov) ov.remove(); };

  /* Gọi sau khi đăng nhập */
  SL.onLogin = async function () {
    SL.clear();
    if (!SL.ready) return;
    if (!SL.hasCfgRow || !SL.cfg.realTimeFrom) { // lần đầu: lưu cấu hình mặc định + mốc bắt đầu đo thời gian xem thật
      SL.hasCfgRow = true;
      SL.cfg.realTimeFrom = SL.cfg.realTimeFrom || Date.now();
      try { await save(CFG_KEY, SL.cfg); } catch (e) { console.warn(e.message); }
    }
    await evaluate(CURRENT_USER);
    if (CURRENT_USER && SL.isLocked(CURRENT_USER.username)) showOverlay();
  };

  /* Đồng bộ: nếu admin vừa gỡ chặn → tự đóng thông báo */
  SL.refresh = function () {
    if (!CURRENT_USER) return;
    const ov = $("#sl-overlay");
    if (ov && !SL.isLocked(CURRENT_USER.username)) { ov.remove(); toast("Admin đã gỡ chặn — bạn có thể xem bài giảng lại ✓"); }
    if (typeof VIEW !== "undefined" && VIEW === "lesson" && SL.isLocked(CURRENT_USER.username)) {
      const main = $("#main"); if (main) SL.guard(main); // vừa bị chặn lúc đang xem → dừng video
    }
  };

  /* ---------- Phần của admin ---------- */
  SL.badge = function (u) {
    if (!isStudent(u)) return "";
    return SL.isLocked(u.username) ? '<span class="badge-restricted" style="background:var(--red-soft);color:var(--red)">⛔ BỊ CHẶN</span>' : "";
  };
  SL.lastText = function (u) {
    if (!isStudent(u) || !SL.ready) return "";
    const d = SL.daysSince(u.username);
    return d === null ? " · chưa có dữ liệu học" : ` · học cuối: ${d <= 0 ? "hôm nay" : d + " ngày trước"}`;
  };
  SL.btn = function (u) {
    if (!isStudent(u) || !SL.ready) return "";
    return SL.isLocked(u.username)
      ? `<button class="btn btn-gold btn-sm" data-sl-toggle="${u.username.replace(/"/g, "&quot;")}">🔓 Gỡ chặn</button>`
      : `<button class="btn btn-outline btn-sm" data-sl-toggle="${u.username.replace(/"/g, "&quot;")}">⛔ Chặn</button>`;
  };
  SL.toggle = async function (username, rerender) {
    const wasLocked = SL.isLocked(username);
    const st = wasLocked ? { locked: false, resetAt: Date.now(), by: CURRENT_USER.username } : { locked: true, lockedAt: Date.now(), manual: true, by: CURRENT_USER.username };
    try {
      await save(PFX + username, st);
      SL.states[username] = st;
      toast(wasLocked ? `Đã gỡ chặn cho "${username}" — tính lại ${SL.cfg.days} ngày từ hôm nay` : `Đã chặn xem bài giảng của "${username}"`);
      rerender && rerender();
    } catch (e) { toast("Không lưu được: " + e.message, true); }
  };
  /* Danh sách học sinh đang quá hạn theo dữ liệu cũ nhưng chưa bị chặn */
  SL.findOverdue = function () {
    return USERS.filter((u) => isStudent(u) && !SL.isLocked(u.username) && overdue(u.username));
  };
  SL.scanAll = function (rerender) {
    if (!SL.cfg.enabled) return toast("Tính năng đang tắt — hãy bật rồi lưu cài đặt trước", true);
    const list = SL.findOverdue();
    const noData = USERS.filter((u) => isStudent(u) && !SL.isLocked(u.username) && SL.lastStudy(u.username) === 0).length;
    if (!list.length) return toast("Không có học sinh nào quá " + SL.cfg.days + " ngày chưa học" + (noData ? ` (${noData} em chưa có dữ liệu học, bỏ qua)` : ""));
    const names = list.map((u) => `${u.name} (${SL.daysSince(u.username)} ngày)`).slice(0, 12).join(", ") + (list.length > 12 ? "…" : "");
    confirmModal("Chặn ngay " + list.length + " học sinh?", `Theo dữ liệu cũ, các em sau đã quá ${SL.cfg.days} ngày chưa xem bài giảng hoặc nộp bài: ${names}. Các em sẽ bị chặn xem video bài giảng cho tới khi bạn gỡ chặn.`, async () => {
      let ok = 0;
      for (const u of list) {
        const st = { locked: true, lockedAt: Date.now(), manual: false, by: CURRENT_USER.username };
        try { await save(PFX + u.username, st); SL.states[u.username] = st; ok++; } catch (e) { console.warn(e.message); }
      }
      toast(`Đã chặn ${ok}/${list.length} học sinh`);
      rerender && rerender();
    });
  };
  SL.panelHtml = function () {
    if (!SL.ready) return "";
    return `<div class="card sl-panel" id="sl-panel">
      <div class="sl-panel-head"><b>⏳ Tự động chặn khi lâu không học</b>
        <label class="sl-switch"><input type="checkbox" id="sl-enabled" ${SL.cfg.enabled ? "checked" : ""}/><span>Bật</span></label>
      </div>
      <p class="card-meta">Học sinh không <b>xem video bài giảng đủ</b>
        <input type="number" id="sl-secs" min="5" max="3600" value="${SL.cfg.minSeconds || 30}" class="short-input" style="width:72px;margin:0 6px"/> giây (xem thật, chỉ mở trang không tính) hoặc nộp bài thi trong
        <input type="number" id="sl-days" min="1" max="90" value="${SL.cfg.days}" class="short-input" style="width:64px;margin:0 6px"/> ngày sẽ bị chặn xem video bài giảng, đến khi admin gỡ chặn.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-primary btn-sm" id="sl-save">Lưu cài đặt</button>
        <button class="btn btn-gold btn-sm" id="sl-scan">🔍 Quét &amp; chặn ngay theo dữ liệu cũ</button>
      </div>
      <p class="card-meta" style="margin-top:10px;margin-bottom:0">Tự động: ai quá hạn sẽ bị chặn ở lần đăng nhập kế tiếp. Nút quét giúp chặn sẵn cả lớp ngay bây giờ.</p>
    </div>`;
  };
  SL.bindPanel = function (rerender) {
    const b = $("#sl-save"); if (!b) return;
    $("#sl-scan").addEventListener("click", () => SL.scanAll(rerender));
    b.addEventListener("click", async () => {
      const days = Math.min(90, Math.max(1, parseInt($("#sl-days").value, 10) || 7));
      const minSeconds = Math.min(3600, Math.max(5, parseInt($("#sl-secs").value, 10) || 30));
      const cfg = { enabled: $("#sl-enabled").checked, days, minSeconds, realTimeFrom: SL.cfg.realTimeFrom || Date.now() };
      try { await save(CFG_KEY, cfg); SL.cfg = cfg; $("#sl-days").value = days; $("#sl-secs").value = minSeconds; toast("Đã lưu cài đặt chặn"); }
      catch (e) { toast("Không lưu được: " + e.message, true); }
    });
  };
})();
