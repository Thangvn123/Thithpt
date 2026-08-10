/* =====================================================
   app.js — Logic giao diện chính của Phòng Thi Thử
===================================================== */

/* ---------- Trạng thái ---------- */
let USERS = [], EXAMS = [], LESSONS = [], RESULTS = [], PROGRESS = [], NOTICES = [], COMMENTS = [], REPORTS = [], CHAPTER_ORDER = [], CHAPTER_LOCKS = {};
let QA_QUESTIONS = [], QA_MESSAGES = [];
let CURRENT_USER = null;
let VIEW = "exams";
let TAKING = null;         // đề đang làm
let TAKING_ORDER_MAP = null; // ánh xạ câu/đáp án khi đề bị trộn (để xem lại bài làm)
let TAKING_STATE = null;   // { answers, left, timerId, start }
let LAST_RESULT = null;

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/* Render công thức toán (\( ... \)) sau khi nội dung câu hỏi đã được chèn vào DOM */
function typesetMath(el) {
  if (window.MathJax && window.MathJax.typesetPromise) {
    window.MathJax.typesetPromise([el]).catch((e) => console.error("MathJax:", e));
  }
}

/* ---------- Khởi động ---------- */
init();
async function init() {
  DBX.init();
  setupTheme();
  setupAuth();
  setupNav();
  setupNotif();
  updateDbBadge();
  try {
    await loadAllTables();
  } catch (e) {
    console.error(e);
    alert("Không kết nối được cơ sở dữ liệu SQL.\nHãy kiểm tra lại js/config.js và bảng trong Supabase.\n\nChi tiết: " + e.message);
  }

  // Tự đăng nhập lại nếu máy này còn phiên hợp lệ
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("ptt_login") || "null"); } catch (e) {}
  if (saved && saved.username) {
    const row = USERS.find((x) => x.username === saved.username);
    if (row && (!row.session || row.session === saved.session)) {
      login(row, true);
      return;
    }
    localStorage.removeItem("ptt_login");
  }
  showAuth();
}

async function loadAllTables() {
  const [u, e, l, r] = await Promise.all([
    DBX.list("users"), DBX.list("exams"), DBX.list("lessons"), DBX.list("results"),
  ]);
  USERS = u;
  EXAMS = e.map(rowToExam);
  LESSONS = l.map(rowToLesson);
  RESULTS = r.map(rowToResult);
  try { PROGRESS = await DBX.list("progress"); }
  catch (err) { PROGRESS = []; console.warn("Chưa có bảng progress (chạy SQL bổ sung để bật lịch sử học):", err.message); }
  try { NOTICES = await DBX.list("notices"); }
  catch (err) { NOTICES = []; console.warn("Chưa có bảng notices (chạy SQL bổ sung để bật thông báo admin):", err.message); }
  try { COMMENTS = await DBX.list("comments"); }
  catch (err) { COMMENTS = []; console.warn("Chưa có bảng comments (chạy SQL bổ sung để bật bình luận):", err.message); }
  try { REPORTS = await DBX.list("question_reports"); }
  catch (err) { REPORTS = []; console.warn("Chưa có bảng question_reports (chạy SQL bổ sung để bật báo lỗi câu hỏi):", err.message); }
  try { QA_QUESTIONS = await DBX.list("qa_questions"); }
  catch (err) { QA_QUESTIONS = []; console.warn("Chưa có bảng qa_questions (chạy SQL bổ sung để bật Hỏi bài):", err.message); }
  try { QA_MESSAGES = await DBX.list("qa_messages"); }
  catch (err) { QA_MESSAGES = []; console.warn("Chưa có bảng qa_messages (chạy SQL bổ sung để bật chat Hỏi bài):", err.message); }
  try {
    const rows = await DBX.list("settings");
    const orderRow = rows.find((r) => r.key === "chapter_order");
    CHAPTER_ORDER = (orderRow && orderRow.value) || [];
    const lockRow = rows.find((r) => r.key === "chapter_locks");
    CHAPTER_LOCKS = (lockRow && lockRow.value) || {};
  } catch (err) { CHAPTER_ORDER = []; CHAPTER_LOCKS = {}; console.warn("Chưa có bảng settings (chạy SQL bổ sung để lưu thứ tự/khoá chương):", err.message); }

  // Tạo admin mặc định nếu hệ thống chưa có
  if (!USERS.some((x) => x.role === "admin")) {
    const admin = { username: "admin", password: "admin123", name: "Quản trị viên", role: "admin" };
    USERS.push(admin);
    try { await DBX.insert("users", admin); } catch (err) { console.error(err); }
  }
  // Nạp đề mẫu nếu chưa có đề nào
  if (EXAMS.length === 0) {
    const sample = parseExamText(SAMPLE_EXAM_TEXT);
    sample.id = "exam_sample";
    sample.uploader = "admin";
    sample.createdAt = Date.now();
    EXAMS.push(sample);
    try { await DBX.insert("exams", examToRow(sample)); } catch (err) { console.error(err); }
  }
}

function updateDbBadge() {
  const b = $("#db-badge");
  if (!b) return;
  b.innerHTML = DBX.remote
    ? '<span class="db-badge-sql">🗄 SQL đồng bộ</span>'
    : '<span class="db-badge-local">💾 Chế độ cục bộ</span>';
}

/* Đồng bộ lại các bảng từ SQL (bỏ qua nếu đang chạy cục bộ) */
async function sync(...tables) {
  if (!DBX.remote) return;
  for (const t of tables) {
    try {
      const rows = await DBX.list(t);
      if (t === "users") USERS = rows;
      else if (t === "exams") EXAMS = rows.map(rowToExam);
      else if (t === "lessons") LESSONS = rows.map(rowToLesson);
      else if (t === "results") RESULTS = rows.map(rowToResult);
      else if (t === "progress") PROGRESS = rows;
      else if (t === "notices") NOTICES = rows;
      else if (t === "comments") COMMENTS = rows;
      else if (t === "question_reports") REPORTS = rows;
      else if (t === "qa_questions") QA_QUESTIONS = rows;
      else if (t === "qa_messages") QA_MESSAGES = rows;
      else if (t === "settings") {
        const orderRow = rows.find((r) => r.key === "chapter_order");
        CHAPTER_ORDER = (orderRow && orderRow.value) || [];
        const lockRow = rows.find((r) => r.key === "chapter_locks");
        CHAPTER_LOCKS = (lockRow && lockRow.value) || {};
      }
    } catch (e) { console.error(e); }
  }
  updateNotifBadge();
  updateQABadge();
  verifySession();
}

/* Hiện màn hình chờ rồi đồng bộ (chỉ ở chế độ SQL) */
async function syncView(main, tables) {
  if (!DBX.remote) return;
  main.innerHTML = '<div class="loading"><div class="spinner"></div>Đang đồng bộ dữ liệu…</div>';
  await sync(...tables);
}

/* ---------- Chuyển đổi bản ghi SQL ⇄ đối tượng trong app ---------- */
function rowToExam(r) {
  const d = r.data || {};
  return { id: r.id, title: r.title, subject: r.subject, duration: r.duration, p1: d.p1 || [], p2: d.p2 || [], p3: d.p3 || [], sourceFile: d.sourceFile || null, shuffle: !!d.shuffle, uploader: r.uploader, createdAt: +r.created_at || Date.now() };
}
function examToRow(e) {
  return { id: e.id, title: e.title, subject: e.subject, duration: e.duration, data: { p1: e.p1, p2: e.p2, p3: e.p3, sourceFile: e.sourceFile || null, shuffle: !!e.shuffle }, uploader: e.uploader, created_at: e.createdAt };
}
function rowToLesson(r) {
  return { id: r.id, title: r.title, subject: r.subject, category: r.category, chapter: r.chapter, lesson: r.lesson, description: r.description, videoType: r.video_type, videoUrl: r.video_url, videoData: r.video_data, thumb: r.thumb || null, docs: r.docs || [], uploader: r.uploader, createdAt: +r.created_at || Date.now() };
}
function lessonToRow(l) {
  return { id: l.id, title: l.title, subject: l.subject, category: l.category, chapter: l.chapter, lesson: l.lesson, description: l.description, video_type: l.videoType, video_url: l.videoUrl, video_data: l.videoData, thumb: l.thumb || null, docs: l.docs, uploader: l.uploader, created_at: l.createdAt };
}
function rowToResult(r) {
  return { id: r.id, examId: r.exam_id, examTitle: r.exam_title, username: r.username, name: r.name, raw: r.raw, maxRaw: r.max_raw, score10: r.score10, detail: r.detail, answers: r.answers || null, orderMap: r.order_map || null, tabSwitches: r.tab_switches || 0, timeUsed: r.time_used, date: +r.created_at || Date.now() };
}
function resultToRow(r) {
  return { id: r.id, exam_id: r.examId, exam_title: r.examTitle, username: r.username, name: r.name, raw: r.raw, max_raw: r.maxRaw, score10: r.score10, detail: r.detail, answers: r.answers || null, order_map: r.orderMap || null, tab_switches: r.tabSwitches || 0, time_used: r.timeUsed, created_at: r.date };
}


/* Ghi lịch sử học: mỗi người + mỗi video là 1 dòng, xem lại thì cập nhật thời gian */
function recordProgress(lessonId) {
  const id = CURRENT_USER.username + "__" + lessonId;
  const row = { id, username: CURRENT_USER.username, lesson_id: lessonId, created_at: Date.now() };
  PROGRESS = PROGRESS.filter((p) => p.id !== id);
  PROGRESS.push(row);
  (async () => {
    try { await DBX.remove("progress", "id", id); } catch (e) { /* chưa có dòng cũ, bỏ qua */ }
    try { await DBX.insert("progress", row); } catch (e) { console.warn("Không lưu được lịch sử học:", e.message); }
  })();
}

/* =====================================================
   THÔNG BÁO 🔔 — báo bài giảng / đề thi mới + thông báo admin
===================================================== */
function seenKey() { return "ptt_seen_" + (CURRENT_USER ? CURRENT_USER.username : ""); }
function getLastSeen() { return +(localStorage.getItem(seenKey()) || 0); }
function markSeen() { localStorage.setItem(seenKey(), String(Date.now())); }

/* Gom danh sách thông báo: đề mới, bài giảng mới (30 ngày gần nhất), thông báo admin, bình luận liên quan đến bạn */
function getNotifItems() {
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const items = [];
  for (const n of NOTICES) {
    items.push({ type: "notice", icon: "📣", title: n.message, time: +n.created_at || 0, target: null });
  }
  const myExamIds = new Set(getVisibleExams().map((e) => e.id));
  const myLessonIdsVisible = new Set(getVisibleLessons().map((l) => l.id));
  for (const e of EXAMS) {
    if (e.createdAt > cutoff && myExamIds.has(e.id)) items.push({ type: "exam", icon: "📝", title: "Đề thi mới: " + e.title, time: e.createdAt, target: { view: "exams" } });
  }
  for (const l of LESSONS) {
    if (l.createdAt > cutoff && myLessonIdsVisible.has(l.id)) items.push({ type: "lesson", icon: "🎬", title: "Bài giảng mới: " + l.title, time: l.createdAt, target: { view: "lesson", payload: l.id } });
  }

  // Bình luận: báo khi có người trả lời bình luận của bạn, hoặc bình luận vào bài giảng bạn đăng
  if (CURRENT_USER) {
    const myLessonIds = new Set(LESSONS.filter((l) => l.uploader === CURRENT_USER.username).map((l) => l.id));
    const commentById = {};
    for (const c of COMMENTS) commentById[c.id] = c;
    for (const c of COMMENTS) {
      if (c.username === CURRENT_USER.username) continue; // không tự thông báo bình luận của chính mình
      const t = +c.created_at || 0;
      if (t <= cutoff) continue;
      const lesson = LESSONS.find((l) => l.id === c.lesson_id);
      if (!lesson) continue;
      let msg = null;
      if (c.parent_id) {
        const parent = commentById[c.parent_id];
        if (parent && parent.username === CURRENT_USER.username) {
          msg = (c.name || c.username) + " đã trả lời bình luận của bạn ở \"" + lesson.title + "\"";
        }
      }
      if (!msg && myLessonIds.has(c.lesson_id)) {
        msg = (c.name || c.username) + " đã bình luận vào bài giảng \"" + lesson.title + "\"";
      }
      if (msg) items.push({ type: "comment", icon: "💬", title: msg, time: t, target: { view: "lesson", payload: lesson.id } });
    }
  }

  // Báo lỗi câu hỏi: chỉ admin nhận thông báo (người xử lý báo cáo)
  if (CURRENT_USER && CURRENT_USER.role === "admin") {
    for (const rp of REPORTS) {
      const t = +rp.created_at || 0;
      if (t <= cutoff || rp.resolved) continue;
      items.push({
        type: "report", icon: "🚩",
        title: (rp.name || rp.username) + " báo lỗi câu hỏi trong \"" + rp.exam_title + "\"",
        time: t, target: { view: "admin", payload: "reports" },
      });
    }
  }

  return items.sort((a, b) => b.time - a.time).slice(0, 20);
}

function updateNotifBadge() {
  const badge = $("#notif-badge");
  if (!badge || !CURRENT_USER) return;
  const unseen = getNotifItems().filter((it) => it.time > getLastSeen()).length;
  badge.textContent = unseen > 9 ? "9+" : unseen;
  badge.classList.toggle("hidden", unseen === 0);
}

function setupNotif() {
  const btn = $("#notif-btn");
  const panel = $("#notif-panel");
  btn.addEventListener("click", () => {
    if (!panel.classList.contains("hidden")) { panel.classList.add("hidden"); return; }
    const lastSeen = getLastSeen();
    const items = getNotifItems();
    panel.innerHTML = `
      <div class="notif-head">🔔 Thông báo</div>
      ${items.length === 0 ? `<p class="notif-empty">Chưa có thông báo nào.</p>` : items.map((it, i) => `
        <button class="notif-item ${it.time > lastSeen ? "unseen" : ""}" data-nidx="${i}">
          <span class="notif-icon">${it.icon}</span>
          <span class="notif-body">
            <span class="notif-title">${esc(it.title)}</span>
            <span class="notif-time">${new Date(it.time).toLocaleString("vi-VN")}</span>
          </span>
        </button>`).join("")}`;
    panel.classList.remove("hidden");
    markSeen();
    updateNotifBadge();
    $$("[data-nidx]", panel).forEach((b) =>
      b.addEventListener("click", () => {
        const it = items[+b.dataset.nidx];
        panel.classList.add("hidden");
        if (it.target) go(it.target.view, it.target.payload);
      })
    );
  });
  // Bấm ra ngoài thì đóng panel
  document.addEventListener("click", (e) => {
    if (!panel.classList.contains("hidden") && !panel.contains(e.target) && e.target !== btn && !btn.contains(e.target)) {
      panel.classList.add("hidden");
    }
  });
}

/* ---------- Giao diện sáng / tối ---------- */
function setupTheme() {
  const btn = $("#theme-btn");
  const apply = (t) => {
    document.documentElement.dataset.theme = t;
    btn.textContent = t === "dark" ? "☀️" : "🌙";
    localStorage.setItem("ptt_theme", t);
  };
  apply(localStorage.getItem("ptt_theme") || "light");
  btn.addEventListener("click", () =>
    apply(document.documentElement.dataset.theme === "dark" ? "light" : "dark")
  );
}

/* ---------- Đăng nhập / đăng ký ---------- */
function setupAuth() {
  const showSuccess = (m) => { const el = $("#auth-success"); el.textContent = m; el.classList.remove("hidden"); };
  const showResend = (email) => {
    const btn = $("#auth-resend");
    btn.classList.remove("hidden");
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = "Đang gửi…";
      try {
        await AUTH.resend(email);
        showSuccess("Đã gửi lại email xác minh tới " + email + ". Kiểm tra hộp thư (cả mục Spam).");
      } catch (e) { showAuthError("Không gửi lại được: " + e.message); }
      btn.disabled = false; btn.textContent = "📧 Gửi lại email xác minh";
    };
  };

  const submit = async () => {
    hideAuthError();
    const un = $("#auth-username").value.trim().toLowerCase();
    const pw = $("#auth-password").value;
    if (!un || !pw) return showAuthError("Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu.");

    const btn = $("#auth-submit");
    btn.disabled = true;

    try {
      await sync("users");
      // Tìm theo tên đăng nhập hoặc email đều được
      const row = USERS.find((x) => x.username === un || (x.email && x.email.toLowerCase() === un));
      if (!row) {
        showAuthError("Không tìm thấy tài khoản này. Liên hệ quản trị viên để được cấp tài khoản.");
      } else if (row.password !== "supabase-auth") {
        /* Tài khoản kiểu cũ / do admin tạo trực tiếp */
        if (row.password === pw) login(row);
        else showAuthError("Sai mật khẩu.");
      } else {
        /* Tài khoản email-xác-minh (tạo từ trước khi tắt đăng ký công khai) */
        try {
          await AUTH.signIn(row.email, pw);
          login(row);
        } catch (e) {
          if (/confirm/i.test(e.message)) {
            showAuthError("Email chưa được xác minh. Mở hộp thư " + row.email + " (kiểm tra cả Spam) và bấm link xác nhận trước.");
            showResend(row.email);
          } else {
            showAuthError("Sai mật khẩu.");
          }
        }
      }
    } catch (e) {
      showAuthError(e.message);
    }
    btn.disabled = false;
  };
  $("#auth-submit").addEventListener("click", submit);
  $("#auth-password").addEventListener("keydown", (e) => e.key === "Enter" && submit());
}
function showAuthError(msg) { const el = $("#auth-error"); el.textContent = msg; el.classList.remove("hidden"); }
function hideAuthError() {
  $("#auth-error").classList.add("hidden");
  $("#auth-success").classList.add("hidden");
  $("#auth-resend").classList.add("hidden");
}

function login(u, restore) {
  CURRENT_USER = u;
  $("#auth-screen").classList.add("hidden");
  $("#app-shell").classList.remove("hidden");
  $("#user-chip").innerHTML = esc(u.name) + (u.role === "admin" ? '<span class="badge-admin">ADMIN</span>' : u.role === "solver" ? '<span class="badge-solver">GIẢI BÀI</span>' : "");
  updateTopbarAvatar();
  $$(".admin-only").forEach((el) => el.classList.toggle("hidden", u.role !== "admin"));
  if (!localStorage.getItem(seenKey())) markSeen(); // lần đầu đăng nhập trên máy: không dồn thông báo cũ
  updateNotifBadge();
  go("exams");
  startSessionWatch();

  if (!restore) {
    // Tạo mã phiên mới: lưu vào máy này + ghi lên SQL → thiết bị khác đang đăng nhập sẽ bị đăng xuất
    const sess = "s_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
    u.session = sess;
    localStorage.setItem("ptt_login", JSON.stringify({ username: u.username, session: sess }));
    (async () => {
      try {
        await DBX.remove("users", "username", u.username);
        try {
          await DBX.insert("users", u);
        } catch (e1) {
          // CSDL chưa có cột session → chèn lại KHÔNG kèm session để không mất tài khoản
          const fb = { ...u };
          delete fb.session;
          await DBX.insert("users", fb);
          console.warn("CSDL chưa có cột session. Hãy chạy SQL: alter table users add column if not exists session text;");
        }
      } catch (e) { console.warn("Không lưu được phiên đăng nhập:", e.message); }
    })();
  }
}
function showAuth() {
  CURRENT_USER = null;
  stopTimer();
  clearInterval(SESS_TIMER);
  localStorage.removeItem("ptt_login");
  $("#app-shell").classList.add("hidden");
  $("#auth-screen").classList.remove("hidden");
}

/* ---------- Giữ phiên & mỗi tài khoản 1 thiết bị ---------- */
let SESS_TIMER = null;
function startSessionWatch() {
  clearInterval(SESS_TIMER);
  if (!DBX.remote) return;
  SESS_TIMER = setInterval(() => { sync("users", "exams", "lessons", "notices", "comments", "question_reports", "qa_questions", "qa_messages"); }, 60000); // mỗi phút kiểm tra phiên + thông báo mới
}
function verifySession() {
  if (!CURRENT_USER) return;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem("ptt_login") || "null"); } catch (e) {}
  const row = USERS.find((x) => x.username === CURRENT_USER.username);
  if (!row) return forceLogout("Tài khoản của bạn đã bị xoá khỏi hệ thống.");
  if (saved && saved.session && row.session && row.session !== saved.session) {
    forceLogout("Tài khoản vừa được đăng nhập trên thiết bị khác nên phiên này đã bị đăng xuất.");
  }
}
function forceLogout(msg) {
  showAuth();
  showAuthError(msg);
}

/* ---------- Điều hướng ---------- */
function setupNav() {
  $$("#main-nav .nav-btn").forEach((b) => b.addEventListener("click", () => go(b.dataset.view)));
  $("#brand-home").addEventListener("click", () => go("exams"));
  $("#profile-btn").addEventListener("click", () => go("profile"));
  $("#changepw-btn").addEventListener("click", () => go("changepw"));
  $("#logout-btn").addEventListener("click", () => {
    if (VIEW === "taking") {
      confirmModal("Thoát phòng thi?", "Bạn đang làm bài. Đăng xuất sẽ hủy bài thi hiện tại.", () => showAuth());
    } else showAuth();
  });
}

function go(view, payload) {
  if (VIEW === "taking" && view !== "taking" && view !== "result") stopTimer();
  if (VIEW === "exams" && view !== "exams" && COUNTDOWN_TIMER) { clearInterval(COUNTDOWN_TIMER); COUNTDOWN_TIMER = null; }
  VIEW = view;
  $$("#main-nav .nav-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  const main = $("#main");
  window.scrollTo({ top: 0 });
  main.classList.remove("view-anim");
  void main.offsetWidth; // buộc trình duyệt chạy lại animation
  main.classList.add("view-anim");

  if (view === "exams") renderExams(main);
  else if (view === "lessons") renderLessons(main);
  else if (view === "lesson") renderLessonDetail(main, payload);
  else if (view === "rank") renderRank(main);
  else if (view === "upload") renderUpload(main);
  else if (view === "admin") renderAdmin(main, payload);
  else if (view === "editexam") renderEditExam(main, payload);
  else if (view === "editlesson") renderEditLesson(main, payload);
  else if (view === "changepw") renderChangePassword(main);
  else if (view === "reviewexam") renderReviewExam(main, payload);
  else if (view === "myattempts") renderMyAttempts(main, payload);
  else if (view === "studentprogress") renderStudentProgress(main, payload);
  else if (view === "studentaccess") renderStudentAccess(main, payload);
  else if (view === "orderchapters") renderOrderChapters(main);
  else if (view === "taking") renderTaking(main);
  else if (view === "result") renderResult(main);
  else if (view === "qa") renderQA(main);
  else if (view === "qadetail") renderQADetail(main, payload);
  else if (view === "profile") renderProfile(main);
}

/* =====================================================
   TRANG ĐỀ THI
===================================================== */
function renderExams(main) { renderExamsAsync(main); }
async function renderExamsAsync(main) {
  await syncView(main, ["exams", "results"]);
  if (VIEW !== "exams") return;
  const myBest = (id) => {
    const rs = RESULTS.filter((r) => r.examId === id && r.username === CURRENT_USER.username);
    return rs.length ? Math.max(...rs.map((r) => r.score10)) : null;
  };
  const nStudents = new Set(RESULTS.map((r) => r.username)).size;
  const visibleExams = getVisibleExams();

  main.innerHTML = `
    <div class="hero">
      <p class="hero-eyebrow">KỲ THI THỬ TỐT NGHIỆP THPT</p>
      <h2 class="hero-title">Chào ${esc(CURRENT_USER.name)},<br/>hôm nay <span class="accent">luyện đề</span> nhé!</h2>
      <p class="hero-sub">Làm đề — hệ thống chấm tự động theo đúng quy chế thi 2025, sau đó xem thứ hạng của bạn trên bảng vàng.</p>
      <div class="hero-stats">
        <div class="hero-stat"><b>${visibleExams.length}</b><span>đề thi</span></div>
        <div class="hero-stat"><b>${getVisibleLessons().length}</b><span>bài giảng</span></div>
        <div class="hero-stat"><b>${RESULTS.length}</b><span>lượt thi</span></div>
        <div class="hero-stat"><b>${nStudents}</b><span>thí sinh đã thi</span></div>
      </div>
      <div class="countdown-box" id="exam-countdown">
        <p class="countdown-label">⏳ Còn lại đến kỳ thi tốt nghiệp THPT 2027 <span style="opacity:.75">(dự kiến 12/06/2027)</span></p>
        <div class="countdown-numbers" id="countdown-numbers"></div>
      </div>
    </div>

    <div class="page-head">
      <div>
        <h2 class="page-title">Danh sách đề thi</h2>
        <p class="page-sub">Có thể thi lại nhiều lần — bảng xếp hạng lấy điểm cao nhất của bạn.</p>
      </div>
    </div>

    ${visibleExams.length === 0 ? `
      <div class="empty"><div class="big">📝</div>Chưa có đề thi nào.${CURRENT_USER.role === "admin" ? ` Vào mục <b>Tải lên</b> để thêm đề đầu tiên.` : ""}</div>
    ` : `
      <div class="grid grid-2">
        ${visibleExams.map((ex) => {
          const nQ = ex.p1.length + ex.p2.length + ex.p3.length;
          const attempts = RESULTS.filter((r) => r.examId === ex.id).length;
          const myAttempts = RESULTS.filter((r) => r.examId === ex.id && r.username === CURRENT_USER.username).length;
          const best = myBest(ex.id);
          return `
            <div class="card hoverable">
              <div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start">
                <div style="min-width:0">
                  <span class="chip chip-pen">${esc(ex.subject)}</span>
                  ${ex.shuffle ? `<span class="chip chip-gold">🔀 Đề trộn</span>` : ""}
                  <h3 class="card-title">${esc(ex.title)}</h3>
                </div>
                ${best != null ? `<div style="text-align:center"><div class="score-stamp">${best.toFixed(1)}</div><div style="font-size:11px;color:var(--pencil);margin-top:4px">của bạn</div></div>` : ""}
              </div>
              <p class="card-meta">${nQ} câu · ${ex.duration} phút · ${attempts} lượt thi<br/>Đăng bởi ${esc(ex.uploader)}</p>
              <div class="card-actions">
                <button class="btn btn-primary" data-start="${ex.id}">Vào thi</button>
                ${myAttempts > 0 ? `<button class="btn btn-outline" data-history="${ex.id}">🕘 Lịch sử (${myAttempts})</button>` : ""}
              </div>
            </div>`;
        }).join("")}
      </div>
    `}`;

  $$("[data-start]", main).forEach((b) =>
    b.addEventListener("click", () => startExam(b.dataset.start))
  );
  $$("[data-history]", main).forEach((b) =>
    b.addEventListener("click", () => go("myattempts", b.dataset.history))
  );

  startExamCountdown();
}

/* Đồng hồ đếm ngược tới kỳ thi tốt nghiệp THPT 2027 (dự kiến 12/06/2027 theo Bộ GD&ĐT) */
let COUNTDOWN_TIMER = null;
function updateExamCountdown() {
  const el = $("#countdown-numbers");
  if (!el) { clearInterval(COUNTDOWN_TIMER); COUNTDOWN_TIMER = null; return; }
  const target = new Date("2027-06-12T00:00:00+07:00").getTime();
  const diff = target - Date.now();
  if (diff <= 0) {
    el.innerHTML = `<div class="cd-done">🎉 Chúc các em thi tốt!</div>`;
    clearInterval(COUNTDOWN_TIMER); COUNTDOWN_TIMER = null;
    return;
  }
  const days = Math.floor(diff / 86400000);
  const hours = Math.floor((diff % 86400000) / 3600000);
  const mins = Math.floor((diff % 3600000) / 60000);
  const secs = Math.floor((diff % 60000) / 1000);
  el.innerHTML = `
    <div class="cd-unit"><b>${days}</b><span>ngày</span></div>
    <div class="cd-unit"><b>${String(hours).padStart(2, "0")}</b><span>giờ</span></div>
    <div class="cd-unit"><b>${String(mins).padStart(2, "0")}</b><span>phút</span></div>
    <div class="cd-unit"><b>${String(secs).padStart(2, "0")}</b><span>giây</span></div>`;
}
function startExamCountdown() {
  if (COUNTDOWN_TIMER) clearInterval(COUNTDOWN_TIMER);
  updateExamCountdown();
  COUNTDOWN_TIMER = setInterval(updateExamCountdown, 1000);
}

/* =====================================================
   LÀM BÀI THI
===================================================== */
function startExam(id) {
  const ex = EXAMS.find((e) => e.id === id);
  if (!ex) return;
  if (!getVisibleExams().some((e) => e.id === id)) return;
  if (ex.shuffle) {
    const built = buildShuffledExam(ex);
    TAKING = built.exam;
    TAKING_ORDER_MAP = built.orderMap;
  } else {
    TAKING = ex;
    TAKING_ORDER_MAP = null;
  }
  TAKING_STATE = { answers: { p1: {}, p2: {}, p3: {} }, left: ex.duration * 60, start: Date.now(), timerId: null, submitted: false };
  go("taking");
}

function stopTimer() {
  if (TAKING_STATE && TAKING_STATE.timerId) clearInterval(TAKING_STATE.timerId);
  if (TAKING_STATE && TAKING_STATE.__cleanupAntiCheat) {
    TAKING_STATE.__cleanupAntiCheat();
    TAKING_STATE.__cleanupAntiCheat = null;
  }
}

function renderTaking(main) {
  const ex = TAKING, st = TAKING_STATE;
  const parts = [
    { key: "p1", tab: "Phần I", list: ex.p1 },
    { key: "p2", tab: "Phần II", list: ex.p2 },
    { key: "p3", tab: "Phần III", list: ex.p3 },
  ].filter((p) => p.list.length);
  if (!st.activePart || !parts.some((p) => p.key === st.activePart)) st.activePart = parts[0] ? parts[0].key : "p1";

  main.innerHTML = `
    <div class="exam-wrap">
      <div class="exam-timerbar" id="timerbar">
        <div>
          <div class="timer-label">Thời gian còn lại</div>
          <div class="timer-value" id="timer-value">--:--</div>
          <span id="anticheat-badge" class="anticheat-badge hidden"></span>
        </div>
        <div class="timer-right">
          <div class="timer-progress" id="progress-text"></div>
          <div style="display:flex;gap:8px;justify-content:flex-end">
            <button class="btn btn-ghost btn-sm" id="exit-btn">Thoát</button>
            <button class="btn btn-danger btn-sm" id="submit-btn">Nộp bài</button>
          </div>
        </div>
      </div>
      <div id="fs-reenter-banner" class="fs-reenter-banner hidden">
        🔲 Bạn đang không ở chế độ toàn màn hình.
        <button class="btn btn-outline btn-sm" id="fs-reenter-btn">Vào lại toàn màn hình</button>
      </div>

      ${parts.length > 1 ? `
      <div class="exam-part-tabs">
        ${parts.map((p) => `<button class="seg-btn ${p.key === st.activePart ? "active" : ""}" data-part-tab="${p.key}">${p.tab} <span class="part-tab-count" data-part-count="${p.key}"></span></button>`).join("")}
      </div>` : ""}

      <div class="exam-paper">
        <div class="exam-paper-head">
          <p class="eyebrow">KỲ THI THỬ TỐT NGHIỆP THPT · MÔN ${esc(ex.subject.toUpperCase())}</p>
          <h2 class="exam-paper-title">${esc(ex.title)}</h2>
          <p class="exam-paper-meta">Thời gian làm bài: ${ex.duration} phút, không kể thời gian phát đề</p>
          ${ex.sourceFile ? `<a class="btn btn-outline btn-sm" href="${esc(ex.sourceFile)}" target="_blank" rel="noopener" style="margin-top:10px">📄 Xem đề gốc (PDF có hình đầy đủ)</a>` : ""}
        </div>

        ${ex.p1.length ? `
        <div class="exam-part" data-part-block="p1" ${st.activePart !== "p1" ? "hidden" : ""}>
          <div class="section-head"><span class="sh-num">I</span><div><h3>PHẦN I. Trắc nghiệm nhiều lựa chọn</h3><p>Mỗi câu đúng được 0,25 điểm. Chọn một phương án A, B, C hoặc D.</p></div></div>
          ${ex.p1.map((q, i) => `
            <div class="q">
              <p class="q-text"><span class="q-num">Câu ${i + 1}.</span> ${esc(q.q)} <button class="q-report-btn" data-report-part="p1" data-report-idx="${i}" data-report-text="${esc(q.q)}" title="Báo lỗi câu này">🚩</button></p>
              ${q.img ? `<img class="q-img" src="${q.img}" alt="Hình minh họa câu ${i + 1}" loading="lazy" />` : ""}
              <div class="opts">
                ${q.options.map((opt, j) => `
                  <button class="opt ${st.answers.p1[i] === "ABCD"[j] ? "selected" : ""}" data-p1="${i}" data-letter="${"ABCD"[j]}">
                    <span class="opt-letter">${"ABCD"[j]}.</span><span>${esc(opt)}</span>
                  </button>`).join("")}
              </div>
            </div>`).join("")}
        </div>` : ""}

        ${ex.p2.length ? `
        <div class="exam-part" data-part-block="p2" ${st.activePart !== "p2" ? "hidden" : ""}>
          <div class="section-head"><span class="sh-num">II</span><div><h3>PHẦN II. Trắc nghiệm đúng / sai</h3><p>Đúng 1 ý: 0,1đ · 2 ý: 0,25đ · 3 ý: 0,5đ · 4 ý: 1,0đ.</p></div></div>
          ${ex.p2.map((q, i) => `
            <div class="q">
              <p class="q-text"><span class="q-num">Câu ${i + 1}.</span> ${esc(q.q)} <button class="q-report-btn" data-report-part="p2" data-report-idx="${i}" data-report-text="${esc(q.q)}" title="Báo lỗi câu này">🚩</button></p>
              ${q.img ? `<img class="q-img" src="${q.img}" alt="Hình minh họa câu ${i + 1}" loading="lazy" />` : ""}
              ${q.items.map((it, j) => `
                <div class="tf-row">
                  <span class="tf-text"><span class="tf-idx">${"abcd"[j]})</span> ${esc(it.text)}</span>
                  <div class="tf-btns">
                    <button class="tf-btn true ${st.answers.p2[i] && st.answers.p2[i][j] === true ? "selected" : ""}" data-p2q="${i}" data-p2i="${j}" data-val="1">Đ</button>
                    <button class="tf-btn false ${st.answers.p2[i] && st.answers.p2[i][j] === false ? "selected" : ""}" data-p2q="${i}" data-p2i="${j}" data-val="0">S</button>
                  </div>
                </div>`).join("")}
            </div>`).join("")}
        </div>` : ""}

        ${ex.p3.length ? `
        <div class="exam-part" data-part-block="p3" ${st.activePart !== "p3" ? "hidden" : ""}>
          <div class="section-head"><span class="sh-num">III</span><div><h3>PHẦN III. Trả lời ngắn</h3><p>Mỗi câu đúng được 0,25 điểm. Nhập đáp án vào ô trống.</p></div></div>
          ${ex.p3.map((q, i) => `
            <div class="short-row">
              <p class="q-text"><span class="q-num">Câu ${i + 1}.</span> ${esc(q.q)} <button class="q-report-btn" data-report-part="p3" data-report-idx="${i}" data-report-text="${esc(q.q)}" title="Báo lỗi câu này">🚩</button></p>
              ${q.img ? `<img class="q-img" src="${q.img}" alt="Hình minh họa câu ${i + 1}" loading="lazy" />` : ""}
              <input class="short-input" data-p3="${i}" placeholder="Đáp án…" value="${esc(st.answers.p3[i] || "")}" />
            </div>`).join("")}
        </div>` : ""}
      </div>
    </div>`;

  function partCounts(key) {
    if (key === "p1") return { a: Object.keys(st.answers.p1).length, t: ex.p1.length };
    if (key === "p2") return { a: Object.values(st.answers.p2).reduce((s, o) => s + Object.keys(o).length, 0), t: ex.p2.reduce((s, q) => s + q.items.length, 0) };
    return { a: Object.values(st.answers.p3).filter((v) => String(v || "").trim() !== "").length, t: ex.p3.length };
  }
  function updateTabCounts() {
    $$("[data-part-count]", main).forEach((el) => {
      const { a, t } = partCounts(el.dataset.partCount);
      el.textContent = `(${a}/${t})`;
    });
  }
  updateTabCounts();
  $$("[data-part-tab]", main).forEach((b) =>
    b.addEventListener("click", () => {
      st.activePart = b.dataset.partTab;
      $$("[data-part-tab]", main).forEach((x) => x.classList.toggle("active", x === b));
      $$("[data-part-block]", main).forEach((el) => el.toggleAttribute("hidden", el.dataset.partBlock !== st.activePart));
      window.scrollTo({ top: 0, behavior: "smooth" });
      typesetMath($(`[data-part-block="${st.activePart}"]`, main));
    })
  );

  bindReportButtons(main, ex.id, ex.title, TAKING_ORDER_MAP);

  // Gắn sự kiện chọn đáp án
  $$("[data-p1]", main).forEach((b) =>
    b.addEventListener("click", () => {
      st.answers.p1[b.dataset.p1] = b.dataset.letter;
      $$(`[data-p1="${b.dataset.p1}"]`, main).forEach((x) => x.classList.toggle("selected", x === b));
      updateProgress(); updateTabCounts();
    })
  );
  $$("[data-p2q]", main).forEach((b) =>
    b.addEventListener("click", () => {
      const qi = b.dataset.p2q, ii = b.dataset.p2i;
      if (!st.answers.p2[qi]) st.answers.p2[qi] = {};
      st.answers.p2[qi][ii] = b.dataset.val === "1";
      $$(`[data-p2q="${qi}"][data-p2i="${ii}"]`, main).forEach((x) => x.classList.toggle("selected", x === b));
      updateProgress(); updateTabCounts();
    })
  );
  $$("[data-p3]", main).forEach((inp) =>
    inp.addEventListener("input", () => {
      st.answers.p3[inp.dataset.p3] = inp.value;
      updateProgress(); updateTabCounts();
    })
  );

  $("#exit-btn").addEventListener("click", () =>
    confirmModal("Thoát phòng thi?", "Bài làm hiện tại sẽ không được lưu.", () => go("exams"))
  );
  $("#submit-btn").addEventListener("click", () => {
    const { answered, total } = countProgress();
    confirmModal("Nộp bài thi?", `Bạn đã trả lời ${answered}/${total} ý. Sau khi nộp sẽ không thể sửa bài.`, submitExam);
  });

  // Đồng hồ
  const tick = () => {
    st.left--;
    if (st.left <= 0) { renderClock(0); submitExam(); return; }
    renderClock(st.left);
  };
  renderClock(st.left);
  updateProgress();
  st.timerId = setInterval(tick, 1000);
  typesetMath(main);

  // Chống gian lận: đếm số lần rời khỏi tab/app HOẶC thoát toàn màn hình khi đang làm bài
  st.tabSwitches = st.tabSwitches || 0;
  const antiCheatBadge = $("#anticheat-badge");
  const updateAntiCheatBadge = () => {
    if (st.tabSwitches > 0 && antiCheatBadge) {
      antiCheatBadge.textContent = `⚠️ Vi phạm: ${st.tabSwitches} lần`;
      antiCheatBadge.classList.remove("hidden");
    }
  };
  updateAntiCheatBadge();
  const onVisibilityChange = () => {
    if (document.hidden) {
      st.tabSwitches++;
    } else if (st.tabSwitches > 0) {
      updateAntiCheatBadge();
      toast(`⚠️ Đã ghi nhận bạn rời khỏi bài thi (lần ${st.tabSwitches}). Giáo viên sẽ thấy điều này khi chấm bài.`, true);
    }
  };
  document.addEventListener("visibilitychange", onVisibilityChange);

  // Ép toàn màn hình khi thi + thoát toàn màn hình cũng tính là 1 lần vi phạm
  const fsBanner = $("#fs-reenter-banner");
  const requestExamFullscreen = () => {
    const el = document.documentElement;
    const req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
    if (req) { try { req.call(el); } catch (e) {} }
  };
  requestExamFullscreen();
  let fsWasOn = !!document.fullscreenElement;
  const onFsChange = () => {
    const isFs = !!document.fullscreenElement;
    if (fsWasOn && !isFs && !st.submitted) {
      st.tabSwitches++;
      updateAntiCheatBadge();
      toast(`⚠️ Bạn vừa thoát chế độ toàn màn hình (lần ${st.tabSwitches}). Hành động này được ghi lại.`, true);
      if (fsBanner) fsBanner.classList.remove("hidden");
    } else if (isFs && fsBanner) {
      fsBanner.classList.add("hidden");
    }
    fsWasOn = isFs;
  };
  document.addEventListener("fullscreenchange", onFsChange);
  document.addEventListener("webkitfullscreenchange", onFsChange);
  const fsReenterBtn = $("#fs-reenter-btn");
  if (fsReenterBtn) fsReenterBtn.addEventListener("click", requestExamFullscreen);

  st.__cleanupAntiCheat = () => {
    document.removeEventListener("visibilitychange", onVisibilityChange);
    document.removeEventListener("fullscreenchange", onFsChange);
    document.removeEventListener("webkitfullscreenchange", onFsChange);
    if (document.fullscreenElement) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (exit) { try { exit.call(document); } catch (e) {} }
    }
  };

  function renderClock(sec) {
    const mm = String(Math.floor(sec / 60)).padStart(2, "0");
    const ss = String(sec % 60).padStart(2, "0");
    $("#timer-value").textContent = mm + ":" + ss;
    $("#timerbar").classList.toggle("danger", sec <= 60);
  }
  function countProgress() {
    const answered =
      Object.keys(st.answers.p1).length +
      Object.values(st.answers.p2).reduce((s, o) => s + Object.keys(o).length, 0) +
      Object.values(st.answers.p3).filter((v) => String(v || "").trim() !== "").length;
    const total = ex.p1.length + ex.p2.reduce((s, q) => s + q.items.length, 0) + ex.p3.length;
    return { answered, total };
  }
  function updateProgress() {
    const { answered, total } = countProgress();
    $("#progress-text").textContent = `Đã trả lời ${answered}/${total} ý`;
  }
}

function submitExam() {
  const st = TAKING_STATE;
  if (!st || st.submitted) return;
  st.submitted = true;
  stopTimer();
  closeModal();

  const g = gradeExam(TAKING, st.answers);
  const res = {
    id: "r_" + Date.now(),
    examId: TAKING.id,
    examTitle: TAKING.title,
    username: CURRENT_USER.username,
    name: CURRENT_USER.name,
    raw: g.raw, maxRaw: g.maxRaw, score10: g.score10, detail: g.detail,
    answers: st.answers,
    orderMap: TAKING_ORDER_MAP,
    tabSwitches: st.tabSwitches || 0,
    timeUsed: Math.round((Date.now() - st.start) / 1000),
    date: Date.now(),
  };
  RESULTS.push(res);
  DBX.insert("results", resultToRow(res)).catch((e) => {
    console.error(e);
    toast("Không lưu được kết quả lên máy chủ", true);
  });
  LAST_RESULT = res;
  go("result");
}

/* =====================================================
   KẾT QUẢ
===================================================== */
function renderResult(main) {
  const r = LAST_RESULT;
  if (!r) return go("exams");
  const d = r.detail;
  const mins = Math.floor(r.timeUsed / 60), secs = r.timeUsed % 60;

  const rows = [];
  if (d.p1.total > 0) rows.push(["Phần I — Trắc nghiệm", `${d.p1.correct}/${d.p1.total} câu đúng`, d.p1.score]);
  if (d.p2.perQ.length > 0) rows.push(["Phần II — Đúng/Sai", d.p2.perQ.map((q, i) => `C${i + 1}: ${q.correct}/${q.total} ý`).join(" · "), d.p2.score]);
  if (d.p3.total > 0) rows.push(["Phần III — Trả lời ngắn", `${d.p3.correct}/${d.p3.total} câu đúng`, d.p3.score]);

  main.innerHTML = `
    <div class="card result-card">
      <p class="eyebrow">PHIẾU BÁO ĐIỂM</p>
      <h2 class="page-title" style="font-size:22px;margin-top:4px">${esc(r.examTitle)}</h2>

      <div class="stamp-big"><b id="score-num">0.00</b><span>/ 10 ĐIỂM</span></div>

      <p class="card-meta">Điểm thô: <b style="color:var(--ink)">${r.raw}</b> / ${r.maxRaw} &nbsp;·&nbsp; Thời gian làm bài: ${mins} phút ${secs} giây</p>
      ${r.tabSwitches > 0 ? `<p class="anticheat-note">⚠️ Hệ thống ghi nhận bạn đã rời khỏi bài thi <b>${r.tabSwitches}</b> lần trong lúc làm bài.</p>` : ""}

      <div class="result-table">
        ${rows.map(([t, mid, s]) => `
          <div class="result-row">
            <span class="part">${t}</span>
            <span class="mid">${esc(mid)}</span>
            <span class="pts">${s.toFixed(2)} đ</span>
          </div>`).join("")}
      </div>

      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn btn-outline" id="back-btn">Về danh sách đề</button>
        <button class="btn btn-outline" id="review-btn">📋 Xem lại bài làm</button>
        <button class="btn btn-primary" id="rank-btn">Xem xếp hạng</button>
      </div>
    </div>`;

  $("#back-btn").addEventListener("click", () => go("exams"));
  $("#review-btn").addEventListener("click", () => go("reviewexam", r.id));
  $("#rank-btn").addEventListener("click", () => go("rank"));
  animateCountUp($("#score-num"), r.score10, 700);
}

/* Chạy số mượt từ 0 lên điểm số cuối cùng */
function animateCountUp(el, target, duration) {
  if (!el) return;
  const start = performance.now();
  function tick(now) {
    const p = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
    el.textContent = (target * eased).toFixed(2);
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = target.toFixed(2);
  }
  requestAnimationFrame(tick);
}

/* =====================================================
   XEM LẠI BÀI LÀM
===================================================== */
function reconstructShownExam(ex, orderMap) {
  const LETTERS = ["A", "B", "C", "D"];
  if (!orderMap) return { p1: ex.p1, p2: ex.p2, p3: ex.p3 };
  const p1 = orderMap.p1.map((m) => {
    const q = ex.p1[m.q];
    if (!q) return null;
    const options = m.opt.map((oi) => q.options[oi]);
    const oldAnsIdx = LETTERS.indexOf(q.answer);
    const newAnsIdx = m.opt.indexOf(oldAnsIdx);
    return { ...q, options, answer: LETTERS[Math.max(0, newAnsIdx)] };
  }).filter(Boolean);
  const p2 = orderMap.p2.map((i) => ex.p2[i]).filter(Boolean);
  const p3 = orderMap.p3.map((i) => ex.p3[i]).filter(Boolean);
  return { p1, p2, p3 };
}

function renderReviewExam(main, resultId) {
  const r = RESULTS.find((x) => x.id === resultId);
  if (!r) { main.innerHTML = `<div class="empty">Không tìm thấy lượt thi này.</div>`; return; }
  if (CURRENT_USER.role !== "admin" && CURRENT_USER.username !== r.username) return go("exams");

  const ex = EXAMS.find((e) => e.id === r.examId);
  if (!ex) {
    main.innerHTML = `<div class="empty"><div class="big">🗑</div>Đề thi này đã bị xoá khỏi hệ thống nên không thể xem lại chi tiết.<br/><button class="btn btn-outline" style="margin-top:14px" id="rv-back">← Quay lại</button></div>`;
    $("#rv-back").addEventListener("click", () => go("exams"));
    return;
  }
  if (!r.answers) {
    main.innerHTML = `<div class="empty">Lượt thi này được thực hiện trước khi có tính năng xem lại, nên không có dữ liệu chi tiết.<br/><button class="btn btn-outline" style="margin-top:14px" id="rv-back">← Quay lại</button></div>`;
    $("#rv-back").addEventListener("click", () => go("exams"));
    return;
  }

  const shown = reconstructShownExam(ex, r.orderMap);
  const answers = r.answers;

  let html = `
    <div class="exam-wrap">
      <button class="btn btn-ghost btn-sm" id="rv-back" style="margin-bottom:16px">← Quay lại</button>
      <div class="exam-paper">
        <div class="exam-paper-head">
          <p class="eyebrow">XEM LẠI BÀI LÀM ${r.username !== CURRENT_USER.username ? "· " + esc(r.name) : ""}</p>
          <h2 class="exam-paper-title">${esc(r.examTitle)}</h2>
          <p class="exam-paper-meta">Điểm: <b style="color:var(--red)">${r.score10.toFixed(2)}</b>/10 · Nộp lúc ${new Date(r.date).toLocaleString("vi-VN")}</p>
          ${r.tabSwitches > 0 ? `<p class="anticheat-note">⚠️ Rời khỏi bài thi <b>${r.tabSwitches}</b> lần trong lúc làm bài</p>` : ""}
        </div>`;

  if (shown.p1.length) {
    html += `<div class="section-head"><h3>PHẦN I. Trắc nghiệm nhiều lựa chọn</h3></div>`;
    shown.p1.forEach((q, i) => {
      const picked = answers.p1[i];
      html += `<div class="q"><p class="q-text"><span class="q-num">Câu ${i + 1}.</span> ${esc(q.q)} <button class="q-report-btn" data-report-part="p1" data-report-idx="${i}" data-report-text="${esc(q.q)}" title="Báo lỗi câu này">🚩</button></p>`;
      if (q.img) html += `<img class="q-img" src="${q.img}" alt="" loading="lazy" />`;
      html += `<div class="opts">`;
      q.options.forEach((opt, j) => {
        const letter = "ABCD"[j];
        const isCorrect = letter === q.answer;
        const isPicked = letter === picked;
        let cls = "rv-opt";
        if (isCorrect) cls += " rv-correct";
        else if (isPicked) cls += " rv-wrong";
        html += `<div class="${cls}"><span class="opt-letter">${letter}.</span><span>${esc(opt)}</span>${isPicked ? `<span class="rv-tag">Bạn chọn</span>` : ""}${isCorrect ? `<span class="rv-tag rv-tag-correct">Đáp án</span>` : ""}</div>`;
      });
      html += `</div></div>`;
    });
  }

  if (shown.p2.length) {
    html += `<div class="section-head"><h3>PHẦN II. Trắc nghiệm đúng / sai</h3></div>`;
    shown.p2.forEach((q, i) => {
      html += `<div class="q"><p class="q-text"><span class="q-num">Câu ${i + 1}.</span> ${esc(q.q)} <button class="q-report-btn" data-report-part="p2" data-report-idx="${i}" data-report-text="${esc(q.q)}" title="Báo lỗi câu này">🚩</button></p>`;
      if (q.img) html += `<img class="q-img" src="${q.img}" alt="" loading="lazy" />`;
      q.items.forEach((it, j) => {
        const picked = answers.p2[i] && answers.p2[i][j];
        const isRight = picked === it.answer;
        html += `<div class="tf-row"><span class="tf-text"><span class="tf-idx">${"abcd"[j]})</span> ${esc(it.text)}</span>
          <span class="rv-tf ${picked == null ? "rv-empty" : isRight ? "rv-correct" : "rv-wrong"}">
            ${picked == null ? "Bỏ trống" : "Bạn: " + (picked ? "Đ" : "S")} ${!isRight ? "· Đúng: " + (it.answer ? "Đ" : "S") : "✓"}
          </span></div>`;
      });
      html += `</div>`;
    });
  }

  if (shown.p3.length) {
    html += `<div class="section-head"><h3>PHẦN III. Trả lời ngắn</h3></div>`;
    shown.p3.forEach((q, i) => {
      const picked = answers.p3[i];
      const isRight = normalizeShort(picked) === normalizeShort(q.answer) && normalizeShort(q.answer) !== "";
      html += `<div class="q"><p class="q-text"><span class="q-num">Câu ${i + 1}.</span> ${esc(q.q)} <button class="q-report-btn" data-report-part="p3" data-report-idx="${i}" data-report-text="${esc(q.q)}" title="Báo lỗi câu này">🚩</button></p>`;
      if (q.img) html += `<img class="q-img" src="${q.img}" alt="" loading="lazy" />`;
      html += `<p class="rv-short ${isRight ? "rv-correct" : "rv-wrong"}">Bạn trả lời: <b>${esc(picked || "(bỏ trống)")}</b>${!isRight ? ` · Đáp án đúng: <b>${esc(q.answer)}</b>` : " ✓"}</p></div>`;
    });
  }

  html += `</div></div>`;
  main.innerHTML = html;
  $("#rv-back").addEventListener("click", () => go(r.username === CURRENT_USER.username ? "exams" : "admin", "results"));
  bindReportButtons(main, ex.id, r.examTitle, r.orderMap);
  typesetMath(main);
}

/* =====================================================
   LỊCH SỬ LÀM BÀI & BIỂU ĐỒ TIẾN BỘ (theo từng đề)
===================================================== */
function drawLineChart(container, points, opts) {
  opts = opts || {};
  const w = container.clientWidth || 320, h = opts.height || 130;
  const pad = { l: 30, r: 12, t: 14, b: 22 };
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minY = 0, maxY = 10;
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const sx = (x) => pad.l + (maxX === minX ? 0 : (x - minX) / (maxX - minX)) * (w - pad.l - pad.r);
  const sy = (y) => h - pad.b - ((y - minY) / (maxY - minY)) * (h - pad.t - pad.b);

  const linePts = points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  const gridLines = [0, 2.5, 5, 7.5, 10].map((v) =>
    `<line x1="${pad.l}" y1="${sy(v)}" x2="${w - pad.r}" y2="${sy(v)}" stroke="var(--line)" stroke-width="1" />
     <text x="${pad.l - 6}" y="${sy(v) + 3}" font-size="9" fill="var(--pencil)" text-anchor="end">${v}</text>`
  ).join("");

  const dots = points.map((p, i) =>
    `<circle cx="${sx(p.x)}" cy="${sy(p.y)}" r="3.5" fill="${p.y >= 5 ? "var(--green)" : "var(--red)"}" stroke="#fff" stroke-width="1.5">
       <title>Lần ${i + 1}: ${p.y.toFixed(2)} điểm</title>
     </circle>`
  ).join("");

  container.innerHTML = `
    <svg viewBox="0 0 ${w} ${h}" width="100%" height="${h}" style="display:block">
      ${gridLines}
      <polyline points="${linePts}" fill="none" stroke="var(--pen)" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" />
      ${dots}
    </svg>`;
}

function renderMyAttempts(main, examId) {
  const ex = EXAMS.find((e) => e.id === examId);
  if (!ex) return go("exams");
  const mine = RESULTS.filter((r) => r.examId === examId && r.username === CURRENT_USER.username)
    .sort((a, b) => a.date - b.date);

  main.innerHTML = `
    <div style="max-width:640px;margin:0 auto">
      <button class="btn btn-ghost btn-sm" id="ma-back" style="margin-bottom:16px">← Quay lại đề thi</button>
      <div class="card">
        <p class="eyebrow">LỊCH SỬ LÀM BÀI CỦA BẠN</p>
        <h2 class="page-title" style="font-size:20px;margin:4px 0 16px">${esc(ex.title)}</h2>

        ${mine.length < 2 ? `<p class="hint" style="margin-bottom:16px">Làm ít nhất 2 lần để xem biểu đồ tiến bộ.</p>` : `
          <p style="font-weight:700;color:var(--ink);font-size:13.5px;margin-bottom:6px">📈 Biểu đồ tiến bộ</p>
          <div id="ma-chart" style="margin-bottom:20px"></div>
        `}

        <div class="admin-list">
          ${mine.slice().reverse().map((r) => `
            <div class="admin-row">
              <div class="info">
                <div class="t">${r.score10.toFixed(2)} điểm</div>
                <div class="s">${new Date(r.date).toLocaleString("vi-VN")} · ${Math.floor(r.timeUsed / 60)} phút ${r.timeUsed % 60} giây</div>
              </div>
              <button class="btn btn-outline btn-sm" data-rv="${r.id}">Xem lại</button>
            </div>`).join("")}
        </div>
      </div>
    </div>`;

  $("#ma-back").addEventListener("click", () => go("exams"));
  $$("[data-rv]", main).forEach((b) => b.addEventListener("click", () => go("reviewexam", b.dataset.rv)));
  if (mine.length >= 2) {
    drawLineChart($("#ma-chart"), mine.map((r, i) => ({ x: i + 1, y: r.score10 })));
  }
}

/* =====================================================
   TIẾN ĐỘ HỌC CỦA HỌC SINH (admin xem chi tiết)
===================================================== */
function renderStudentProgress(main, username) {
  if (CURRENT_USER.role !== "admin") return go("exams");
  const stu = USERS.find((u) => u.username === username);
  if (!stu) { main.innerHTML = `<div class="empty">Không tìm thấy học sinh này.</div>`; return; }
  const stuLessons = getVisibleLessonsFor(stu);

  const mine = PROGRESS.filter((p) => p.username === username);
  const watched = new Map(mine.map((p) => [p.lesson_id, +p.created_at]));
  const totalLessons = stuLessons.length;
  const pct = totalLessons ? Math.round((watched.size / totalLessons) * 100) : 0;
  const last = mine.slice().sort((a, b) => (+b.created_at) - (+a.created_at))[0];
  const lastLesson = last ? LESSONS.find((l) => l.id === last.lesson_id) : null;

  const myExamCount = new Set(RESULTS.filter((r) => r.username === username).map((r) => r.examId)).size;
  const myAvg = (() => {
    const rs = RESULTS.filter((r) => r.username === username);
    return rs.length ? (rs.reduce((s, r) => s + r.score10, 0) / rs.length).toFixed(2) : "—";
  })();

  const catOrder = [...LESSON_CATEGORIES, "Khác"];
  const tree = {};
  for (const l of stuLessons) {
    const ch = l.chapter || "Chưa phân chương";
    const c = l.category || "Khác";
    tree[ch] = tree[ch] || {};
    (tree[ch][c] = tree[ch][c] || []).push(l);
  }
  const chapterKeys = orderChapterKeys(tree);

  main.innerHTML = `
    <div style="max-width:720px;margin:0 auto">
      ${stu.restricted ? `<p class="restricted-note">🔒 Tài khoản này đang bị giới hạn quyền xem — thống kê dưới đây chỉ tính trên nội dung được cấp phép.</p>` : ""}
      <button class="btn btn-ghost btn-sm" id="sp-back" style="margin-bottom:16px">← Quay lại Quản trị</button>

      <div class="card" style="margin-bottom:18px">
        <p class="eyebrow">TIẾN ĐỘ HỌC TẬP</p>
        <h2 class="page-title" style="font-size:20px;margin:4px 0 14px">${esc(stu.name)} <span style="font-weight:400;color:var(--pencil);font-size:14px">(${esc(stu.username)})</span></h2>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap">
          <div class="score-stamp" style="width:58px;height:58px;font-size:15px;flex-shrink:0">${pct}%</div>
          <div style="font-size:13.5px;color:var(--pencil);line-height:1.7">
            Đã xem <b style="color:var(--ink)">${watched.size}</b>/${totalLessons} bài giảng
            ${lastLesson ? `· gần nhất: <b style="color:var(--ink)">${esc(lastLesson.title)}</b> — <span title="${formatDateTimeVi(last.created_at)}">${relativeTimeVi(+last.created_at)}</span> <span style="color:var(--pencil)">(${formatDateTimeVi(+last.created_at)})</span>` : "· chưa xem bài nào"}<br/>
            Đã thi <b style="color:var(--ink)">${myExamCount}</b> đề · điểm trung bình <b style="color:var(--red)">${myAvg}</b>
          </div>
        </div>
        ${last && (Date.now() - (+last.created_at)) > 7 * 86400000 ? `<p class="restricted-note" style="margin-top:12px">⚠️ Đã hơn ${Math.floor((Date.now() - (+last.created_at)) / 86400000)} ngày học sinh này chưa xem bài giảng nào mới.</p>` : ""}
      </div>

      ${chapterKeys.length === 0 ? `<div class="empty">Chưa có bài giảng nào trong hệ thống.</div>` : chapterKeys.map((ch) => {
        const catKeys = Object.keys(tree[ch]).sort((a, b) => (catOrder.indexOf(a) === -1 ? 99 : catOrder.indexOf(a)) - (catOrder.indexOf(b) === -1 ? 99 : catOrder.indexOf(b)));
        const chapterLessons = Object.values(tree[ch]).flat();
        const chDone = chapterLessons.filter((l) => watched.has(l.id)).length;
        const chPct = chapterLessons.length ? Math.round((chDone / chapterLessons.length) * 100) : 0;
        return `
        <details class="chapter-block" data-fold="sp:${esc(ch)}" ${foldIsOpen("sp:" + ch, true) ? "open" : ""}>
          <summary class="chapter-head">
            <h3>📁 ${esc(ch)}</h3><span>${chDone}/${chapterLessons.length} đã học <b class="chev">▾</b></span>
            <div class="chapter-progress-bar"><div class="chapter-progress-fill" style="width:${chPct}%"></div></div>
          </summary>
          <div class="chapter-body">
            ${catKeys.map((c) => `
              <div class="cat-head" style="cursor:default">${esc(c)}</div>
              <div class="sp-list">
                ${tree[ch][c].slice().sort((a, b) => naturalVi(a.title, b.title)).map((l) => {
                  const w = watched.get(l.id);
                  return `<div class="sp-row ${w ? "sp-done" : ""}">
                    <span class="sp-check">${w ? "✓" : "○"}</span>
                    <span class="sp-title">${esc(l.title)}</span>
                    <span class="sp-time" ${w ? `title="${formatDateTimeVi(w)}"` : ""}>${w ? relativeTimeVi(w) : "chưa xem"}</span>
                  </div>`;
                }).join("")}
              </div>`).join("")}
          </div>
        </details>`;
      }).join("")}
    </div>`;

  bindFoldMemory(main);
  $("#sp-back").addEventListener("click", () => go("admin", "progress"));
}

/* =====================================================
   GIỚI HẠN QUYỀN XEM THEO TỪNG HỌC SINH (admin)
===================================================== */
function renderStudentAccess(main, username) {
  if (CURRENT_USER.role !== "admin") return go("exams");
  const stu = USERS.find((u) => u.username === username);
  if (!stu) { main.innerHTML = `<div class="empty">Không tìm thấy học sinh này.</div>`; return; }

  const state = {
    restricted: !!stu.restricted,
    exams: new Set(stu.allowed_exams || []),
    lessons: new Set(stu.allowed_lessons || []),
  };

  const tree = buildChapterTree(LESSONS);
  const chapterKeys = orderChapterKeys(tree);

  main.innerHTML = `
    <div style="max-width:640px;margin:0 auto">
      <button class="btn btn-ghost btn-sm" id="sa-back" style="margin-bottom:16px">← Quay lại Quản trị</button>
      <div class="card">
        <p class="eyebrow">GIỚI HẠN QUYỀN XEM</p>
        <h2 class="page-title" style="font-size:20px;margin:4px 0 14px">${esc(stu.name)} <span style="font-weight:400;color:var(--pencil);font-size:14px">(${esc(stu.username)})</span></h2>

        <label class="shuffle-check" style="margin-bottom:18px">
          <input type="checkbox" id="sa-restricted" ${state.restricted ? "checked" : ""} />
          🔒 Bật giới hạn quyền xem cho tài khoản này <span style="font-weight:400;color:var(--pencil)">(nếu tắt, tài khoản này xem được toàn bộ như bình thường)</span>
        </label>

        <div id="sa-body" class="${state.restricted ? "" : "hidden"}">
          <div class="sa-section">
            <div class="sa-section-head">
              <p style="font-weight:800;color:var(--ink)">📝 Đề thi được phép xem</p>
              <span><button class="btn btn-ghost btn-sm" id="sa-exam-all">Chọn hết</button><button class="btn btn-ghost btn-sm" id="sa-exam-none">Bỏ hết</button></span>
            </div>
            <div class="sa-options">
              ${EXAMS.length === 0 ? `<p class="hint">Chưa có đề thi nào.</p>` : EXAMS.map((e) => `
                <label class="sa-opt">
                  <input type="checkbox" data-sa-exam="${e.id}" ${state.exams.has(e.id) ? "checked" : ""} />
                  ${esc(e.title)} <span style="color:var(--pencil)">· ${esc(e.subject)}</span>
                </label>`).join("")}
            </div>
          </div>

          <div class="sa-section">
            <div class="sa-section-head">
              <p style="font-weight:800;color:var(--ink)">🎬 Bài giảng được phép xem</p>
              <span><button class="btn btn-ghost btn-sm" id="sa-lesson-all">Chọn hết</button><button class="btn btn-ghost btn-sm" id="sa-lesson-none">Bỏ hết</button></span>
            </div>
            <div class="sa-options">
              ${chapterKeys.length === 0 ? `<p class="hint">Chưa có bài giảng nào.</p>` : chapterKeys.map((ch) => `
                <p class="sa-chapter-label">📁 ${esc(ch)}</p>
                ${Object.values(tree[ch]).flat().sort((a, b) => naturalVi(a.title, b.title)).map((l) => `
                  <label class="sa-opt sa-opt-indent">
                    <input type="checkbox" data-sa-lesson="${l.id}" ${state.lessons.has(l.id) ? "checked" : ""} />
                    ${esc(l.title)}
                  </label>`).join("")}`).join("")}
            </div>
          </div>
        </div>

        <p id="sa-err" class="error-box hidden" style="margin-top:14px"></p>
        <button class="btn btn-primary" id="sa-save" style="margin-top:14px">💾 Lưu thay đổi</button>
      </div>
    </div>`;

  $("#sa-back").addEventListener("click", () => go("admin", "users"));
  $("#sa-restricted").addEventListener("change", (e) => {
    $("#sa-body").classList.toggle("hidden", !e.target.checked);
  });
  $$("[data-sa-exam]", main).forEach((cb) => cb.addEventListener("change", () => {
    if (cb.checked) state.exams.add(cb.dataset.saExam); else state.exams.delete(cb.dataset.saExam);
  }));
  $$("[data-sa-lesson]", main).forEach((cb) => cb.addEventListener("change", () => {
    if (cb.checked) state.lessons.add(cb.dataset.saLesson); else state.lessons.delete(cb.dataset.saLesson);
  }));
  $("#sa-exam-all").addEventListener("click", () => { $$("[data-sa-exam]", main).forEach((cb) => { cb.checked = true; state.exams.add(cb.dataset.saExam); }); });
  $("#sa-exam-none").addEventListener("click", () => { $$("[data-sa-exam]", main).forEach((cb) => { cb.checked = false; }); state.exams.clear(); });
  $("#sa-lesson-all").addEventListener("click", () => { $$("[data-sa-lesson]", main).forEach((cb) => { cb.checked = true; state.lessons.add(cb.dataset.saLesson); }); });
  $("#sa-lesson-none").addEventListener("click", () => { $$("[data-sa-lesson]", main).forEach((cb) => { cb.checked = false; }); state.lessons.clear(); });

  $("#sa-save").addEventListener("click", async () => {
    const err = $("#sa-err");
    err.classList.add("hidden");
    const restricted = $("#sa-restricted").checked;
    const updated = { ...stu, restricted, allowed_exams: [...state.exams], allowed_lessons: [...state.lessons] };
    const btn = $("#sa-save");
    btn.disabled = true; btn.textContent = "Đang lưu…";
    try {
      await DBX.remove("users", "username", stu.username);
      try { await DBX.insert("users", updated); }
      catch (e1) {
        // CSDL chưa có cột restricted/allowed_exams/allowed_lessons → thử lại không kèm các trường mới
        const fb = { ...updated };
        delete fb.restricted; delete fb.allowed_exams; delete fb.allowed_lessons;
        await DBX.insert("users", fb);
        throw new Error("CSDL chưa có cột lưu giới hạn quyền xem — hãy chạy SQL bổ sung rồi thử lại.");
      }
      const idx = USERS.findIndex((u) => u.username === stu.username);
      if (idx > -1) USERS[idx] = updated;
      if (CURRENT_USER.username === stu.username) CURRENT_USER = updated;
      toast("Đã lưu quyền xem cho " + stu.name);
      go("admin", "users");
    } catch (e) {
      btn.disabled = false; btn.textContent = "💾 Lưu thay đổi";
      err.textContent = e.message;
      err.classList.remove("hidden");
    }
  });
}

/* =====================================================
   BẢNG XẾP HẠNG
===================================================== */
function renderRank(main, examId) { renderRankAsync(main, examId); }
async function renderRankAsync(main, examId) {
  if (examId === undefined) {
    await syncView(main, ["results"]);
    if (VIEW !== "rank") return;
  }
  examId = examId || "all";
  const visibleExams = getVisibleExams();
  const visibleExamIds = new Set(visibleExams.map((e) => e.id));
  if (examId !== "all" && !visibleExamIds.has(examId)) examId = "all"; // đề không thuộc quyền xem → về lại "tất cả"

  const scopedResults = RESULTS.filter((r) => visibleExamIds.has(r.examId));
  const pool = examId === "all" ? scopedResults : scopedResults.filter((r) => r.examId === examId);
  const best = {};
  for (const r of pool) {
    const cur = best[r.username];
    if (!cur || r.score10 > cur.score10 || (r.score10 === cur.score10 && r.timeUsed < cur.timeUsed)) best[r.username] = r;
  }
  const rows = Object.values(best).sort((a, b) => b.score10 - a.score10 || a.timeUsed - b.timeUsed);
  const medal = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : i + 1);

  main.innerHTML = `
    <div class="page-head">
      <div>
        <h2 class="page-title">Bảng xếp hạng</h2>
        <p class="page-sub">Xếp theo điểm cao nhất; bằng điểm thì ai làm nhanh hơn đứng trên.</p>
      </div>
      <select class="select" id="rank-filter">
        <option value="all">Tất cả các đề</option>
        ${visibleExams.map((e) => `<option value="${e.id}" ${e.id === examId ? "selected" : ""}>${esc(e.title)}</option>`).join("")}
      </select>
    </div>

    ${rows.length === 0 ? `
      <div class="empty"><div class="big">🏆</div>Chưa có ai làm bài. Hãy là người đầu tiên trên bảng vàng!</div>
    ` : `
      <div class="rank-table">
        <div class="rank-head"><span>#</span><span>THÍ SINH</span><span style="text-align:right">ĐIỂM</span><span style="text-align:right">THỜI GIAN</span></div>
        ${rows.map((r, i) => `
          <div class="rank-row ${r.username === CURRENT_USER.username ? "me" : ""} ${i === 0 ? "top1" : ""}">
            <span class="rank-pos">${medal(i)}</span>
            <span class="rank-name">
              ${avatarHtml(r.username, r.name, 28)}
              <span class="rank-name-text">${esc(r.name)}${r.username === CURRENT_USER.username ? ' <span style="font-size:11px">(bạn)</span>' : ""}
                ${examId === "all" ? `<span class="rank-exam">${esc(r.examTitle)}</span>` : ""}
              </span>
            </span>
            <span class="rank-score">${r.score10.toFixed(2)}</span>
            <span class="rank-time">${Math.floor(r.timeUsed / 60)}:${String(r.timeUsed % 60).padStart(2, "0")}</span>
          </div>`).join("")}
      </div>
    `}`;

  $("#rank-filter").addEventListener("change", (e) => renderRank(main, e.target.value));
}

/* =====================================================
   BÀI GIẢNG
===================================================== */
const LESSON_CATEGORIES = [
  "Lý thuyết",
  "Bài tập cơ bản",
  "Bài tập thực tế",
  "Vận dụng cao",
  "Chuyên đề",
  "Luyện đề",
  "Ôn tập tổng hợp",
];

function renderLessons(main, filter) { renderLessonsAsync(main, filter); }
async function renderLessonsAsync(main, filter) {
  if (filter === undefined) {
    await syncView(main, ["lessons", "progress"]);
    if (VIEW !== "lessons") return;
  }
  filter = filter || { subject: "all", category: "all", chapter: "all" };
  const visibleLessons = getVisibleLessons();

  /* Tiến độ học của người dùng hiện tại */
  const myProg = PROGRESS
    .filter((p) => p.username === CURRENT_USER.username)
    .sort((a, b) => (+b.created_at || 0) - (+a.created_at || 0));
  const watched = new Set(myProg.map((p) => p.lesson_id));
  const lastEntry = myProg.map((p) => ({ p, l: visibleLessons.find((x) => x.id === p.lesson_id) })).find((x) => x.l);
  const subjects = [...new Set(visibleLessons.map((l) => l.subject))];
  const cats = [...new Set(visibleLessons.map((l) => l.category || "Khác"))];
  const chapters = [...new Set(visibleLessons.map((l) => l.chapter || "Chưa phân chương"))].sort(naturalVi);

  let shown = visibleLessons.filter(
    (l) =>
      (filter.subject === "all" || l.subject === filter.subject) &&
      (filter.category === "all" || (l.category || "Khác") === filter.category) &&
      (filter.chapter === "all" || (l.chapter || "Chưa phân chương") === filter.chapter)
  );

  /* Cấu trúc cây: CHƯƠNG → CHUYÊN MỤC → các bài (sắp Bài 1, Bài 2, … Bài 10 đúng thứ tự) */
  const catOrder = [...LESSON_CATEGORIES, "Khác"];
  const tree = {};
  for (const l of shown) {
    const ch = l.chapter || "Chưa phân chương";
    const c = l.category || "Khác";
    tree[ch] = tree[ch] || {};
    (tree[ch][c] = tree[ch][c] || []).push(l);
  }
  const chapterKeys = orderChapterKeys(tree);
  for (const ch of chapterKeys) {
    for (const c of Object.keys(tree[ch])) {
      tree[ch][c].sort((a, b) => naturalVi(a.title, b.title));
    }
  }
  const catKeysOf = (ch) =>
    Object.keys(tree[ch]).sort(
      (a, b) => (catOrder.indexOf(a) === -1 ? 99 : catOrder.indexOf(a)) - (catOrder.indexOf(b) === -1 ? 99 : catOrder.indexOf(b))
    );

  const lessonCard = (ls, idx) => `
    <div class="card hoverable lesson-card ${watched.has(ls.id) ? "is-watched" : ""}" data-lesson="${ls.id}" style="cursor:pointer">
      <div class="thumb">
        ${lessonThumb(ls) ? `<img src="${lessonThumb(ls)}" alt="" loading="lazy" onerror="this.remove()" />` : ""}
        <div class="play-badge">▶</div>
        <span class="thumb-order">${idx + 1}</span>
        ${watched.has(ls.id) ? `<span class="watched-badge">✓ Đã xem</span>` : ""}
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <span class="chip chip-gold">${esc(ls.subject)}</span>
      </div>
      <h3 class="card-title">${esc(ls.title)}</h3>
      <p class="card-meta">Đăng bởi ${esc(ls.uploader)} · ${new Date(ls.createdAt).toLocaleDateString("vi-VN")}</p>
      <p class="doc-count" style="margin-top:8px">📎 ${ls.docs.length} tài liệu đính kèm</p>
    </div>`;

  main.innerHTML = `
    <div class="page-head">
      <div>
        <h2 class="page-title">Bài giảng</h2>
        <p class="page-sub">Học theo lộ trình: mỗi chương chia thành các chuyên mục, trong mỗi mục là các bài xếp đúng thứ tự.</p>
      </div>
      ${CURRENT_USER.role === "admin" ? `
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-outline" id="order-chapters-btn">🔀 Sắp xếp &amp; khoá chương</button>
          <button class="btn btn-primary" id="add-lesson-btn">+ Thêm bài giảng</button>
        </div>` : ""}
    </div>

    ${visibleLessons.length > 0 ? `
      <div class="filter-row">
        <select class="select" id="filter-subject">
          <option value="all">Tất cả môn học</option>
          ${subjects.map((s) => `<option value="${esc(s)}" ${filter.subject === s ? "selected" : ""}>${esc(s)}</option>`).join("")}
        </select>
        <select class="select" id="filter-chapter">
          <option value="all">Tất cả các chương</option>
          ${chapters.map((c) => `<option value="${esc(c)}" ${filter.chapter === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
        </select>
        <select class="select" id="filter-category">
          <option value="all">Tất cả chuyên mục</option>
          ${cats.map((c) => `<option value="${esc(c)}" ${filter.category === c ? "selected" : ""}>${esc(c)}</option>`).join("")}
        </select>
      </div>
    ` : ""}

    ${lastEntry ? `
      <div class="continue-banner" data-continue="${lastEntry.l.id}">
        <div class="cb-icon">🕐</div>
        <div class="cb-info">
          <p class="cb-label">Học gần nhất · ${new Date(+lastEntry.p.created_at).toLocaleString("vi-VN")}</p>
          <p class="cb-title">${esc(lastEntry.l.title)}</p>
        </div>
        <span class="btn btn-primary btn-sm">Tiếp tục học ▸</span>
      </div>
    ` : ""}

    ${myProg.length > 1 ? `
      <details class="history-fold" data-fold="history" ${foldIsOpen("history", false) ? "open" : ""}>
        <summary>📜 Lịch sử học gần đây <span>· ${watched.size} video đã xem</span><b class="chev">▾</b></summary>
        <div class="history-list">
          ${myProg.slice(0, 8).map((p) => {
            const l = LESSONS.find((x) => x.id === p.lesson_id);
            return l ? `<button class="part-link" data-continue="${l.id}">▶ ${esc(l.title)} <span style="color:var(--pencil);font-weight:400;font-size:12px">· ${new Date(+p.created_at).toLocaleDateString("vi-VN")}</span></button>` : "";
          }).join("")}
        </div>
      </details>
    ` : ""}

    ${visibleLessons.length === 0 ? `
      <div class="empty"><div class="big">🎬</div>Chưa có bài giảng nào.${CURRENT_USER.role === "admin" ? " Bấm <b>+ Thêm bài giảng</b> để đăng video và tài liệu đầu tiên." : " Hãy quay lại sau nhé!"}</div>
    ` : shown.length === 0 ? `
      <div class="empty"><div class="big">🔍</div>Không có bài giảng nào khớp bộ lọc.</div>
    ` : (() => {
      const lockMap = CURRENT_USER.role === "admin" ? {} : getChapterLockStatusMap();
      return chapterKeys.map((ch, chIdx) => {
        const s = lockMap[ch];
        const ownLock = getChapterLock(ch); // dùng để hiện nhãn cho admin, bất kể cascade
        if (s && s.locked) {
          const done = s.requireExamIds.filter((id) => RESULTS.some((r) => r.username === CURRENT_USER.username && r.examId === id)).length;
          return `
          <div class="chapter-block chapter-locked">
            <div class="chapter-head chapter-head-locked">
              <h3>🔒 ${esc(ch)}</h3>
              <span>Đã khoá</span>
            </div>
            <div class="chapter-locked-body">
              <p>🔒 ${s.gateChapter !== ch ? `Chương này bị khoá cùng "<b>${esc(s.gateChapter)}</b>" — ` : ""}Hoàn thành ${done}/${s.requireExamIds.length} đề sau để mở khoá:</p>
              <div class="lock-checklist">
                ${s.requireExamIds.map((id, i) => {
                  const okDone = RESULTS.some((r) => r.username === CURRENT_USER.username && r.examId === id);
                  return `<div class="lock-check-row ${okDone ? "lock-check-done" : ""}"><span class="lock-check-mark">${okDone ? "✓" : "○"}</span> ${esc(s.examTitles[i])}</div>`;
                }).join("")}
              </div>
              <button class="btn btn-outline btn-sm" style="margin-top:10px" data-goto-exam="1">Vào làm đề ngay ▸</button>
            </div>
          </div>`;
        }
        return `
        <details class="chapter-block" data-fold="ch:${esc(ch)}" ${foldIsOpen("ch:" + ch, chIdx === 0) ? "open" : ""}>
          <summary class="chapter-head">
            <h3>📁 ${esc(ch)}${CURRENT_USER.role === "admin" && ownLock ? ` <span class="chip chip-gold" style="vertical-align:2px">🔓 cần ${ownLock.examTitles.length} đề</span>` : ""}</h3>
            <span>${(() => { const all = Object.values(tree[ch]).flat(); const d = all.filter((x) => watched.has(x.id)).length; return d + "/" + all.length + " đã học"; })()} <b class="chev">▾</b></span>
            <div class="chapter-progress-bar">${(() => { const all = Object.values(tree[ch]).flat(); const d = all.filter((x) => watched.has(x.id)).length; const p = all.length ? Math.round((d / all.length) * 100) : 0; return `<div class="chapter-progress-fill" style="width:${p}%"></div>`; })()}</div>
          </summary>
          <div class="chapter-body">
            ${catKeysOf(ch).map((c) => `
              <details class="cat-fold" data-fold="cat:${esc(ch)}|${esc(c)}" ${foldIsOpen("cat:" + ch + "|" + c, true) ? "open" : ""}>
                <summary class="cat-head">${esc(c)} <span>· ${tree[ch][c].length} video</span><b class="chev">▾</b></summary>
                <div class="cat-body">${renderCategoryUnits(tree[ch][c], lessonCard, ch + "|" + c)}</div>
              </details>`).join("")}
          </div>
        </details>`;
      }).join("");
    })()}`;

  const addBtn = $("#add-lesson-btn");
  if (addBtn) addBtn.addEventListener("click", () => go("upload"));
  const orderBtn = $("#order-chapters-btn");
  if (orderBtn) orderBtn.addEventListener("click", () => go("orderchapters"));
  $$("[data-lesson]", main).forEach((c) =>
    c.addEventListener("click", () => go("lesson", c.dataset.lesson))
  );
  $$("[data-continue]", main).forEach((c) =>
    c.addEventListener("click", () => go("lesson", c.dataset.continue))
  );
  $$("[data-goto-exam]", main).forEach((c) =>
    c.addEventListener("click", () => go("exams"))
  );
  bindFoldMemory(main);
  const fSub = $("#filter-subject"), fCat = $("#filter-category"), fCh = $("#filter-chapter");
  const refilter = () => renderLessons(main, { subject: fSub.value, category: fCat.value, chapter: fCh.value });
  if (fSub) { fSub.addEventListener("change", refilter); fCat.addEventListener("change", refilter); fCh.addEventListener("change", refilter); }
}

/* =====================================================
   SẮP XẾP CHƯƠNG (kéo-thả — chỉ admin)
===================================================== */
function renderOrderChapters(main) {
  if (CURRENT_USER.role !== "admin") return go("lessons");

  // Danh sách chương thực tế hiện có, khởi điểm theo thứ tự đang hiển thị (đã gộp CHAPTER_ORDER + ngày đăng)
  const tree = {};
  for (const l of LESSONS) {
    const ch = l.chapter || "Chưa phân chương";
    tree[ch] = tree[ch] || {};
    (tree[ch][l.category || "Khác"] = tree[ch][l.category || "Khác"] || []).push(l);
  }
  let orderArr = orderChapterKeys(tree).filter((ch) => ch !== "Chưa phân chương");
  const locksMap = {}; // { chapterName: [examId, examId, ...] }
  for (const ch of orderArr) {
    const cfg = CHAPTER_LOCKS[ch];
    if (!cfg) continue;
    const ids = cfg.requireExamIds || (cfg.requireExamId ? [cfg.requireExamId] : []);
    if (ids.length) locksMap[ch] = ids.slice();
  }

  main.innerHTML = `
    <div style="max-width:560px;margin:0 auto">
      <button class="btn btn-ghost btn-sm" id="oc-back" style="margin-bottom:16px">← Quay lại Bài giảng</button>
      <div class="card">
        <h2 class="page-title" style="font-size:20px;margin-bottom:4px">🔀 Sắp xếp &amp; khoá chương</h2>
        <p class="card-meta" style="margin-bottom:16px">Kéo ☰ hoặc dùng ▲▼ để đổi vị trí. Tick chọn 1 hoặc nhiều đề ở mục 🔒 — chương chỉ mở khi làm xong <b>tất cả</b> đề đã tick, và khoá này sẽ áp dụng luôn cho <b>các chương phía sau</b> cho tới khi đủ điều kiện. Nhớ bấm <b>Lưu thay đổi</b> khi xong.</p>
        ${orderArr.length === 0 ? `<p class="hint">Chưa có chương nào để sắp xếp.</p>` : `<div class="oc-list" id="oc-list"></div>`}
        <p id="oc-msg" class="success-box hidden" style="margin-top:14px"></p>
        <button class="btn btn-primary" id="oc-save" style="margin-top:14px" ${orderArr.length === 0 ? "disabled" : ""}>💾 Lưu thay đổi</button>
      </div>
    </div>`;

  $("#oc-back").addEventListener("click", () => go("lessons"));
  if (orderArr.length === 0) return;

  const listEl = $("#oc-list");
  const renderRows = () => {
    listEl.innerHTML = orderArr.map((ch, i) => {
      const picked = locksMap[ch] || [];
      return `
      <div class="oc-row" data-ch="${esc(ch)}">
        <div class="oc-row-top">
          <span class="oc-handle" title="Kéo để sắp xếp">☰</span>
          <span class="oc-name">${esc(ch)}</span>
          <span class="oc-btns">
            <button class="oc-arrow" data-up="${i}" ${i === 0 ? "disabled" : ""} title="Lên">▲</button>
            <button class="oc-arrow" data-down="${i}" ${i === orderArr.length - 1 ? "disabled" : ""} title="Xuống">▼</button>
          </span>
        </div>
        <details class="oc-lock-fold">
          <summary>🔒 ${picked.length ? `Cần ${picked.length} đề` : "Không khoá"} <b class="chev">▾</b></summary>
          <div class="oc-lock-options">
            ${EXAMS.length === 0 ? `<p class="hint">Chưa có đề thi nào trong hệ thống.</p>` : EXAMS.map((e) => `
              <label class="oc-lock-opt">
                <input type="checkbox" data-lock-ch="${esc(ch)}" data-lock-exam="${e.id}" ${picked.includes(e.id) ? "checked" : ""} />
                ${esc(e.title)}
              </label>`).join("")}
          </div>
        </details>
      </div>`;
    }).join("");
    $$("[data-up]", listEl).forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.up;
      [orderArr[i - 1], orderArr[i]] = [orderArr[i], orderArr[i - 1]];
      renderRows();
    }));
    $$("[data-down]", listEl).forEach((b) => b.addEventListener("click", () => {
      const i = +b.dataset.down;
      [orderArr[i], orderArr[i + 1]] = [orderArr[i + 1], orderArr[i]];
      renderRows();
    }));
    $$("[data-lock-exam]", listEl).forEach((cb) => cb.addEventListener("change", () => {
      const ch = cb.dataset.lockCh, examId = cb.dataset.lockExam;
      const cur = new Set(locksMap[ch] || []);
      if (cb.checked) cur.add(examId); else cur.delete(examId);
      if (cur.size) locksMap[ch] = [...cur]; else delete locksMap[ch];
      const summary = cb.closest(".oc-lock-fold").querySelector("summary");
      const n = (locksMap[ch] || []).length;
      summary.innerHTML = `🔒 ${n ? `Cần ${n} đề` : "Không khoá"} <b class="chev">▾</b>`;
    }));
  };
  renderRows();

  /* Kéo-thả bằng Pointer Events — chạy được cả chuột lẫn cảm ứng trên điện thoại */
  let dragEl = null, placeholder = null;
  listEl.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".oc-handle");
    if (!handle) return;
    const row = handle.closest(".oc-row");
    if (!row) return;
    e.preventDefault();
    dragEl = row;
    try { dragEl.setPointerCapture(e.pointerId); } catch (err) {}
    dragEl.classList.add("oc-dragging");
    placeholder = document.createElement("div");
    placeholder.className = "oc-placeholder";
    placeholder.style.height = row.offsetHeight + "px";
    row.after(placeholder);
    document.body.style.userSelect = "none";
  });
  listEl.addEventListener("pointermove", (e) => {
    if (!dragEl) return;
    const rect = listEl.getBoundingClientRect();
    const y = Math.max(rect.top, Math.min(rect.bottom, e.clientY));
    dragEl.style.transform = `translateY(${y - (dragEl.__startY || (dragEl.__startY = y))}px)`;
    const rows = $$(".oc-row:not(.oc-dragging)", listEl);
    for (const r of rows) {
      const rr = r.getBoundingClientRect();
      const mid = rr.top + rr.height / 2;
      if (y < mid) { listEl.insertBefore(placeholder, r); break; }
      if (r === rows[rows.length - 1]) listEl.insertBefore(placeholder, r.nextSibling);
    }
  });
  const endDrag = (e) => {
    if (!dragEl) return;
    try { dragEl.releasePointerCapture(e.pointerId); } catch (err) {}
    placeholder.replaceWith(dragEl);
    dragEl.style.transform = "";
    dragEl.__startY = null;
    dragEl.classList.remove("oc-dragging");
    document.body.style.userSelect = "";
    orderArr = $$(".oc-row", listEl).map((r) => r.dataset.ch);
    dragEl = null;
    renderRows();
  };
  listEl.addEventListener("pointerup", endDrag);
  listEl.addEventListener("pointercancel", endDrag);

  $("#oc-save").addEventListener("click", async () => {
    const btn = $("#oc-save");
    btn.disabled = true; btn.textContent = "Đang lưu…";
    try {
      const locksObj = {};
      for (const ch of Object.keys(locksMap)) locksObj[ch] = { requireExamIds: locksMap[ch] };
      const rows = [
        { key: "chapter_order", value: orderArr, updated_at: Date.now() },
        { key: "chapter_locks", value: locksObj, updated_at: Date.now() },
      ];
      for (const row of rows) {
        try { await DBX.remove("settings", "key", row.key); } catch (e0) { /* chưa có dòng cũ, bỏ qua */ }
        await DBX.insert("settings", row);
      }
      CHAPTER_ORDER = orderArr;
      CHAPTER_LOCKS = locksObj;
      $("#oc-msg").textContent = "✓ Đã lưu thứ tự và khoá chương!";
      $("#oc-msg").classList.remove("hidden");
      toast("Đã lưu thay đổi");
    } catch (e) {
      toast("Không lưu được: " + e.message + " — kiểm tra đã tạo bảng settings chưa", true);
    }
    btn.disabled = false; btn.textContent = "💾 Lưu thay đổi";
  });
}

/* ---------- Nhớ trạng thái đóng/mở thư mục bài giảng ---------- */
function foldsKey() { return "ptt_folds_" + (CURRENT_USER ? CURRENT_USER.username : ""); }
function getFolds() {
  try { return JSON.parse(localStorage.getItem(foldsKey()) || "{}"); } catch (e) { return {}; }
}
function foldIsOpen(id, def) {
  const f = getFolds();
  return id in f ? !!f[id] : def;
}
function bindFoldMemory(root) {
  $$("details[data-fold]", root).forEach((d) =>
    d.addEventListener("toggle", () => {
      const f = getFolds();
      f[d.dataset.fold] = d.open;
      try { localStorage.setItem(foldsKey(), JSON.stringify(f)); } catch (e) {}
    })
  );
}

/* So sánh "tự nhiên" tiếng Việt: Bài 2 đứng trước Bài 10, Chương 1 trước Chương 2 */
/* Thời gian chi tiết: "5 phút trước", "3 giờ trước"... kèm ngày giờ đầy đủ khi đã lâu */
function relativeTimeVi(ts) {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000), hr = Math.floor(diff / 3600000), day = Math.floor(diff / 86400000);
  if (diff < 0 || min < 1) return "vừa xong";
  if (min < 60) return `${min} phút trước`;
  if (hr < 24) return `${hr} giờ trước`;
  if (day < 7) return `${day} ngày trước`;
  return formatDateTimeVi(ts);
}
function formatDateTimeVi(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString("vi-VN") + " lúc " + d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" });
}

function naturalVi(a, b) {
  return String(a).localeCompare(String(b), "vi", { numeric: true, sensitivity: "base" });
}

/* Thời điểm đăng bài SỚM NHẤT trong một chương — dùng để xếp chương
   theo đúng thứ tự bạn đã đăng (không xếp theo alphabet), có cache
   nhỏ trong chính object `tree` để không tính lại nhiều lần. */
function chapterFirstPostTime(tree, ch) {
  if (!tree.__firstPost) tree.__firstPost = {};
  if (tree.__firstPost[ch] != null) return tree.__firstPost[ch];
  const all = Object.values(tree[ch]).flat();
  const t = all.length ? Math.min(...all.map((l) => l.createdAt || 0)) : 0;
  tree.__firstPost[ch] = t;
  return t;
}

/* Xếp thứ tự chương để hiển thị:
   1) Chương nào admin đã tự sắp tay (CHAPTER_ORDER) → theo đúng thứ tự đó
   2) Chương mới chưa được sắp → xếp theo ngày đăng bài đầu tiên, nối vào cuối
   3) "Chưa phân chương" luôn ở cuối cùng */
function orderChapterKeys(tree) {
  const all = Object.keys(tree).filter((k) => k !== "__firstPost");
  const real = all.filter((ch) => ch !== "Chưa phân chương");
  const known = CHAPTER_ORDER.filter((ch) => real.includes(ch));
  const rest = real.filter((ch) => !known.includes(ch)).sort((a, b) => chapterFirstPostTime(tree, a) - chapterFirstPostTime(tree, b));
  const ordered = [...known, ...rest];
  if (all.includes("Chưa phân chương")) ordered.push("Chưa phân chương");
  return ordered;
}

/* Chương có đang bị khoá theo điều kiện "phải làm xong các đề X, Y, Z" không?
   Trả về null nếu chương không có khoá (hoặc tất cả đề khoá đã bị xoá).
   Tương thích ngược với dữ liệu cũ chỉ có requireExamId (1 đề). */
function getChapterLock(chapterName) {
  const cfg = CHAPTER_LOCKS[chapterName];
  if (!cfg) return null;
  const ids = cfg.requireExamIds || (cfg.requireExamId ? [cfg.requireExamId] : []);
  if (!ids.length) return null;
  const exams = ids.map((id) => EXAMS.find((e) => e.id === id)).filter(Boolean);
  if (!exams.length) return null; // các đề làm điều kiện đều đã bị xoá → coi như không khoá nữa
  return { requireExamIds: exams.map((e) => e.id), examTitles: exams.map((e) => e.title) };
}

/* Đã hoàn thành đủ danh sách đề yêu cầu chưa? Admin luôn coi như đã đủ. */
function isLockSatisfied(requireExamIds) {
  if (!requireExamIds || requireExamIds.length === 0) return true;
  if (!CURRENT_USER || CURRENT_USER.role === "admin") return true;
  return requireExamIds.every((id) => RESULTS.some((r) => r.username === CURRENT_USER.username && r.examId === id));
}

function buildChapterTree(lessonsArr) {
  const tree = {};
  for (const l of lessonsArr || LESSONS) {
    const ch = l.chapter || "Chưa phân chương";
    tree[ch] = tree[ch] || {};
    (tree[ch][l.category || "Khác"] = tree[ch][l.category || "Khác"] || []).push(l);
  }
  return tree;
}

/* ---------- Giới hạn quyền xem theo từng tài khoản ----------
   Mặc định (restricted=false hoặc chưa set): xem toàn bộ như cũ.
   Khi admin bật restricted=true cho 1 tài khoản, họ CHỈ thấy đúng
   những đề/bài giảng nằm trong allowed_exams / allowed_lessons. */
function getVisibleExamsFor(u) {
  if (!u || u.role === "admin" || !u.restricted) return EXAMS;
  const allowed = new Set(u.allowed_exams || []);
  return EXAMS.filter((e) => allowed.has(e.id));
}
function getVisibleLessonsFor(u) {
  if (!u || u.role === "admin" || !u.restricted) return LESSONS;
  const allowed = new Set(u.allowed_lessons || []);
  return LESSONS.filter((l) => allowed.has(l.id));
}
function getVisibleExams() { return getVisibleExamsFor(CURRENT_USER); }
function getVisibleLessons() { return getVisibleLessonsFor(CURRENT_USER); }

/* Tính trạng thái khoá cho TẤT CẢ chương theo đúng thứ tự hiển thị.
   Cơ chế "cổng chặn": chương đầu tiên có khoá chưa thoả sẽ khoá luôn
   CHÍNH nó và MỌI chương phía sau, cho tới khi đủ điều kiện thì gỡ.
   Nếu chương phía sau có thêm khoá riêng (một cổng chặn mới), nó sẽ
   tiếp tục khoá các chương sau nó nữa — cho phép nhiều "chốt" nối tiếp. */
function getChapterLockStatusMap(lessonsArr) {
  const tree = buildChapterTree(lessonsArr);
  const orderedReal = orderChapterKeys(tree).filter((ch) => ch !== "Chưa phân chương");
  const status = {};
  let activeGate = null;
  for (const ch of orderedReal) {
    if (!activeGate) {
      const ownLock = getChapterLock(ch);
      if (ownLock && !isLockSatisfied(ownLock.requireExamIds)) activeGate = { ...ownLock, gateChapter: ch };
    }
    status[ch] = activeGate ? { locked: true, ...activeGate } : { locked: false };
  }
  return status;
}

/* Chương này người dùng hiện tại có xem được không? Admin luôn xem được hết. */
function isChapterUnlockedForMe(chapterName) {
  if (!CURRENT_USER || CURRENT_USER.role === "admin") return true;
  if (!chapterName || chapterName === "Chưa phân chương") return true;
  const s = getChapterLockStatusMap(getVisibleLessons())[chapterName];
  return !s || !s.locked;
}

/* Trong một chuyên mục: gom các video theo "Bài".
   - Video có trường lesson (vd "Bài 1 — Cực trị") → gộp chung dưới tiêu đề bài, các Phần xếp thứ tự
   - Video không có lesson → đứng độc lập như một bài đơn
   - Bài đơn và bài nhiều phần xen kẽ đúng thứ tự số (Bài 1, Bài 2, … Bài 10) */
function renderCategoryUnits(list, lessonCard, foldPrefix) {
  const groupMap = {};
  const singles = [];
  for (const l of list) {
    if (l.lesson) (groupMap[l.lesson] = groupMap[l.lesson] || []).push(l);
    else singles.push(l);
  }
  const units = [
    ...Object.entries(groupMap).map(([name, items]) => ({
      name, group: true,
      items: items.sort((a, b) => naturalVi(a.title, b.title)),
    })),
    ...singles.map((l) => ({ name: l.title, group: false, items: [l] })),
  ].sort((a, b) => naturalVi(a.name, b.name));

  let html = "";
  let buf = [];
  const flushBuf = () => {
    if (!buf.length) return;
    html += `<div class="grid grid-3" style="margin-bottom:18px">${buf.map((l, i) => lessonCard(l, i)).join("")}</div>`;
    buf = [];
  };
  for (const u of units) {
    if (u.group) {
      flushBuf();
      const fid = "ls:" + (foldPrefix || "") + "|" + u.name;
      html += `
        <details class="lesson-fold" data-fold="${esc(fid)}" ${foldIsOpen(fid, false) ? "open" : ""}>
          <summary class="lesson-head">📖 ${esc(u.name)} <span>· ${u.items.length} phần</span><b class="chev">▾</b></summary>
          <div class="grid grid-3" style="margin:12px 0 6px">
            ${u.items.map((l, i) => lessonCard(l, i)).join("")}
          </div>
        </details>`;
    } else {
      buf.push(u.items[0]);
    }
  }
  flushBuf();
  return html;
}

function renderLessonDetail(main, id) {
  const ls = LESSONS.find((l) => l.id === id);
  if (!ls) return go("lessons");
  if (!getVisibleLessons().some((l) => l.id === id)) return go("lessons");
  if (!isChapterUnlockedForMe(ls.chapter || "")) {
    toast("Chương này đang bị khoá — hãy hoàn thành đề yêu cầu trước.", true);
    return go("lessons");
  }
  recordProgress(ls.id);

  let player = "";
  if (ls.videoType === "youtube") {
    player = `<iframe src="${ls.videoUrl}" title="${esc(ls.title)}" allowfullscreen webkitallowfullscreen mozallowfullscreen allow="fullscreen; accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"></iframe>`;
  } else if (ls.videoType === "url") {
    player = `<video controls src="${ls.videoUrl}"></video>`;
  } else if (ls.videoType === "file") {
    player = `<video controls src="${ls.videoData}"></video>`;
  } else {
    player = `<div style="color:#fff;display:flex;align-items:center;justify-content:center;height:100%">Bài giảng này chưa có video</div>`;
  }

  main.innerHTML = `
    <div class="lesson-detail">
      <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
        <button class="btn btn-ghost btn-sm" id="back-lessons">← Danh sách bài giảng</button>
        ${(CURRENT_USER.role === "admin" || CURRENT_USER.username === ls.uploader) ? `<button class="btn btn-outline btn-sm" id="edit-lesson-btn">✏️ Sửa bài giảng</button>` : ""}
      </div>
      <div class="video-frame" id="video-frame">${player}</div>
      <div style="display:flex;justify-content:flex-end;margin-top:10px">
        <button class="btn btn-outline btn-sm" id="fs-btn">⛶ Xem ngang toàn màn hình</button>
      </div>
      <div class="lesson-body">
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <span class="chip chip-gold">${esc(ls.subject)}</span>
          ${ls.category ? `<span class="chip chip-pen">${esc(ls.category)}</span>` : ""}
          ${ls.chapter ? `<span class="chip chip-green">${esc(ls.chapter)}</span>` : ""}
          ${ls.lesson ? `<span class="chip chip-pen">📖 ${esc(ls.lesson)}</span>` : ""}
        </div>
        <h2 class="page-title" style="margin-top:8px">${esc(ls.title)}</h2>
        <p class="card-meta">Đăng bởi ${esc(ls.uploader)} · ${new Date(ls.createdAt).toLocaleDateString("vi-VN")}</p>
        ${(() => {
          if (!ls.lesson) return "";
          const parts = LESSONS
            .filter((x) => x.id !== ls.id && x.lesson === ls.lesson && (x.chapter || "") === (ls.chapter || "") && (x.category || "") === (ls.category || ""))
            .sort((a, b) => naturalVi(a.title, b.title));
          if (!parts.length) return "";
          return `
            <div class="parts-box">
              <p class="parts-title">Các phần khác trong ${esc(ls.lesson)}:</p>
              ${parts.map((p) => `<button class="part-link" data-goto-part="${p.id}">▶ ${esc(p.title)}</button>`).join("")}
            </div>`;
        })()}
        ${ls.description ? `<p class="lesson-desc">${esc(ls.description)}</p>` : ""}

        <h3 style="font-family:var(--font-display);color:var(--ink);margin-top:26px;font-size:18px">Tài liệu bài giảng</h3>
        ${ls.docs.length === 0 ? `<p class="card-meta" style="margin-top:8px">Chưa có tài liệu đính kèm.</p>` : `
          <div class="doc-list">
            ${ls.docs.map((d) => d.link ? `
              <a class="doc-item" href="${esc(d.link)}" target="_blank" rel="noopener">
                <div class="doc-icon" style="background:var(--pen-soft);color:var(--pen)">🔗</div>
                <div>
                  <div class="doc-name">${esc(d.name)}</div>
                  <div class="doc-size">Link ngoài · bấm để mở</div>
                </div>
              </a>` : `
              <a class="doc-item" href="${d.data}" download="${esc(d.name)}">
                <div class="doc-icon">${esc(extOf(d.name))}</div>
                <div>
                  <div class="doc-name">${esc(d.name)}</div>
                  <div class="doc-size">${DB.formatSize(d.size)} · bấm để tải về</div>
                </div>
              </a>`).join("")}
          </div>
        `}

        <h3 style="font-family:var(--font-display);color:var(--ink);margin-top:26px;font-size:18px">💬 Bình luận</h3>
        <div class="comment-compose">
          <textarea id="comment-input" rows="2" placeholder="Viết bình luận hoặc hỏi đáp về bài giảng này…"></textarea>
          <button class="btn btn-primary btn-sm" id="comment-send">Gửi</button>
        </div>
        <div id="comments-box" class="comment-list"><p class="hint">Đang tải bình luận…</p></div>
      </div>
    </div>`;

  $("#back-lessons").addEventListener("click", () => go("lessons"));
  const editBtn = $("#edit-lesson-btn");
  if (editBtn) editBtn.addEventListener("click", () => go("editlesson", ls.id));

  // Toàn màn hình + tự xoay ngang
  const fsBtn = $("#fs-btn");
  if (fsBtn) fsBtn.addEventListener("click", async () => {
    const frame = $("#video-frame");
    try {
      if (frame.requestFullscreen) await frame.requestFullscreen();
      else if (frame.webkitRequestFullscreen) frame.webkitRequestFullscreen();
      if (screen.orientation && screen.orientation.lock) {
        screen.orientation.lock("landscape").catch(() => {}); // máy nào không hỗ trợ thì bỏ qua
      }
    } catch (e) { toast("Trình duyệt không cho phép toàn màn hình", true); }
  });
  if (!window.__fsUnlockBound) {
    window.__fsUnlockBound = true;
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement && screen.orientation && screen.orientation.unlock) {
        try { screen.orientation.unlock(); } catch (e) {}
      }
    });
  }
  $$("[data-goto-part]", main).forEach((b) =>
    b.addEventListener("click", () => go("lesson", b.dataset.gotoPart))
  );

  // Bình luận
  loadComments(ls.id, $("#comments-box"));
  $("#comment-send").addEventListener("click", () => submitComment(ls.id, $("#comments-box")));
  $("#comment-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submitComment(ls.id, $("#comments-box"));
  });
}

/* =====================================================
   BÌNH LUẬN BÀI GIẢNG
===================================================== */
function commentAvatarColor(name) {
  const palette = ["#2946C8", "#C8232C", "#1E7B45", "#B98A1D", "#8B5CF6", "#0E7490"];
  let h = 0;
  for (const c of String(name)) h = (h * 31 + c.charCodeAt(0)) % palette.length;
  return palette[h];
}

/* Trả về HTML avatar: ảnh thật nếu tài khoản đã tải ảnh đại diện, ngược lại là vòng tròn chữ cái đầu tên */
function avatarHtml(username, name, size) {
  size = size || 32;
  const u = USERS.find((x) => x.username === username);
  if (u && u.avatar) {
    return `<img src="${u.avatar}" class="avatar-img" style="width:${size}px;height:${size}px" alt="" />`;
  }
  const initial = esc((name || username || "?").trim()[0] || "?").toUpperCase();
  return `<div class="comment-avatar" style="background:${commentAvatarColor(name || username)};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px">${initial}</div>`;
}

function updateTopbarAvatar() {
  const img = $("#user-avatar-topbar");
  if (!img || !CURRENT_USER) return;
  if (CURRENT_USER.avatar) { img.src = CURRENT_USER.avatar; img.classList.remove("hidden"); }
  else { img.classList.add("hidden"); }
}

function renderCommentsList(box, list, lessonId) {
  const tops = list.filter((c) => !c.parent_id).sort((a, b) => (+a.created_at) - (+b.created_at));
  const repliesOf = (id) => list.filter((c) => c.parent_id === id).sort((a, b) => (+a.created_at) - (+b.created_at));

  const commentHtml = (c, isReply) => `
    <div class="comment-item ${isReply ? "is-reply" : ""}" data-cid="${c.id}">
      ${avatarHtml(c.username, c.name || c.username, 32)}
      <div class="comment-body">
        <div class="comment-head">
          <span class="comment-name">${esc(c.name || c.username)}</span>
          <span class="comment-time">${new Date(+c.created_at).toLocaleString("vi-VN")}</span>
        </div>
        <p class="comment-text">${esc(c.message)}</p>
        ${!isReply ? `<button class="comment-reply-btn" data-reply-to="${c.id}">↩ Trả lời</button>` : ""}
      </div>
      ${(CURRENT_USER.role === "admin" || CURRENT_USER.username === c.username) ? `<button class="comment-del" data-cdel="${c.id}" title="Xoá">✕</button>` : ""}
    </div>`;

  box.innerHTML = tops.length === 0
    ? `<p class="hint" style="padding:8px 0">Chưa có bình luận nào. Hãy là người đầu tiên đặt câu hỏi hoặc chia sẻ cảm nhận!</p>`
    : tops.map((c) => `
        <div class="comment-thread">
          ${commentHtml(c, false)}
          <div class="comment-replies">
            ${repliesOf(c.id).map((r) => commentHtml(r, true)).join("")}
          </div>
          <div class="comment-reply-box hidden" data-reply-box="${c.id}">
            <textarea rows="1" placeholder="Trả lời ${esc(c.name || c.username)}…"></textarea>
            <button class="btn btn-primary btn-sm" data-reply-send="${c.id}">Gửi</button>
          </div>
        </div>`).join("");

  // Bấm "Trả lời": hiện ô nhập ngay dưới bình luận đó
  $$("[data-reply-to]", box).forEach((b) =>
    b.addEventListener("click", () => {
      const rb = box.querySelector(`[data-reply-box="${b.dataset.replyTo}"]`);
      const wasHidden = rb.classList.contains("hidden");
      $$(".comment-reply-box", box).forEach((x) => x.classList.add("hidden"));
      if (wasHidden) { rb.classList.remove("hidden"); rb.querySelector("textarea").focus(); }
    })
  );
  $$("[data-reply-send]", box).forEach((b) =>
    b.addEventListener("click", () => submitReply(lessonId, box, list, b.dataset.replySend))
  );

  $$("[data-cdel]", box).forEach((b) =>
    b.addEventListener("click", () => {
      confirmModal("Xoá bình luận?", "Nếu bình luận này có các trả lời, chúng sẽ bị xoá theo. Không thể hoàn tác.", async () => {
        try {
          const id = b.dataset.cdel;
          const toRemove = [id, ...repliesOf(id).map((r) => r.id)];
          for (const rid of toRemove) await DBX.remove("comments", "id", rid);
          for (const rid of toRemove) {
            const idx = list.findIndex((c) => c.id === rid);
            if (idx > -1) list.splice(idx, 1);
          }
          renderCommentsList(box, list, lessonId);
        } catch (e) { toast("Lỗi xoá: " + e.message, true); }
      });
    })
  );
}

async function loadComments(lessonId, box) {
  try {
    const rows = await DBX.list("comments");
    const list = rows.filter((c) => c.lesson_id === lessonId);
    box.dataset.loaded = "1";
    renderCommentsList(box, list, lessonId);
  } catch (e) {
    box.innerHTML = `<p class="hint">Chưa thể tải bình luận (cần tạo bảng "comments" trong Supabase).</p>`;
  }
}

async function submitComment(lessonId, box) {
  const input = $("#comment-input");
  const msg = input.value.trim();
  if (!msg) return;
  const row = { id: "cm_" + Date.now(), lesson_id: lessonId, parent_id: null, username: CURRENT_USER.username, name: CURRENT_USER.name, message: msg, created_at: Date.now() };
  const sendBtn = $("#comment-send");
  sendBtn.disabled = true;
  try {
    await DBX.insert("comments", row);
    input.value = "";
    await loadComments(lessonId, box);
  } catch (e) {
    toast("Không gửi được bình luận: " + e.message, true);
  }
  sendBtn.disabled = false;
}

async function submitReply(lessonId, box, list, parentId) {
  const rb = box.querySelector(`[data-reply-box="${parentId}"]`);
  const ta = rb.querySelector("textarea");
  const msg = ta.value.trim();
  if (!msg) return;
  const row = { id: "cm_" + Date.now(), lesson_id: lessonId, parent_id: parentId, username: CURRENT_USER.username, name: CURRENT_USER.name, message: msg, created_at: Date.now() };
  const btn = rb.querySelector("[data-reply-send]");
  btn.disabled = true;
  try {
    await DBX.insert("comments", row);
    await loadComments(lessonId, box);
  } catch (e) {
    toast("Không gửi được trả lời: " + e.message, true);
    btn.disabled = false;
  }
}

function extOf(name) {
  const m = String(name).match(/\.(\w{1,5})$/);
  return m ? m[1].toUpperCase().slice(0, 4) : "TL";
}

/* Chụp một khung hình từ video (dùng làm ảnh bìa cho video tải lên) */
function captureVideoFrame(dataUrl, cb) {
  const v = document.createElement("video");
  v.muted = true;
  v.preload = "auto";
  v.src = dataUrl;
  let done = false;
  const finish = (r) => { if (!done) { done = true; cb(r); } };
  v.addEventListener("loadeddata", () => { try { v.currentTime = Math.min(1, (v.duration || 2) / 2); } catch (e) { finish(null); } });
  v.addEventListener("seeked", () => {
    try {
      const w = Math.min(640, v.videoWidth || 640);
      const sc = w / (v.videoWidth || w);
      const cv = document.createElement("canvas");
      cv.width = w; cv.height = Math.round((v.videoHeight || 360) * sc);
      cv.getContext("2d").drawImage(v, 0, 0, cv.width, cv.height);
      finish(cv.toDataURL("image/jpeg", 0.8));
    } catch (e) { finish(null); }
  });
  v.addEventListener("error", () => finish(null));
  setTimeout(() => finish(null), 8000);
}

/* Tự lấy ảnh bìa từ video YouTube của bài giảng */
function lessonThumb(ls) {
  if (ls.thumb) return ls.thumb;
  const m = String(ls.videoUrl || "").match(/youtube\.com\/embed\/([\w-]{6,})/);
  if (m) return "https://img.youtube.com/vi/" + m[1] + "/hqdefault.jpg";
  return null;
}

/* =====================================================
   TẢI LÊN (đề thi + bài giảng)
===================================================== */
function renderUpload(main, tab) {
  if (CURRENT_USER.role !== "admin") { toast("Chỉ quản trị viên mới được tải nội dung lên", true); return go("exams"); }
  tab = tab || "exam";
  main.innerHTML = `
    <div class="page-head">
      <div>
        <h2 class="page-title">Tải lên</h2>
        <p class="page-sub">Đóng góp đề thi hoặc bài giảng cho mọi người cùng học.</p>
      </div>
    </div>
    <div class="upload-tabs">
      <button class="tab-btn ${tab === "exam" ? "active" : ""}" data-tab="exam">📝 Đề thi</button>
      <button class="tab-btn ${tab === "lesson" ? "active" : ""}" data-tab="lesson">🎬 Bài giảng & tài liệu</button>
    </div>
    <div id="upload-body"></div>`;

  $$(".tab-btn", main).forEach((b) => b.addEventListener("click", () => renderUpload(main, b.dataset.tab)));

  if (tab === "exam") renderUploadExam($("#upload-body"));
  else renderUploadLesson($("#upload-body"));
}

/* ----- Tải đề thi ----- */
function renderUploadExam(box) {
  box.innerHTML = `
    <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr))">
      <div class="card">
        <p style="font-weight:800;color:var(--ink);margin-bottom:12px">1 · Chọn file hoặc dán nội dung</p>
        <label class="file-drop" id="exam-drop">
          <input type="file" id="exam-file" accept=".txt,.json,text/plain,application/json" />
          Kéo thả file vào đây hoặc <b>chọn file</b> (.txt / .json)
        </label>
        <div class="field" style="margin-top:14px">
          <textarea id="exam-text" rows="12" placeholder="…hoặc dán nội dung đề vào đây"></textarea>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" id="parse-btn">Đọc thử đề</button>
          <button class="btn btn-ghost btn-sm" id="sample-btn">Dùng đề mẫu</button>
        </div>
        <p id="exam-err" class="error-box hidden" style="margin-top:12px"></p>
        <div id="exam-preview"></div>
      </div>

      <div class="card">
        <p style="font-weight:800;color:var(--ink);margin-bottom:12px">Định dạng file .txt</p>
        <pre class="format-pre">TIÊU ĐỀ: Tên đề thi
MÔN: Toán
THỜI GIAN: 90
FILE ĐỀ: link PDF gốc (tùy chọn)

[PHẦN 1]        ← trắc nghiệm A B C D
Câu 1: Nội dung câu hỏi?
Hình: link ảnh (tùy chọn)
A. Phương án 1
B. Phương án 2
C. Phương án 3
D. Phương án 4
Đáp án: A

[PHẦN 2]        ← đúng / sai
Câu 1: Đề bài chung
a) Ý thứ nhất = Đ
b) Ý thứ hai = S
c) Ý thứ ba = Đ
d) Ý thứ tư = Đ

[PHẦN 3]        ← trả lời ngắn
Câu 1: Câu hỏi?
Đáp án: 9</pre>
        <p class="hint" style="font-size:12px;color:var(--pencil);margin-top:10px">
          Chấm điểm: Phần I & III mỗi câu 0,25đ · Phần II: đúng 1 ý = 0,1đ, 2 ý = 0,25đ, 3 ý = 0,5đ, 4 ý = 1,0đ. Điểm quy về thang 10.
        </p>
      </div>
    </div>`;

  const showErr = (m) => { const el = $("#exam-err"); el.textContent = m; el.classList.remove("hidden"); $("#exam-preview").innerHTML = ""; };
  const hideErr = () => $("#exam-err").classList.add("hidden");

  const tryParse = () => {
    hideErr();
    const t = $("#exam-text").value;
    if (!t.trim()) return showErr("Chưa có nội dung đề.");
    try {
      const exam = parseExamAny(t);
      const nItems = exam.p2.reduce((s, q) => s + q.items.length, 0);
      const imgs = { p1: {}, p2: {}, p3: {} };
      $("#exam-preview").innerHTML = `
        <div class="success-box" style="margin-top:12px">
          ✓ Đọc đề thành công — <b>${esc(exam.title)}</b> · Môn ${esc(exam.subject)} · ${exam.duration} phút<br/>
          Phần I: ${exam.p1.length} câu · Phần II: ${exam.p2.length} câu (${nItems} ý) · Phần III: ${exam.p3.length} câu
        </div>
        <label class="shuffle-check">
          <input type="checkbox" id="exam-shuffle" />
          🔀 Trộn thứ tự câu hỏi &amp; đáp án ngẫu nhiên cho mỗi lượt thi <span style="font-weight:400;color:var(--pencil)">(chống quay bài — đề gốc không đổi)</span>
        </label>
        <div class="field">
          <label>🖼 Ảnh minh họa từng câu <span style="font-weight:400;color:var(--pencil)">(tùy chọn — tải ảnh thẳng trong web)</span></label>
          <div id="up-imgmgr"></div>
        </div>
        <button class="btn btn-primary" id="save-exam-btn">Lưu đề vào hệ thống</button>`;
      renderImageManager($("#up-imgmgr"), exam, imgs);
      $("#save-exam-btn").addEventListener("click", async () => {
        applyImages(exam, imgs);
        exam.id = "exam_" + Date.now();
        exam.uploader = CURRENT_USER.username;
        exam.createdAt = Date.now();
        exam.shuffle = $("#exam-shuffle").checked;
        const btn = $("#save-exam-btn");
        btn.disabled = true;
        btn.textContent = "Đang lưu…";
        try {
          await DBX.insert("exams", examToRow(exam));
          EXAMS.push(exam);
          toast('Đã lưu đề "' + exam.title + '"');
          go("exams");
        } catch (e) {
          btn.disabled = false;
          btn.textContent = "Lưu đề vào hệ thống";
          showErr("Không lưu được đề: " + e.message);
        }
      });
    } catch (e) {
      showErr(e.message || "Không đọc được nội dung đề.");
    }
  };

  $("#parse-btn").addEventListener("click", tryParse);
  $("#sample-btn").addEventListener("click", () => { $("#exam-text").value = SAMPLE_EXAM_TEXT; tryParse(); });
  $("#exam-file").addEventListener("change", (e) => readTextFile(e.target.files[0], (t) => { $("#exam-text").value = t; tryParse(); }));
  setupDrop($("#exam-drop"), (file) => readTextFile(file, (t) => { $("#exam-text").value = t; tryParse(); }));
}

/* ----- Tải bài giảng ----- */
const MAX_VIDEO = 8 * 1024 * 1024;  // 8MB — localStorage có hạn
const MAX_DOC = 2 * 1024 * 1024;    // 2MB mỗi tài liệu
let LESSON_DRAFT = null;

function renderUploadLesson(box) {
  LESSON_DRAFT = { videoType: null, videoUrl: "", videoData: null, thumb: null, thumbManual: false, docs: [] };

  box.innerHTML = `
    <div class="card" style="max-width:680px">
      <div class="field"><label>Tên bài giảng <span style="font-weight:400;color:var(--pencil)">(nên đánh số để xếp đúng thứ tự)</span></label><input id="ls-title" placeholder="vd: Bài 1 — Khảo sát hàm số" /></div>
      <div class="field"><label>Môn học</label><input id="ls-subject" placeholder="vd: Toán" /></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="field">
          <label>Chương</label>
          <input id="ls-chapter" list="chapter-list" placeholder="vd: Chương 1 — Hàm số" />
          <datalist id="chapter-list">
            ${[...new Set(LESSONS.map((l) => l.chapter).filter(Boolean))].sort(naturalVi).map((c) => `<option value="${esc(c)}"></option>`).join("")}
          </datalist>
          <p class="hint">Gõ trùng tên chương có sẵn (có gợi ý khi gõ) để bài tự xếp vào chương đó; gõ tên mới để tạo chương mới.</p>
        </div>
        <div class="field">
          <label>Chuyên mục</label>
          <select id="ls-category" class="select" style="width:100%">
            ${LESSON_CATEGORIES.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("")}
            <option value="__custom">✏️ Mục khác (tự nhập)…</option>
          </select>
          <input id="ls-category-custom" class="hidden" placeholder="Nhập tên chuyên mục" style="margin-top:8px" />
        </div>
      </div>
      <div class="field">
        <label>Bài <span style="font-weight:400;color:var(--pencil)">(tùy chọn — dùng khi một bài có nhiều phần)</span></label>
        <input id="ls-lesson" list="lesson-list" placeholder="vd: Bài 1 — Cực trị của hàm số" />
        <datalist id="lesson-list">
          ${[...new Set(LESSONS.map((l) => l.lesson).filter(Boolean))].sort(naturalVi).map((c) => `<option value="${esc(c)}"></option>`).join("")}
        </datalist>
        <p class="hint">Ví dụ: Bài = "Bài 1 — Cực trị", còn Tên bài giảng = "Phần 2 — Bài tập rèn luyện" → các phần tự gộp chung dưới Bài 1. Bỏ trống nếu bài chỉ có 1 video.</p>
      </div>
      <div class="field"><label>Mô tả nội dung</label><textarea id="ls-desc" rows="4" style="font-family:var(--font-body);font-size:14px" placeholder="Tóm tắt nội dung bài giảng, kiến thức trọng tâm…"></textarea></div>

      <div class="field">
        <label>Video bài giảng</label>
        <input id="ls-video-url" placeholder="Dán link YouTube hoặc link video (.mp4)…" />
        <p class="hint">Khuyến nghị dùng link YouTube. Hoặc tải file video nhỏ (tối đa ${DB.formatSize(MAX_VIDEO)}):</p>
        <label class="file-drop" id="video-drop" style="margin-top:8px">
          <input type="file" id="ls-video-file" accept="video/*" />
          Kéo thả video vào đây hoặc <b>chọn file video</b>
        </label>
        <div id="video-status"></div>
      </div>

      <div class="field">
        <label>Ảnh bìa (thumbnail) <span style="font-weight:400;color:var(--pencil)">(tùy chọn — video YouTube tự có sẵn, video tải file tự chụp khung hình)</span></label>
        <div id="thumb-status"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <label class="btn btn-outline btn-sm">🖼 Tải ảnh bìa<input type="file" accept="image/*" id="ls-thumb-file" class="hidden" /></label>
          <button type="button" class="btn btn-ghost btn-sm hidden" id="ls-thumb-del">Xóa ảnh bìa</button>
        </div>
      </div>

      <div class="field">
        <label>Tài liệu đính kèm (PDF, Word, ảnh… tối đa ${DB.formatSize(MAX_DOC)}/file)</label>
        <label class="file-drop" id="doc-drop">
          <input type="file" id="ls-doc-file" multiple />
          Kéo thả tài liệu vào đây hoặc <b>chọn file</b>
        </label>
        <p class="hint" style="margin-top:10px">…hoặc dán link tài liệu (Google Drive, Docs, Dropbox…). Nhớ mở quyền "Bất kỳ ai có link đều xem được":</p>
        <div style="display:grid;gap:8px;margin-top:6px">
          <input id="ls-doc-link-name" placeholder="Tên hiển thị (vd: Phiếu bài tập chương 1)" />
          <div style="display:flex;gap:8px">
            <input id="ls-doc-link" placeholder="https://drive.google.com/…" style="flex:1" />
            <button type="button" class="btn btn-outline btn-sm" id="add-doc-link">Thêm link</button>
          </div>
        </div>
        <div class="attach-list" id="doc-list"></div>
      </div>

      <p id="ls-err" class="error-box hidden"></p>
      <button class="btn btn-primary" id="save-lesson-btn">Đăng bài giảng</button>
    </div>`;

  const err = (m) => { const el = $("#ls-err"); el.textContent = m; el.classList.remove("hidden"); };
  const hideErr = () => $("#ls-err").classList.add("hidden");

  const showThumb = () => {
    $("#thumb-status").innerHTML = LESSON_DRAFT.thumb
      ? `<img src="${LESSON_DRAFT.thumb}" alt="" style="max-width:220px;border-radius:9px;border:1px solid var(--line);margin-bottom:8px;display:block" />`
      : "";
    $("#ls-thumb-del").classList.toggle("hidden", !LESSON_DRAFT.thumb);
  };
  $("#ls-thumb-file").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    compressImageFile(f, (d) => {
      if (!d) return err("Không đọc được file ảnh.");
      LESSON_DRAFT.thumb = d;
      LESSON_DRAFT.thumbManual = true;
      showThumb();
    });
  });
  $("#ls-thumb-del").addEventListener("click", () => {
    LESSON_DRAFT.thumb = null;
    LESSON_DRAFT.thumbManual = false;
    showThumb();
  });

  const onVideoFile = (file) => {
    if (!file) return;
    if (file.size > MAX_VIDEO) return err("Video vượt quá " + DB.formatSize(MAX_VIDEO) + ". Hãy dùng link YouTube cho video dài.");
    hideErr();
    const reader = new FileReader();
    reader.onload = () => {
      LESSON_DRAFT.videoType = "file";
      LESSON_DRAFT.videoData = reader.result;
      $("#video-status").innerHTML = `<p class="success-box" style="margin-top:8px">✓ Đã chọn video: ${esc(file.name)} (${DB.formatSize(file.size)})</p>`;
      // Tự chụp một khung hình làm ảnh bìa (nếu chưa tự chọn ảnh)
      if (!LESSON_DRAFT.thumbManual) {
        captureVideoFrame(reader.result, (t) => { if (t && !LESSON_DRAFT.thumbManual) { LESSON_DRAFT.thumb = t; showThumb(); } });
      }
    };
    reader.readAsDataURL(file);
  };
  $("#ls-video-file").addEventListener("change", (e) => onVideoFile(e.target.files[0]));
  setupDrop($("#video-drop"), onVideoFile);

  const renderDocs = () => {
    $("#doc-list").innerHTML = LESSON_DRAFT.docs.map((d, i) => `
      <div class="attach-item">${d.link ? "🔗" : "📄"} ${esc(d.name)} <span style="color:var(--pencil)">${d.link ? "(link)" : "(" + DB.formatSize(d.size) + ")"}</span>
        <button class="x" data-rm="${i}" title="Xoá">✕</button>
      </div>`).join("");
    $$("[data-rm]").forEach((b) => b.addEventListener("click", () => {
      LESSON_DRAFT.docs.splice(+b.dataset.rm, 1);
      renderDocs();
    }));
  };

  // Thêm tài liệu bằng link (Google Drive, Docs, Dropbox…)
  $("#add-doc-link").addEventListener("click", () => {
    hideErr();
    const url = $("#ls-doc-link").value.trim();
    if (!url) return err("Hãy dán link tài liệu trước khi bấm Thêm link.");
    if (!/^https?:\/\//i.test(url)) return err("Link phải bắt đầu bằng http:// hoặc https://");
    let name = $("#ls-doc-link-name").value.trim();
    if (!name) {
      name = /drive\.google\.com/i.test(url) ? "Tài liệu Google Drive"
        : /docs\.google\.com/i.test(url) ? "Tài liệu Google Docs"
        : "Tài liệu (link)";
    }
    LESSON_DRAFT.docs.push({ name, link: url });
    $("#ls-doc-link").value = "";
    $("#ls-doc-link-name").value = "";
    renderDocs();
  });
  const onDocFiles = (files) => {
    hideErr();
    for (const f of files) {
      if (f.size > MAX_DOC) { err(`"${f.name}" vượt quá ${DB.formatSize(MAX_DOC)}.`); continue; }
      const reader = new FileReader();
      reader.onload = () => {
        LESSON_DRAFT.docs.push({ name: f.name, size: f.size, data: reader.result });
        renderDocs();
      };
      reader.readAsDataURL(f);
    }
  };
  $("#ls-doc-file").addEventListener("change", (e) => onDocFiles(e.target.files));
  setupDrop($("#doc-drop"), (f) => onDocFiles([f]));

  $("#ls-category").addEventListener("change", () => {
    $("#ls-category-custom").classList.toggle("hidden", $("#ls-category").value !== "__custom");
  });

  $("#save-lesson-btn").addEventListener("click", async () => {
    hideErr();
    const title = $("#ls-title").value.trim();
    const subject = $("#ls-subject").value.trim() || "Chưa rõ";
    if (!title) return err("Vui lòng nhập tên bài giảng.");

    let category = $("#ls-category").value;
    if (category === "__custom") {
      category = $("#ls-category-custom").value.trim();
      if (!category) return err("Vui lòng nhập tên chuyên mục hoặc chọn một mục có sẵn.");
    }
    const chapter = $("#ls-chapter").value.trim();
    const lessonName = $("#ls-lesson").value.trim();

    const url = $("#ls-video-url").value.trim();
    if (url) {
      const yt = toYouTubeEmbed(url);
      const stm = url.match(/streamable\.com\/(?:e\/)?([\w]+)/i);
      if (yt) { LESSON_DRAFT.videoType = "youtube"; LESSON_DRAFT.videoUrl = yt; }
      else if (stm) { LESSON_DRAFT.videoType = "youtube"; LESSON_DRAFT.videoUrl = "https://streamable.com/e/" + stm[1]; }
      else if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) { LESSON_DRAFT.videoType = "url"; LESSON_DRAFT.videoUrl = url; }
      else { LESSON_DRAFT.videoType = "youtube"; LESSON_DRAFT.videoUrl = url; }
    }
    if (!LESSON_DRAFT.videoType && LESSON_DRAFT.docs.length === 0) {
      return err("Bài giảng cần ít nhất một video hoặc một tài liệu.");
    }

    const lesson = {
      id: "ls_" + Date.now(),
      title, subject, category, chapter,
      lesson: lessonName,
      description: $("#ls-desc").value.trim(),
      videoType: LESSON_DRAFT.videoType,
      videoUrl: LESSON_DRAFT.videoUrl,
      videoData: LESSON_DRAFT.videoData,
      thumb: LESSON_DRAFT.thumb || null,
      docs: LESSON_DRAFT.docs,
      uploader: CURRENT_USER.username,
      createdAt: Date.now(),
    };
    const btn = $("#save-lesson-btn");
    btn.disabled = true;
    btn.textContent = "Đang đăng…";
    try {
      await DBX.insert("lessons", lessonToRow(lesson));
      LESSONS.push(lesson);
      toast('Đã đăng bài giảng "' + title + '"');
      go("lessons");
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Đăng bài giảng";
      err("Không đăng được bài giảng: " + e.message);
    }
  });
}

/* ----- Tiện ích file ----- */
function readTextFile(file, cb) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => cb(reader.result);
  reader.readAsText(file, "utf-8");
}
function setupDrop(el, onFile) {
  if (!el) return;
  ["dragover", "dragenter"].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.add("drag"); }));
  ["dragleave", "drop"].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); el.classList.remove("drag"); }));
  el.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) onFile(f);
  });
}

/* =====================================================
   QUẢN TRỊ
===================================================== */
function renderAdmin(main, tab) { renderAdminAsync(main, tab); }
async function renderAdminAsync(main, tab) {
  if (CURRENT_USER.role !== "admin") return go("exams");
  if (tab === undefined) {
    await syncView(main, ["users", "exams", "lessons", "results", "notices", "progress", "question_reports"]);
    if (VIEW !== "admin") return;
  }
  tab = tab || "users";
  const avg = RESULTS.length ? (RESULTS.reduce((s, r) => s + r.score10, 0) / RESULTS.length).toFixed(2) : "—";

  main.innerHTML = `
    <div class="page-head"><div><h2 class="page-title">Bảng quản trị</h2><p class="page-sub">Quản lý tài khoản, đề thi, bài giảng và lượt thi của toàn hệ thống.</p></div></div>

    <div class="stat-grid">
      <div class="stat-card"><b>${USERS.filter((u) => u.role !== "admin").length}</b><span>Thí sinh</span></div>
      <div class="stat-card"><b>${EXAMS.length}</b><span>Đề thi</span></div>
      <div class="stat-card"><b>${LESSONS.length}</b><span>Bài giảng</span></div>
      <div class="stat-card"><b>${RESULTS.length}</b><span>Lượt thi</span></div>
      <div class="stat-card"><b>${avg}</b><span>Điểm trung bình</span></div>
    </div>

    <div class="upload-tabs">
      ${[["users", "Tài khoản"], ["exams", "Đề thi"], ["lessons", "Bài giảng"], ["results", "Lượt thi"], ["progress", "📊 Tiến độ"], ["reports", "🚩 Báo lỗi"], ["notices", "📣 Thông báo"]]
        .map(([k, l]) => `<button class="tab-btn ${tab === k ? "active" : ""}" data-atab="${k}">${l}</button>`).join("")}
    </div>

    <div class="admin-list" id="admin-list"></div>`;

  $$("[data-atab]", main).forEach((b) => b.addEventListener("click", () => renderAdmin(main, b.dataset.atab)));

  const list = $("#admin-list");
  const row = (t, s, btnHtml, avatar) => `
    <div class="admin-row">
      ${avatar || ""}
      <div class="info"><div class="t">${t}</div><div class="s">${s}</div></div>
      ${btnHtml || ""}
    </div>`;

  if (tab === "users") {
    list.innerHTML = `
      <div style="padding:16px;border-bottom:1px solid var(--line)">
        <p style="font-weight:800;color:var(--ink);margin-bottom:10px">+ Tạo tài khoản mới</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div class="field" style="margin-bottom:0"><label>Họ và tên</label><input id="nu-name" placeholder="Nguyễn Văn A" /></div>
          <div class="field" style="margin-bottom:0"><label>Tên đăng nhập</label><input id="nu-username" placeholder="vd: nguyenvana" /></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div class="field" style="margin-bottom:0"><label>Mật khẩu</label><input id="nu-password" type="text" placeholder="Đặt mật khẩu ban đầu" /></div>
          <div class="field" style="margin-bottom:0">
            <label>Vai trò</label>
            <select id="nu-role" class="select" style="width:100%">
              <option value="user">Học sinh</option>
              <option value="solver">Người giải bài</option>
              <option value="admin">Quản trị viên</option>
            </select>
          </div>
        </div>
        <p id="nu-err" class="error-box hidden"></p>
        <button class="btn btn-primary btn-sm" id="nu-create">Tạo tài khoản</button>
      </div>
      <div id="users-list"></div>`;

    $("#nu-create").addEventListener("click", async () => {
      const errEl = $("#nu-err");
      errEl.classList.add("hidden");
      const name = $("#nu-name").value.trim();
      const username = $("#nu-username").value.trim().toLowerCase();
      const password = $("#nu-password").value;
      const role = $("#nu-role").value;
      if (!name || !username || !password) {
        errEl.textContent = "Vui lòng điền đầy đủ họ tên, tên đăng nhập và mật khẩu.";
        errEl.classList.remove("hidden");
        return;
      }
      if (/\s/.test(username)) {
        errEl.textContent = "Tên đăng nhập không được chứa khoảng trắng.";
        errEl.classList.remove("hidden");
        return;
      }
      if (USERS.some((u) => u.username === username)) {
        errEl.textContent = "Tên đăng nhập đã tồn tại, hãy chọn tên khác.";
        errEl.classList.remove("hidden");
        return;
      }
      const btn = $("#nu-create");
      btn.disabled = true; btn.textContent = "Đang tạo…";
      const u = { username, password, name, role };
      try {
        await DBX.insert("users", u);
        USERS.push(u);
        toast(`Đã tạo tài khoản "${username}"`);
        renderAdmin(main, "users");
      } catch (e) {
        btn.disabled = false; btn.textContent = "Tạo tài khoản";
        errEl.textContent = "Không tạo được tài khoản: " + e.message;
        errEl.classList.remove("hidden");
      }
    });

    $("#users-list").innerHTML = USERS.map((u) => row(
      `${esc(u.name)} <span style="font-family:var(--font-mono);font-weight:400;color:var(--pencil)">(${esc(u.username)})</span>${u.role === "admin" ? '<span class="badge-admin">ADMIN</span>' : u.role === "solver" ? '<span class="badge-solver">GIẢI BÀI</span>' : ""}${u.restricted ? '<span class="badge-restricted">🔒 GIỚI HẠN</span>' : ""}`,
      `${u.email ? u.email + " · " : ""}${RESULTS.filter((r) => r.username === u.username).length} lượt thi`,
      u.role !== "admin" ? `<span style="display:flex;gap:6px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end"><button class="btn btn-outline btn-sm" data-change-role="${esc(u.username)}">🎓 Đổi vai trò</button><button class="btn btn-outline btn-sm" data-manage-access="${esc(u.username)}">🔒 Giới hạn</button><button class="btn btn-danger btn-sm" data-del-user="${esc(u.username)}">Xoá</button></span>` : "",
      avatarHtml(u.username, u.name, 34)
    )).join("");
    $$("[data-change-role]").forEach((b) => b.addEventListener("click", () => openChangeRoleModal(b.dataset.changeRole, main)));
    $$("[data-manage-access]").forEach((b) => b.addEventListener("click", () => go("studentaccess", b.dataset.manageAccess)));
    $$("[data-del-user]").forEach((b) => b.addEventListener("click", () =>
      confirmModal("Xoá tài khoản?", `Tài khoản "${b.dataset.delUser}" và toàn bộ lượt thi của họ sẽ bị xoá.`, async () => {
        try {
          await DBX.remove("users", "username", b.dataset.delUser);
          await DBX.remove("results", "username", b.dataset.delUser);
          try { await DBX.remove("progress", "username", b.dataset.delUser); PROGRESS = PROGRESS.filter((p) => p.username !== b.dataset.delUser); } catch (e2) {}
          USERS = USERS.filter((u) => u.username !== b.dataset.delUser);
          RESULTS = RESULTS.filter((r) => r.username !== b.dataset.delUser);
          toast("Đã xoá tài khoản");
        } catch (e) { toast("Lỗi xoá: " + e.message, true); }
        renderAdmin(main, "users");
      })
    ));
  } else if (tab === "exams") {
    list.innerHTML = EXAMS.length ? EXAMS.map((e) => row(
      esc(e.title),
      `${esc(e.subject)} · ${e.p1.length + e.p2.length + e.p3.length} câu · đăng bởi ${esc(e.uploader)} · ${RESULTS.filter((r) => r.examId === e.id).length} lượt thi`,
      `<span style="display:flex;gap:6px;flex-shrink:0"><button class="btn btn-outline btn-sm" data-edit-exam="${e.id}">Sửa</button><button class="btn btn-danger btn-sm" data-del-exam="${e.id}">Xoá</button></span>`
    )).join("") : `<div class="admin-row"><span class="s">Chưa có đề thi.</span></div>`;
    $$("[data-edit-exam]").forEach((b) => b.addEventListener("click", () => go("editexam", b.dataset.editExam)));
    $$("[data-del-exam]").forEach((b) => b.addEventListener("click", () =>
      confirmModal("Xoá đề thi?", "Đề thi và các lượt thi liên quan sẽ bị xoá.", async () => {
        try {
          await DBX.remove("exams", "id", b.dataset.delExam);
          await DBX.remove("results", "exam_id", b.dataset.delExam);
          EXAMS = EXAMS.filter((e) => e.id !== b.dataset.delExam);
          RESULTS = RESULTS.filter((r) => r.examId !== b.dataset.delExam);
          toast("Đã xoá đề thi");
        } catch (e) { toast("Lỗi xoá: " + e.message, true); }
        renderAdmin(main, "exams");
      })
    ));
  } else if (tab === "lessons") {
    if (!LESSONS.length) {
      list.innerHTML = `<div class="admin-row"><span class="s">Chưa có bài giảng.</span></div>`;
    } else {
      const tree = buildChapterTree(LESSONS);
      const chapterKeys = orderChapterKeys(tree);
      const catOrder = [...LESSON_CATEGORIES, "Khác"];
      list.innerHTML = chapterKeys.map((ch) => {
        const catKeys = Object.keys(tree[ch]).sort((a, b) => (catOrder.indexOf(a) === -1 ? 99 : catOrder.indexOf(a)) - (catOrder.indexOf(b) === -1 ? 99 : catOrder.indexOf(b)));
        const chapterLessons = Object.values(tree[ch]).flat();
        return `
        <details class="chapter-block" data-fold="adminls:${esc(ch)}" ${foldIsOpen("adminls:" + ch, true) ? "open" : ""}>
          <summary class="chapter-head"><h3>📁 ${esc(ch)}</h3><span>${chapterLessons.length} bài <b class="chev">▾</b></span></summary>
          <div class="chapter-body">
            ${catKeys.map((c) => `
              <div class="cat-head" style="cursor:default">${esc(c)} <span style="font-weight:400;color:var(--pencil)">· ${tree[ch][c].length} bài</span></div>
              ${tree[ch][c].slice().sort((a, b) => naturalVi(a.title, b.title)).map((l) => row(
                esc(l.title),
                `${esc(l.subject)}${l.lesson ? " · " + esc(l.lesson) : ""} · ${l.docs.length} tài liệu · đăng bởi ${esc(l.uploader)}`,
                `<span style="display:flex;gap:6px;flex-shrink:0"><button class="btn btn-outline btn-sm" data-edit-lesson="${l.id}">Sửa</button><button class="btn btn-danger btn-sm" data-del-lesson="${l.id}">Xoá</button></span>`
              )).join("")}
            `).join("")}
          </div>
        </details>`;
      }).join("");
      bindFoldMemory(main);
    }
    $$("[data-edit-lesson]").forEach((b) => b.addEventListener("click", () => go("editlesson", b.dataset.editLesson)));
    $$("[data-del-lesson]").forEach((b) => b.addEventListener("click", () =>
      confirmModal("Xoá bài giảng?", "Video và tài liệu kèm theo sẽ bị xoá khỏi hệ thống.", async () => {
        try {
          await DBX.remove("lessons", "id", b.dataset.delLesson);
          LESSONS = LESSONS.filter((l) => l.id !== b.dataset.delLesson);
          try { await DBX.remove("progress", "lesson_id", b.dataset.delLesson); PROGRESS = PROGRESS.filter((p) => p.lesson_id !== b.dataset.delLesson); } catch (e2) {}
          toast("Đã xoá bài giảng");
        } catch (e) { toast("Lỗi xoá: " + e.message, true); }
        renderAdmin(main, "lessons");
      })
    ));
  } else if (tab === "progress") {
    const students = USERS.filter((u) => u.role !== "admin");
    const totalLessons = LESSONS.length;
    list.innerHTML = students.length ? students.map((u) => {
      const mine = PROGRESS.filter((p) => p.username === u.username);
      const watchedCount = new Set(mine.map((p) => p.lesson_id)).size;
      const last = mine.slice().sort((a, b) => (+b.created_at) - (+a.created_at))[0];
      const lastLesson = last ? LESSONS.find((l) => l.id === last.lesson_id) : null;
      const pct = totalLessons ? Math.round((watchedCount / totalLessons) * 100) : 0;
      return row(
        `${esc(u.name)} <span style="font-family:var(--font-mono);font-weight:400;color:var(--pencil)">(${esc(u.username)})</span>`,
        `Đã xem ${watchedCount}/${totalLessons} bài (${pct}%)${lastLesson ? " · gần nhất: " + esc(lastLesson.title) : totalLessons ? " · chưa xem bài nào" : ""}`,
        `<button class="btn btn-outline btn-sm" data-view-progress="${esc(u.username)}">Xem chi tiết</button>`
      );
    }).join("") : `<div class="admin-row"><span class="s">Chưa có học sinh nào.</span></div>`;
    $$("[data-view-progress]").forEach((b) => b.addEventListener("click", () => go("studentprogress", b.dataset.viewProgress)));
  } else if (tab === "reports") {
    const grouped = {};
    for (const rp of REPORTS) {
      (grouped[rp.exam_id] = grouped[rp.exam_id] || { title: rp.exam_title, items: [] }).items.push(rp);
    }
    const examIds = Object.keys(grouped).sort((a, b) => {
      const la = Math.max(...grouped[a].items.map((r) => +r.created_at || 0));
      const lb = Math.max(...grouped[b].items.map((r) => +r.created_at || 0));
      return lb - la;
    });
    const totalUnresolved = REPORTS.filter((r) => !r.resolved).length;

    list.innerHTML = `
      <div style="padding:14px 18px;border-bottom:1px solid var(--line);font-size:13px;color:var(--pencil)">
        ${totalUnresolved > 0 ? `<b style="color:var(--red)">${totalUnresolved} báo cáo chưa xử lý</b>` : "Không có báo cáo nào đang chờ xử lý ✓"}
      </div>
      ${examIds.length === 0 ? `<div class="admin-row"><span class="s">Chưa có báo cáo lỗi nào.</span></div>` : examIds.map((examId) => {
        const g = grouped[examId];
        const sorted = g.items.slice().sort((a, b) => (a.resolved === b.resolved ? 0 : a.resolved ? 1 : -1) || ((+b.created_at) - (+a.created_at)));
        return `
        <div class="report-exam-group">
          <div class="report-exam-head">
            <span>${esc(g.title)}</span>
            <button class="btn btn-outline btn-sm" data-edit-exam-from-report="${esc(examId)}">✏️ Sửa đề</button>
          </div>
          ${sorted.map((rp) => `
            <div class="admin-row report-row ${rp.resolved ? "report-resolved" : ""}">
              <div class="info">
                <div class="t">${esc(PART_LABELS[rp.part] || rp.part)} · Câu ${rp.q_index + 1} · <span style="color:var(--gold)">${esc(rp.reason)}</span></div>
                <div class="s">${esc(rp.question_text || "")}</div>
                ${rp.detail ? `<div class="s" style="font-style:italic">"${esc(rp.detail)}"</div>` : ""}
                <div class="s">bởi ${esc(rp.name || rp.username)} · ${new Date(+rp.created_at).toLocaleString("vi-VN")}</div>
              </div>
              <span style="display:flex;gap:6px;flex-shrink:0">
                <button class="btn btn-outline btn-sm" data-toggle-resolved="${rp.id}">${rp.resolved ? "↺ Mở lại" : "✓ Đã xử lý"}</button>
                <button class="btn btn-danger btn-sm" data-del-report="${rp.id}">Xoá</button>
              </span>
            </div>`).join("")}
        </div>`;
      }).join("")}`;

    $$("[data-edit-exam-from-report]").forEach((b) => b.addEventListener("click", () => go("editexam", b.dataset.editExamFromReport)));
    $$("[data-toggle-resolved]").forEach((b) => b.addEventListener("click", async () => {
      const rp = REPORTS.find((r) => r.id === b.dataset.toggleResolved);
      if (!rp) return;
      const updated = { ...rp, resolved: !rp.resolved };
      try {
        await DBX.remove("question_reports", "id", rp.id);
        await DBX.insert("question_reports", updated);
        const idx = REPORTS.findIndex((r) => r.id === rp.id);
        if (idx > -1) REPORTS[idx] = updated;
        renderAdmin(main, "reports");
      } catch (e) { toast("Lỗi: " + e.message, true); }
    }));
    $$("[data-del-report]").forEach((b) => b.addEventListener("click", async () => {
      try {
        await DBX.remove("question_reports", "id", b.dataset.delReport);
        REPORTS = REPORTS.filter((r) => r.id !== b.dataset.delReport);
        toast("Đã xoá báo cáo");
        renderAdmin(main, "reports");
      } catch (e) { toast("Lỗi xoá: " + e.message, true); }
    }));
  } else if (tab === "notices") {
    list.innerHTML = `
      <div style="padding:16px;border-bottom:1px solid var(--line)">
        <div class="field" style="margin-bottom:10px">
          <label>Gửi thông báo tới mọi người dùng</label>
          <textarea id="notice-text" rows="3" style="font-family:var(--font-body);font-size:14px" placeholder="vd: Đã cập nhật đề thi giữa kỳ mới, mọi người vào luyện nhé!"></textarea>
        </div>
        <button class="btn btn-primary btn-sm" id="notice-send">📣 Gửi thông báo</button>
      </div>
      ${NOTICES.length ? [...NOTICES].sort((a, b) => (+b.created_at) - (+a.created_at)).map((n) => `
        <div class="admin-row">
          <div class="info">
            <div class="t">📣 ${esc(n.message)}</div>
            <div class="s">${new Date(+n.created_at).toLocaleString("vi-VN")} · gửi bởi ${esc(n.author || "admin")}</div>
          </div>
          <button class="btn btn-danger btn-sm" data-del-notice="${n.id}">Xoá</button>
        </div>`).join("") : `<div class="admin-row"><span class="s">Chưa có thông báo nào từ admin.</span></div>`}`;

    $("#notice-send").addEventListener("click", async () => {
      const msg = $("#notice-text").value.trim();
      if (!msg) return toast("Hãy nhập nội dung thông báo", true);
      const n = { id: "n_" + Date.now(), message: msg, author: CURRENT_USER.username, created_at: Date.now() };
      try {
        await DBX.insert("notices", n);
        NOTICES.push(n);
        toast("Đã gửi thông báo tới mọi người");
        updateNotifBadge();
        renderAdmin(main, "notices");
      } catch (e) { toast("Lỗi: " + e.message + " — kiểm tra đã tạo bảng notices chưa", true); }
    });
    $$("[data-del-notice]").forEach((b) => b.addEventListener("click", async () => {
      try {
        await DBX.remove("notices", "id", b.dataset.delNotice);
        NOTICES = NOTICES.filter((n) => n.id !== b.dataset.delNotice);
        toast("Đã xoá thông báo");
        renderAdmin(main, "notices");
      } catch (e) { toast("Lỗi xoá: " + e.message, true); }
    }));
  } else {
    const sorted = [...RESULTS].sort((a, b) => b.date - a.date);
    list.innerHTML = sorted.length ? sorted.map((r) => row(
      `${esc(r.name)} · <span style="color:var(--red);font-family:var(--font-mono)">${r.score10.toFixed(2)}đ</span>${r.tabSwitches > 0 ? ` <span class="chip chip-gold" title="Rời tab ${r.tabSwitches} lần">⚠️ ${r.tabSwitches}x</span>` : ""}`,
      `${esc(r.examTitle)} · ${new Date(r.date).toLocaleString("vi-VN")}`,
      `<span style="display:flex;gap:6px;flex-shrink:0">${r.answers ? `<button class="btn btn-outline btn-sm" data-view-res="${r.id}">Xem</button>` : ""}<button class="btn btn-danger btn-sm" data-del-res="${r.id}">Xoá</button></span>`
    )).join("") : `<div class="admin-row"><span class="s">Chưa có lượt thi nào.</span></div>`;
    $$("[data-view-res]").forEach((b) => b.addEventListener("click", () => go("reviewexam", b.dataset.viewRes)));
    $$("[data-del-res]").forEach((b) => b.addEventListener("click", async () => {
      try {
        await DBX.remove("results", "id", b.dataset.delRes);
        RESULTS = RESULTS.filter((r) => r.id !== b.dataset.delRes);
        toast("Đã xoá lượt thi");
      } catch (e) { toast("Lỗi xoá: " + e.message, true); }
      renderAdmin(main, "results");
    }));
  }
}

/* =====================================================
   HỎI BÀI (Q&A) — ai cũng gửi được ảnh câu hỏi + chat,
   chỉ role "solver" (Người giải bài) hoặc "admin" mới được trả lời & đổi trạng thái
===================================================== */
function canSolve(u) { return !!u && (u.role === "solver" || u.role === "admin"); }

function renderProfile(main) {
  const u = CURRENT_USER;
  const roleLabel = u.role === "admin" ? "Quản trị viên" : u.role === "solver" ? "Người giải bài" : "Học sinh";
  main.innerHTML = `
    <div class="page-head"><h2 class="page-title">Hồ sơ của tôi</h2></div>
    <div class="qa-detail-card" style="max-width:460px">
      <div style="display:flex;flex-direction:column;align-items:center;gap:14px;margin-bottom:18px">
        <div style="position:relative">
          ${avatarHtml(u.username, u.name, 96)}
        </div>
        <label class="btn btn-outline btn-sm">📷 Đổi ảnh đại diện<input type="file" accept="image/*" id="pf-avatar-file" class="hidden" /></label>
        <p id="pf-avatar-err" class="error-box hidden" style="text-align:center"></p>
      </div>
      <div class="field"><label>Họ tên</label><p style="font-weight:700;color:var(--ink)">${esc(u.name)}</p></div>
      <div class="field"><label>Tên đăng nhập</label><p style="font-family:var(--font-mono)">${esc(u.username)}</p></div>
      <div class="field"><label>Vai trò</label><p><span class="chip chip-pen">${roleLabel}</span></p></div>
      <div class="modal-actions" style="justify-content:flex-start">
        <button class="btn btn-outline btn-sm" id="pf-changepw">Đổi mật khẩu</button>
      </div>
    </div>
  `;
  $("#pf-changepw").addEventListener("click", () => go("changepw"));
  $("#pf-avatar-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    const errEl = $("#pf-avatar-err");
    errEl.classList.add("hidden");
    compressImageFile(f, async (dataUrl) => {
      if (!dataUrl) { errEl.textContent = "Không đọc được ảnh này."; errEl.classList.remove("hidden"); return; }
      const updated = { ...u, avatar: dataUrl };
      try {
        await DBX.remove("users", "username", u.username);
        await DBX.insert("users", updated);
        const idx = USERS.findIndex((x) => x.username === u.username);
        if (idx > -1) USERS[idx] = updated;
        CURRENT_USER = updated;
        updateTopbarAvatar();
        toast("Đã cập nhật ảnh đại diện");
        renderProfile(main);
      } catch (err) {
        errEl.textContent = "Không lưu được: " + err.message + " — kiểm tra đã thêm cột avatar cho bảng users chưa";
        errEl.classList.remove("hidden");
      }
    }, 300);
  });
}



function openChangeRoleModal(username, main) {
  const u = USERS.find((x) => x.username === username);
  if (!u) return;
  $("#modal-root").innerHTML = `
    <div class="modal-overlay" id="cr-overlay">
      <div class="modal">
        <h3>🎓 Đổi vai trò</h3>
        <p>Tài khoản: <b>${esc(u.name)}</b> (${esc(u.username)})</p>
        <div class="field">
          <label>Vai trò mới</label>
          <select id="cr-role" class="select" style="width:100%">
            <option value="user" ${u.role === "user" || !u.role ? "selected" : ""}>Học sinh</option>
            <option value="solver" ${u.role === "solver" ? "selected" : ""}>Người giải bài</option>
            <option value="admin" ${u.role === "admin" ? "selected" : ""}>Quản trị viên</option>
          </select>
        </div>
        <p id="cr-err" class="error-box hidden"></p>
        <div class="modal-actions">
          <button class="btn btn-outline" id="cr-cancel">Huỷ</button>
          <button class="btn btn-primary" id="cr-save">Lưu</button>
        </div>
      </div>
    </div>`;
  $("#cr-overlay").addEventListener("click", (e) => { if (e.target.id === "cr-overlay") $("#modal-root").innerHTML = ""; });
  $("#cr-cancel").addEventListener("click", () => { $("#modal-root").innerHTML = ""; });
  $("#cr-save").addEventListener("click", async () => {
    const newRole = $("#cr-role").value;
    const btn = $("#cr-save");
    btn.disabled = true; btn.textContent = "Đang lưu…";
    const updated = { ...u, role: newRole };
    try {
      await DBX.remove("users", "username", username);
      await DBX.insert("users", updated);
      const idx = USERS.findIndex((x) => x.username === username);
      if (idx > -1) USERS[idx] = updated;
      $("#modal-root").innerHTML = "";
      toast(`Đã đổi vai trò của "${u.name}" thành ${newRole === "admin" ? "Quản trị viên" : newRole === "solver" ? "Người giải bài" : "Học sinh"}`);
      renderAdmin(main, "users");
    } catch (e) {
      btn.disabled = false; btn.textContent = "Lưu";
      $("#cr-err").textContent = "Không lưu được: " + e.message;
      $("#cr-err").classList.remove("hidden");
    }
  });
}

function updateQABadge() {
  const badge = $("#qa-badge");
  if (!badge || !CURRENT_USER) return;
  if (!canSolve(CURRENT_USER)) { badge.classList.add("hidden"); return; }
  const n = QA_QUESTIONS.filter((q) => q.status !== "done").length;
  badge.textContent = n > 9 ? "9+" : n;
  badge.classList.toggle("hidden", n === 0);
}

let QA_FILTER = "all"; // "all" | "mine" | "pending"

function renderQA(main) { renderQAAsync(main); }
async function renderQAAsync(main) {
  await syncView(main, ["qa_questions", "qa_messages"]);
  if (VIEW !== "qa") return;

  const solver = canSolve(CURRENT_USER);
  let items = [...QA_QUESTIONS].filter((q) => q.visibility !== "private" || solver || q.username === CURRENT_USER.username);
  items.sort((a, b) => (+b.created_at) - (+a.created_at));
  if (QA_FILTER === "mine") items = items.filter((q) => q.username === CURRENT_USER.username);
  if (QA_FILTER === "pending") items = items.filter((q) => q.status !== "done");
  const countReplies = (qid) => QA_MESSAGES.filter((m) => m.question_id === qid).length;

  main.innerHTML = `
    <div class="page-head">
      <div>
        <h2 class="page-title">Hỏi bài</h2>
        <p class="page-sub">Gửi ảnh câu hỏi bạn chưa giải được — ${solver ? "trả lời cho học sinh ngay trong này." : "người giải bài sẽ vào hỗ trợ bạn ở đây."}</p>
      </div>
      <button class="btn btn-primary" id="qa-ask-btn">+ Đặt câu hỏi mới</button>
    </div>

    <div class="qa-filters">
      <button class="chip-filter ${QA_FILTER === "all" ? "active" : ""}" data-qafilter="all">Tất cả</button>
      <button class="chip-filter ${QA_FILTER === "mine" ? "active" : ""}" data-qafilter="mine">Câu hỏi của tôi</button>
      ${solver ? `<button class="chip-filter ${QA_FILTER === "pending" ? "active" : ""}" data-qafilter="pending">Chờ xử lý</button>` : ""}
    </div>

    ${items.length === 0 ? `<div class="empty"><div class="big">💬</div>Chưa có câu hỏi nào ở đây.</div>` : `
      <div class="qa-list">
        ${items.map((q) => `
          <div class="qa-card" data-qaopen="${q.id}">
            ${q.image ? `<img class="qa-thumb" src="${q.image}" />` : `<div class="qa-thumb qa-thumb-empty">📝</div>`}
            <div class="qa-card-body">
              <div class="qa-card-head">
                <span class="qa-card-name">${esc(q.name)}</span>
                <span style="display:flex;gap:6px;flex-wrap:wrap">
                  ${q.visibility === "private" ? `<span class="chip chip-pen">🔒 Riêng tư</span>` : ""}
                  <span class="chip ${q.status === "done" ? "chip-green" : "chip-gold"}">${q.status === "done" ? "✓ Đã xong" : "⏳ Chờ xử lý"}</span>
                </span>
              </div>
              <div class="qa-card-text">${esc((q.text || "").slice(0, 140))}${(q.text || "").length > 140 ? "…" : ""}</div>
              <div class="qa-card-meta">${new Date(+q.created_at).toLocaleString("vi-VN")} · 💬 ${countReplies(q.id)} tin nhắn</div>
            </div>
          </div>`).join("")}
      </div>`}
  `;

  $$("[data-qafilter]").forEach((b) => b.addEventListener("click", () => { QA_FILTER = b.dataset.qafilter; renderQA(main); }));
  $$("[data-qaopen]").forEach((b) => b.addEventListener("click", () => go("qadetail", b.dataset.qaopen)));
  $("#qa-ask-btn").addEventListener("click", () => openAskQuestionModal());
  updateQABadge();
}

function openAskQuestionModal() {
  $("#modal-root").innerHTML = `
    <div class="modal-overlay" id="qa-ask-overlay">
      <div class="modal">
        <h3>💬 Đặt câu hỏi mới</h3>
        <p>Chụp/tải ảnh câu hỏi bạn chưa giải được, người giải bài sẽ vào hỗ trợ bạn.</p>
        <div class="field">
          <label>Ảnh câu hỏi</label><br/>
          <label class="btn btn-outline btn-sm">📷 Chọn ảnh<input type="file" accept="image/*" id="qa-ask-file" class="hidden" /></label>
          <div id="qa-ask-preview" style="margin-top:10px"></div>
        </div>
        <div class="field">
          <label>Mô tả thêm (không bắt buộc)</label>
          <textarea id="qa-ask-text" rows="3" placeholder="vd: Em không biết làm bước tính đạo hàm ạ..."></textarea>
        </div>
        <div class="field">
          <label>Ai xem được câu hỏi này?</label>
          <select id="qa-ask-visibility" class="select" style="width:100%">
            <option value="public">🌍 Công khai — mọi học sinh đều xem được</option>
            <option value="private">🔒 Riêng tư — chỉ tôi và người giải bài</option>
          </select>
        </div>
        <p id="qa-ask-err" class="error-box hidden"></p>
        <div class="modal-actions">
          <button class="btn btn-outline" id="qa-ask-cancel">Huỷ</button>
          <button class="btn btn-primary" id="qa-ask-submit">Gửi câu hỏi</button>
        </div>
      </div>
    </div>`;
  let pendingImage = null;
  $("#qa-ask-overlay").addEventListener("click", (e) => { if (e.target.id === "qa-ask-overlay") $("#modal-root").innerHTML = ""; });
  $("#qa-ask-cancel").addEventListener("click", () => { $("#modal-root").innerHTML = ""; });
  $("#qa-ask-file").addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (!f) return;
    compressImageFile(f, (dataUrl) => {
      pendingImage = dataUrl;
      $("#qa-ask-preview").innerHTML = dataUrl ? `<img src="${dataUrl}" style="max-width:100%;border-radius:8px;border:1px solid var(--line)" />` : "";
    });
  });
  $("#qa-ask-submit").addEventListener("click", async () => {
    const text = $("#qa-ask-text").value.trim();
    const errEl = $("#qa-ask-err");
    if (!pendingImage && !text) {
      errEl.textContent = "Hãy chọn ảnh hoặc mô tả câu hỏi.";
      errEl.classList.remove("hidden");
      return;
    }
    const btn = $("#qa-ask-submit");
    btn.disabled = true; btn.textContent = "Đang gửi…";
    const row = {
      id: "qa_" + Date.now(),
      username: CURRENT_USER.username,
      name: CURRENT_USER.name,
      image: pendingImage || "",
      text,
      status: "pending",
      visibility: $("#qa-ask-visibility").value,
      created_at: Date.now(),
    };
    try {
      await DBX.insert("qa_questions", row);
      QA_QUESTIONS.push(row);
      $("#modal-root").innerHTML = "";
      toast("Đã gửi câu hỏi — chờ người giải bài phản hồi nhé!");
      go("qadetail", row.id);
    } catch (e) {
      btn.disabled = false; btn.textContent = "Gửi câu hỏi";
      errEl.textContent = "Không gửi được: " + e.message + " — kiểm tra đã tạo bảng qa_questions chưa";
      errEl.classList.remove("hidden");
    }
  });
}

function renderQADetail(main, id) { renderQADetailAsync(main, id); }
async function renderQADetailAsync(main, id) {
  await syncView(main, ["qa_questions", "qa_messages"]);
  if (VIEW !== "qadetail") return;
  const q = QA_QUESTIONS.find((x) => x.id === id);
  if (!q) { main.innerHTML = `<div class="empty"><div class="big">🚫</div>Không tìm thấy câu hỏi này.</div>`; return; }

  const solver = canSolve(CURRENT_USER);
  const isOwner = CURRENT_USER.username === q.username;
  if (q.visibility === "private" && !solver && !isOwner) {
    main.innerHTML = `<div class="empty"><div class="big">🔒</div>Câu hỏi này ở chế độ riêng tư, bạn không có quyền xem.</div>`;
    return;
  }
  const canChat = solver || isOwner;
  const msgs = QA_MESSAGES.filter((m) => m.question_id === id).sort((a, b) => (+a.created_at) - (+b.created_at));

  main.innerHTML = `
    <button class="btn btn-outline btn-sm" id="qa-back" style="margin-bottom:16px">← Quay lại danh sách</button>
    <div class="qa-detail-card">
      <div class="qa-detail-head">
        <div style="display:flex;align-items:center;gap:10px">
          ${avatarHtml(q.username, q.name, 40)}
          <div>
            <div class="qa-card-name">${esc(q.name)}</div>
            <div class="qa-card-meta">${new Date(+q.created_at).toLocaleString("vi-VN")}</div>
          </div>
        </div>
        <span class="chip ${q.status === "done" ? "chip-green" : "chip-gold"}" id="qa-status-chip">${q.status === "done" ? "✓ Đã xong" : "⏳ Chờ xử lý"}</span>
      </div>
      ${q.visibility === "private" ? `<span class="chip chip-pen" style="margin-bottom:12px;display:inline-block">🔒 Riêng tư</span>` : ""}
      ${q.image ? `<img class="qa-detail-image" src="${q.image}" />` : ""}
      ${q.text ? `<p class="qa-detail-text">${esc(q.text)}</p>` : ""}
      ${solver ? `<button class="btn btn-outline btn-sm" id="qa-toggle-status">${q.status === "done" ? "↺ Mở lại" : "✓ Đánh dấu đã xong"}</button>` : ""}
    </div>

    <div class="comment-list" id="qa-chat-list">
      ${msgs.length === 0 ? `<p class="hint" style="padding:8px 0">Chưa có tin nhắn nào.</p>` : msgs.map((m) => `
        <div class="comment-item">
          ${avatarHtml(m.username, m.name, 32)}
          <div class="comment-body">
            <div class="comment-head">
              <span class="comment-name">${esc(m.name)}${m.role === "solver" || m.role === "admin" ? ' <span class="badge-solver">GIẢI BÀI</span>' : ""}</span>
              <span class="comment-time">${new Date(+m.created_at).toLocaleString("vi-VN")}</span>
            </div>
            ${m.image ? `<img src="${m.image}" style="max-width:260px;border-radius:8px;margin-top:6px;border:1px solid var(--line)" />` : ""}
            ${m.text ? `<div class="comment-text">${esc(m.text)}</div>` : ""}
          </div>
        </div>`).join("")}
    </div>

    ${canChat ? `
    <div class="comment-compose" style="margin-top:14px">
      <textarea id="qa-reply-text" rows="2" placeholder="${solver ? "Nhập hướng dẫn / lời giải..." : "Nhắn thêm cho người giải bài..."}"></textarea>
      <div id="qa-reply-preview" style="margin:8px 0"></div>
      <div style="display:flex;gap:8px;justify-content:space-between;align-items:center">
        <label class="btn btn-outline btn-sm">📷 Ảnh<input type="file" accept="image/*" id="qa-reply-file" class="hidden" /></label>
        <button class="btn btn-primary btn-sm" id="qa-reply-send">Gửi</button>
      </div>
    </div>` : `<p class="hint" style="margin-top:14px">Chỉ người hỏi và người giải bài mới có thể nhắn trong đây.</p>`}
  `;

  $("#qa-back").addEventListener("click", () => go("qa"));

  if (solver) {
    $("#qa-toggle-status").addEventListener("click", async () => {
      const updated = { ...q, status: q.status === "done" ? "pending" : "done" };
      try {
        await DBX.remove("qa_questions", "id", q.id);
        await DBX.insert("qa_questions", updated);
        const idx = QA_QUESTIONS.findIndex((x) => x.id === q.id);
        if (idx > -1) QA_QUESTIONS[idx] = updated;
        toast(updated.status === "done" ? "Đã đánh dấu xong" : "Đã mở lại câu hỏi");
        renderQADetail(main, id);
      } catch (e) { toast("Lỗi: " + e.message, true); }
    });
  }

  if (canChat) {
    let pendingImage = null;
    $("#qa-reply-file").addEventListener("change", (e) => {
      const f = e.target.files[0];
      if (!f) return;
      compressImageFile(f, (dataUrl) => {
        pendingImage = dataUrl;
        $("#qa-reply-preview").innerHTML = dataUrl ? `<img src="${dataUrl}" style="max-width:200px;border-radius:8px;border:1px solid var(--line)" />` : "";
      });
    });
    $("#qa-reply-send").addEventListener("click", async () => {
      const text = $("#qa-reply-text").value.trim();
      if (!text && !pendingImage) return;
      const btn = $("#qa-reply-send");
      btn.disabled = true;
      const row = {
        id: "qam_" + Date.now(),
        question_id: id,
        username: CURRENT_USER.username,
        name: CURRENT_USER.name,
        role: CURRENT_USER.role || "user",
        text,
        image: pendingImage || "",
        created_at: Date.now(),
      };
      try {
        await DBX.insert("qa_messages", row);
        QA_MESSAGES.push(row);
        renderQADetail(main, id);
      } catch (e) {
        btn.disabled = false;
        toast("Không gửi được: " + e.message, true);
      }
    });
  }
}

/* =====================================================
   BÁO LỖI CÂU HỎI (học sinh báo, admin xem trong Quản trị)
===================================================== */
/* Đề có thể bị trộn theo từng lượt thi — cần quy đổi chỉ số câu
   đang hiển thị về đúng chỉ số câu GỐC trong đề để admin sửa đúng chỗ. */
function mapToOriginalIndex(part, shownIndex, orderMap) {
  if (!orderMap) return shownIndex;
  if (part === "p1") {
    const m = orderMap.p1 && orderMap.p1[shownIndex];
    return m ? m.q : shownIndex;
  }
  const arr = orderMap[part];
  return arr && arr[shownIndex] != null ? arr[shownIndex] : shownIndex;
}

async function submitQuestionReport(examId, examTitle, part, origIndex, questionText, reason, detail) {
  const row = {
    id: "rpt_" + Date.now(),
    exam_id: examId,
    exam_title: examTitle,
    part,
    q_index: origIndex,
    question_text: questionText,
    username: CURRENT_USER.username,
    name: CURRENT_USER.name,
    reason,
    detail: detail || "",
    resolved: false,
    created_at: Date.now(),
  };
  await DBX.insert("question_reports", row);
}

function openReportModal(examId, examTitle, part, shownIndex, orderMap, questionText) {
  const origIndex = mapToOriginalIndex(part, shownIndex, orderMap);
  $("#modal-root").innerHTML = `
    <div class="modal-overlay" id="rpt-overlay">
      <div class="modal">
        <h3>🚩 Báo lỗi câu hỏi</h3>
        <p style="font-size:12.5px;color:var(--pencil);margin-bottom:14px;line-height:1.5">${esc(PART_LABELS[part])} · Câu ${shownIndex + 1}: ${esc(String(questionText).slice(0, 110))}${String(questionText).length > 110 ? "…" : ""}</p>
        <div class="field">
          <label>Loại lỗi</label>
          <select id="rpt-reason" class="select" style="width:100%">
            <option value="Đáp án sai">Đáp án sai</option>
            <option value="Đề bài không rõ ràng">Đề bài không rõ ràng / thiếu dữ kiện</option>
            <option value="Thiếu hình ảnh">Thiếu hình ảnh / hình lỗi</option>
            <option value="Lỗi chính tả">Lỗi chính tả, đánh máy</option>
            <option value="Khác">Khác</option>
          </select>
        </div>
        <div class="field">
          <label>Mô tả thêm <span style="font-weight:400;color:var(--pencil)">(tuỳ chọn)</span></label>
          <textarea id="rpt-detail" rows="3" placeholder="Ví dụ: đáp án đúng phải là B chứ không phải A…"></textarea>
        </div>
        <div class="modal-actions">
          <button class="btn btn-ghost btn-sm" id="rpt-cancel">Huỷ</button>
          <button class="btn btn-primary btn-sm" id="rpt-send">Gửi báo cáo</button>
        </div>
      </div>
    </div>`;
  $("#rpt-cancel").addEventListener("click", closeModal);
  $("#rpt-overlay").addEventListener("click", (e) => e.target.id === "rpt-overlay" && closeModal());
  $("#rpt-send").addEventListener("click", async () => {
    const btn = $("#rpt-send");
    btn.disabled = true; btn.textContent = "Đang gửi…";
    try {
      await submitQuestionReport(examId, examTitle, part, origIndex, questionText, $("#rpt-reason").value, $("#rpt-detail").value.trim());
      closeModal();
      toast("Đã gửi báo cáo, cảm ơn bạn!");
    } catch (e) {
      toast("Không gửi được: " + e.message, true);
      btn.disabled = false; btn.textContent = "Gửi báo cáo";
    }
  });
}

/* Gắn nút 🚩 báo lỗi cho tất cả câu hỏi trong 1 trang (làm bài hoặc xem lại) */
function bindReportButtons(root, examId, examTitle, orderMap) {
  $$("[data-report-part]", root).forEach((b) =>
    b.addEventListener("click", (e) => {
      e.preventDefault();
      const part = b.dataset.reportPart, idx = +b.dataset.reportIdx, text = b.dataset.reportText;
      openReportModal(examId, examTitle, part, idx, orderMap, text);
    })
  );
}

/* =====================================================
   QUẢN LÝ ẢNH MINH HỌA TỪNG CÂU (dùng cho upload & sửa đề)
   Ảnh tải lên được nén rồi lưu base64 ngay trong đề (SQL)
===================================================== */
const PART_LABELS = { p1: "Phần I", p2: "Phần II", p3: "Phần III" };

function compressImageFile(file, cb, maxW) {
  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, (maxW || 900) / img.width);
      const cv = document.createElement("canvas");
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      const ctx = cv.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(img, 0, 0, cv.width, cv.height);
      cb(cv.toDataURL("image/jpeg", 0.85));
    };
    img.onerror = () => cb(null);
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

/* Vẽ danh sách câu hỏi kèm nút tải/xóa ảnh.
   parsed: đề đã đọc · imgs: ảnh tải lên trong web {p1:{0:dataURL},...} */
function renderImageManager(box, parsed, imgs) {
  const rows = [];
  for (const p of ["p1", "p2", "p3"]) {
    (parsed[p] || []).forEach((q, i) => {
      const upImg = imgs[p][i];
      const linkImg = !upImg && q.img ? q.img : null;
      const eff = upImg || linkImg;
      rows.push(`
        <div class="imgq-row">
          <div class="imgq-info">
            <div class="imgq-label">${PART_LABELS[p]} · Câu ${i + 1}</div>
            <div class="imgq-q">${esc(String(q.q).slice(0, 70))}${String(q.q).length > 70 ? "…" : ""}</div>
          </div>
          ${eff ? `<img class="imgq-thumb" src="${eff}" alt="" />` : `<span class="imgq-none">chưa có ảnh</span>`}
          <div class="imgq-actions">
            <label class="btn btn-outline btn-sm">📷 ${eff ? "Đổi ảnh" : "Tải ảnh"}<input type="file" accept="image/*" class="hidden" data-imgp="${p}" data-imgi="${i}" /></label>
            ${upImg ? `<button class="btn btn-danger btn-sm" data-imgdel-p="${p}" data-imgdel-i="${i}">Xóa</button>` : ""}
            ${linkImg ? `<span class="imgq-note">từ link trong nội dung</span>` : ""}
          </div>
        </div>`);
    });
  }
  box.innerHTML = rows.length
    ? `<div class="imgq-list">${rows.join("")}</div>`
    : `<p class="hint">Chưa có câu hỏi nào — hãy đọc thử đề trước.</p>`;

  $$("[data-imgp]", box).forEach((inp) =>
    inp.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      compressImageFile(f, (dataUrl) => {
        if (!dataUrl) { toast("Không đọc được file ảnh", true); return; }
        imgs[inp.dataset.imgp][inp.dataset.imgi] = dataUrl;
        renderImageManager(box, parsed, imgs);
      });
    })
  );
  $$("[data-imgdel-p]", box).forEach((b) =>
    b.addEventListener("click", () => {
      delete imgs[b.dataset.imgdelP][b.dataset.imgdelI];
      renderImageManager(box, parsed, imgs);
    })
  );
}

/* Gộp ảnh tải lên vào đề trước khi lưu (ảnh tải lên ưu tiên hơn link trong nội dung) */
function applyImages(parsed, imgs) {
  for (const p of ["p1", "p2", "p3"]) {
    (parsed[p] || []).forEach((q, i) => { if (imgs[p][i]) q.img = imgs[p][i]; });
  }
  return parsed;
}

/* =====================================================
   CHỈNH SỬA ĐỀ THI (chỉ admin)
===================================================== */
function renderEditExam(main, examId) {
  if (CURRENT_USER.role !== "admin") return go("exams");
  const ex = EXAMS.find((e) => e.id === examId);
  if (!ex) return go("admin");

  main.innerHTML = `
    <div style="max-width:760px;margin:0 auto">
      <button class="btn btn-ghost btn-sm" id="edit-back" style="margin-bottom:16px">← Quay lại Quản trị</button>
      <div class="card">
        <h2 class="page-title" style="font-size:22px;margin-bottom:18px">✏️ Chỉnh sửa đề thi</h2>

        <div class="field"><label>Tiêu đề đề thi</label><input id="ed-title" value="${esc(ex.title)}" /></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="field"><label>Môn học</label><input id="ed-subject" value="${esc(ex.subject)}" /></div>
          <div class="field"><label>⏱ Thời gian thi (phút)</label><input id="ed-duration" type="number" min="1" max="300" value="${ex.duration}" /></div>
        </div>
        <div class="field">
          <label>Link PDF đề gốc <span style="font-weight:400;color:var(--pencil)">(tùy chọn — hiện nút "Xem đề gốc" khi thi)</span></label>
          <input id="ed-source" value="${esc(ex.sourceFile || "")}" placeholder="https://drive.google.com/…" />
        </div>
        <label class="shuffle-check">
          <input type="checkbox" id="ed-shuffle" ${ex.shuffle ? "checked" : ""} />
          🔀 Trộn thứ tự câu hỏi &amp; đáp án ngẫu nhiên cho mỗi lượt thi <span style="font-weight:400;color:var(--pencil)">(chống quay bài — đề gốc không đổi)</span>
        </label>
        <div class="field">
          <label>Nội dung câu hỏi <span style="font-weight:400;color:var(--pencil)">(theo định dạng chuẩn, sửa trực tiếp rồi lưu)</span></label>
          <textarea id="ed-content" rows="18">${esc(examToText(ex))}</textarea>
        </div>

        <div class="field">
          <label>🖼 Ảnh minh họa từng câu <span style="font-weight:400;color:var(--pencil)">(tải ảnh thẳng trong web, ảnh lưu cùng đề)</span></label>
          <p class="hint" style="margin-bottom:8px">Nếu vừa thêm/xóa câu ở khung nội dung, bấm "Kiểm tra nội dung" để làm mới danh sách câu bên dưới trước khi gắn ảnh.</p>
          <div id="ed-imgmgr"></div>
        </div>

        <p id="ed-err" class="error-box hidden"></p>
        <p id="ed-preview" class="success-box hidden"></p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-outline" id="ed-check">Kiểm tra nội dung</button>
          <button class="btn btn-primary" id="ed-save">Lưu thay đổi</button>
        </div>
        <p class="hint" style="margin-top:12px;color:var(--pencil);font-size:12px">
          Lưu ý: điểm các lượt thi đã nộp trước đó vẫn giữ nguyên, không bị chấm lại theo đề mới.
        </p>
      </div>
    </div>`;

  const err = (m) => { const el = $("#ed-err"); el.textContent = m; el.classList.remove("hidden"); $("#ed-preview").classList.add("hidden"); };
  const hideMsg = () => { $("#ed-err").classList.add("hidden"); $("#ed-preview").classList.add("hidden"); };

  // Ảnh tải lên trong web (base64) tách riêng khỏi văn bản
  const imgs = { p1: {}, p2: {}, p3: {} };
  ["p1", "p2", "p3"].forEach((p) => (ex[p] || []).forEach((q, i) => { if (isDataImg(q.img)) imgs[p][i] = q.img; }));
  let lastParsed = ex;
  renderImageManager($("#ed-imgmgr"), lastParsed, imgs);

  const buildAndParse = () => {
    const title = $("#ed-title").value.trim();
    const subject = $("#ed-subject").value.trim() || "Chưa rõ";
    const duration = parseInt($("#ed-duration").value, 10);
    if (!title) throw new Error("Tiêu đề không được để trống.");
    if (!duration || duration < 1) throw new Error("Thời gian thi phải là số phút lớn hơn 0.");
    const parsed = parseExamText($("#ed-content").value);
    parsed.title = title;
    parsed.subject = subject;
    parsed.duration = duration;
    const src = $("#ed-source").value.trim();
    parsed.sourceFile = src || null;
    parsed.shuffle = $("#ed-shuffle").checked;
    return parsed;
  };

  $("#edit-back").addEventListener("click", () => go("admin"));

  $("#ed-check").addEventListener("click", () => {
    hideMsg();
    try {
      const p = buildAndParse();
      lastParsed = p;
      renderImageManager($("#ed-imgmgr"), lastParsed, imgs);
      const nItems = p.p2.reduce((s, q) => s + q.items.length, 0);
      const el = $("#ed-preview");
      el.textContent = `✓ Nội dung hợp lệ — ${p.duration} phút · Phần I: ${p.p1.length} câu · Phần II: ${p.p2.length} câu (${nItems} ý) · Phần III: ${p.p3.length} câu`;
      el.classList.remove("hidden");
    } catch (e) { err(e.message); }
  });

  $("#ed-save").addEventListener("click", async () => {
    hideMsg();
    let parsed;
    try { parsed = buildAndParse(); } catch (e) { return err(e.message); }
    applyImages(parsed, imgs);
    const updated = {
      ...parsed,
      id: ex.id,
      uploader: ex.uploader,
      createdAt: ex.createdAt,
    };
    const btn = $("#ed-save");
    btn.disabled = true; btn.textContent = "Đang lưu…";
    try {
      await DBX.remove("exams", "id", ex.id);
      await DBX.insert("exams", examToRow(updated));
      const idx = EXAMS.findIndex((e) => e.id === ex.id);
      if (idx > -1) EXAMS[idx] = updated;
      toast('Đã cập nhật đề "' + updated.title + '"');
      go("admin");
    } catch (e) {
      btn.disabled = false; btn.textContent = "Lưu thay đổi";
      err("Không lưu được: " + e.message);
    }
  });
}

/* =====================================================
   CHỈNH SỬA BÀI GIẢNG (admin hoặc người đăng)
===================================================== */
function renderEditLesson(main, lessonId) {
  const ls = LESSONS.find((l) => l.id === lessonId);
  if (!ls) return go("lessons");
  if (CURRENT_USER.role !== "admin" && CURRENT_USER.username !== ls.uploader) return go("lessons");

  // Bản nháp khởi tạo từ bài giảng hiện tại
  const draft = {
    videoType: ls.videoType || null,
    videoUrl: ls.videoUrl || "",
    videoData: ls.videoData || null,
    thumb: ls.thumb || null,
    docs: (ls.docs || []).map((d) => ({ ...d })),
  };

  main.innerHTML = `
    <div style="max-width:680px;margin:0 auto">
      <button class="btn btn-ghost btn-sm" id="el-back" style="margin-bottom:16px">← Quay lại</button>
      <div class="card">
        <h2 class="page-title" style="font-size:22px;margin-bottom:18px">✏️ Chỉnh sửa bài giảng</h2>

        <div class="field"><label>Tên bài giảng</label><input id="el-title" value="${esc(ls.title)}" /></div>
        <div class="field"><label>Môn học</label><input id="el-subject" value="${esc(ls.subject)}" /></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="field">
            <label>Chương</label>
            <input id="el-chapter" list="el-chapter-list" value="${esc(ls.chapter || "")}" />
            <datalist id="el-chapter-list">
              ${[...new Set(LESSONS.map((l) => l.chapter).filter(Boolean))].sort(naturalVi).map((c) => `<option value="${esc(c)}"></option>`).join("")}
            </datalist>
          </div>
          <div class="field">
            <label>Chuyên mục</label>
            <input id="el-category" list="el-cat-list" value="${esc(ls.category || "")}" />
            <datalist id="el-cat-list">
              ${[...new Set([...LESSON_CATEGORIES, ...LESSONS.map((l) => l.category).filter(Boolean)])].map((c) => `<option value="${esc(c)}"></option>`).join("")}
            </datalist>
          </div>
        </div>
        <div class="field">
          <label>Bài <span style="font-weight:400;color:var(--pencil)">(tùy chọn — khi một bài có nhiều phần)</span></label>
          <input id="el-lesson" list="el-lesson-list" value="${esc(ls.lesson || "")}" />
          <datalist id="el-lesson-list">
            ${[...new Set(LESSONS.map((l) => l.lesson).filter(Boolean))].sort(naturalVi).map((c) => `<option value="${esc(c)}"></option>`).join("")}
          </datalist>
        </div>
        <div class="field"><label>Mô tả nội dung</label><textarea id="el-desc" rows="4" style="font-family:var(--font-body);font-size:14px">${esc(ls.description || "")}</textarea></div>

        <div class="field">
          <label>Video bài giảng</label>
          <input id="el-video-url" value="${esc(ls.videoType === "file" ? "" : (ls.videoUrl || ""))}" placeholder="Dán link YouTube / Streamable / .mp4…" />
          <p class="hint">${ls.videoType === "file" ? "Đang dùng video tải lên trực tiếp. Dán link mới vào ô trên sẽ thay thế video hiện tại." : ls.videoType ? "Sửa link ở ô trên để đổi video." : "Bài giảng chưa có video."}</p>
        </div>

        <div class="field">
          <label>Ảnh bìa (thumbnail)</label>
          <div id="el-thumb-status"></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <label class="btn btn-outline btn-sm">🖼 ${ls.thumb ? "Đổi ảnh bìa" : "Tải ảnh bìa"}<input type="file" accept="image/*" id="el-thumb-file" class="hidden" /></label>
            <button type="button" class="btn btn-ghost btn-sm ${ls.thumb ? "" : "hidden"}" id="el-thumb-del">Xóa ảnh bìa</button>
          </div>
        </div>

        <div class="field">
          <label>Tài liệu đính kèm</label>
          <div class="attach-list" id="el-doc-list"></div>
          <p class="hint" style="margin-top:10px">Thêm tài liệu mới bằng link (Drive, Docs…) hoặc file (tối đa ${DB.formatSize(MAX_DOC)}):</p>
          <div style="display:grid;gap:8px;margin-top:6px">
            <input id="el-doc-link-name" placeholder="Tên hiển thị" />
            <div style="display:flex;gap:8px">
              <input id="el-doc-link" placeholder="https://drive.google.com/…" style="flex:1" />
              <button type="button" class="btn btn-outline btn-sm" id="el-add-link">Thêm link</button>
            </div>
            <label class="file-drop" id="el-doc-drop">
              <input type="file" id="el-doc-file" multiple />
              Kéo thả tài liệu vào đây hoặc <b>chọn file</b>
            </label>
          </div>
        </div>

        <p id="el-err" class="error-box hidden"></p>
        <button class="btn btn-primary" id="el-save">Lưu thay đổi</button>
      </div>
    </div>`;

  const err = (m) => { const el = $("#el-err"); el.textContent = m; el.classList.remove("hidden"); };
  const hideErr = () => $("#el-err").classList.add("hidden");

  const showElThumb = () => {
    $("#el-thumb-status").innerHTML = draft.thumb
      ? `<img src="${draft.thumb}" alt="" style="max-width:220px;border-radius:9px;border:1px solid var(--line);margin-bottom:8px;display:block" />`
      : `<p class="hint" style="margin-bottom:8px">${lessonThumb({ videoUrl: draft.videoUrl }) ? "Đang dùng ảnh bìa tự động từ YouTube." : "Chưa có ảnh bìa."}</p>`;
    $("#el-thumb-del").classList.toggle("hidden", !draft.thumb);
  };
  showElThumb();
  $("#el-thumb-file").addEventListener("change", (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    compressImageFile(f, (d) => { if (d) { draft.thumb = d; showElThumb(); } });
  });
  $("#el-thumb-del").addEventListener("click", () => { draft.thumb = null; showElThumb(); });

  const renderDocs = () => {
    $("#el-doc-list").innerHTML = draft.docs.length ? draft.docs.map((d, i) => `
      <div class="attach-item">${d.link ? "🔗" : "📄"} ${esc(d.name)} <span style="color:var(--pencil)">${d.link ? "(link)" : "(" + DB.formatSize(d.size) + ")"}</span>
        <button class="x" data-elrm="${i}" title="Xoá">✕</button>
      </div>`).join("") : `<p class="hint">Chưa có tài liệu.</p>`;
    $$("[data-elrm]").forEach((b) => b.addEventListener("click", () => {
      draft.docs.splice(+b.dataset.elrm, 1);
      renderDocs();
    }));
  };
  renderDocs();

  $("#el-add-link").addEventListener("click", () => {
    hideErr();
    const url = $("#el-doc-link").value.trim();
    if (!url) return err("Hãy dán link tài liệu trước.");
    if (!/^https?:\/\//i.test(url)) return err("Link phải bắt đầu bằng http:// hoặc https://");
    let name = $("#el-doc-link-name").value.trim() || (/drive\.google\.com/i.test(url) ? "Tài liệu Google Drive" : "Tài liệu (link)");
    draft.docs.push({ name, link: url });
    $("#el-doc-link").value = ""; $("#el-doc-link-name").value = "";
    renderDocs();
  });

  const onDocFiles = (files) => {
    hideErr();
    for (const f of files) {
      if (f.size > MAX_DOC) { err(`"${f.name}" vượt quá ${DB.formatSize(MAX_DOC)}.`); continue; }
      const reader = new FileReader();
      reader.onload = () => { draft.docs.push({ name: f.name, size: f.size, data: reader.result }); renderDocs(); };
      reader.readAsDataURL(f);
    }
  };
  $("#el-doc-file").addEventListener("change", (e) => onDocFiles(e.target.files));
  setupDrop($("#el-doc-drop"), (f) => onDocFiles([f]));

  $("#el-back").addEventListener("click", () => go("lesson", ls.id));

  $("#el-save").addEventListener("click", async () => {
    hideErr();
    const title = $("#el-title").value.trim();
    if (!title) return err("Tên bài giảng không được để trống.");

    // Xử lý video: link mới thay thế, để trống thì giữ video cũ
    const url = $("#el-video-url").value.trim();
    if (url) {
      const yt = toYouTubeEmbed(url);
      const stm = url.match(/streamable\.com\/(?:e\/)?([\w]+)/i);
      if (yt) { draft.videoType = "youtube"; draft.videoUrl = yt; draft.videoData = null; }
      else if (stm) { draft.videoType = "youtube"; draft.videoUrl = "https://streamable.com/e/" + stm[1]; draft.videoData = null; }
      else if (/\.(mp4|webm|ogg)(\?|$)/i.test(url)) { draft.videoType = "url"; draft.videoUrl = url; draft.videoData = null; }
      else { draft.videoType = "youtube"; draft.videoUrl = url; draft.videoData = null; }
    }
    if (!draft.videoType && draft.docs.length === 0) return err("Bài giảng cần ít nhất một video hoặc một tài liệu.");

    const updated = {
      ...ls,
      title,
      subject: $("#el-subject").value.trim() || "Chưa rõ",
      chapter: $("#el-chapter").value.trim(),
      category: $("#el-category").value.trim() || "Khác",
      lesson: $("#el-lesson").value.trim(),
      description: $("#el-desc").value.trim(),
      videoType: draft.videoType,
      videoUrl: draft.videoUrl,
      videoData: draft.videoData,
      thumb: draft.thumb || null,
      docs: draft.docs,
    };

    const btn = $("#el-save");
    btn.disabled = true; btn.textContent = "Đang lưu…";
    try {
      await DBX.remove("lessons", "id", ls.id);
      await DBX.insert("lessons", lessonToRow(updated));
      const idx = LESSONS.findIndex((l) => l.id === ls.id);
      if (idx > -1) LESSONS[idx] = updated;
      toast('Đã cập nhật bài giảng "' + title + '"');
      go("lesson", ls.id);
    } catch (e) {
      btn.disabled = false; btn.textContent = "Lưu thay đổi";
      err("Không lưu được: " + e.message);
    }
  });
}

/* =====================================================
   ĐỔI MẬT KHẨU
===================================================== */
function renderChangePassword(main) {
  const isAuthAccount = CURRENT_USER.password === "supabase-auth";
  main.innerHTML = `
    <div style="max-width:440px;margin:0 auto">
      <button class="btn btn-ghost btn-sm" id="pw-back" style="margin-bottom:16px">← Quay lại</button>
      <div class="card">
        <h2 class="page-title" style="font-size:22px;margin-bottom:6px">🔑 Đổi mật khẩu</h2>
        <p class="card-meta" style="margin-bottom:18px">
          Tài khoản: <b style="color:var(--ink)">${esc(CURRENT_USER.username)}</b>
          ${isAuthAccount ? ` · xác minh qua email <b style="color:var(--ink)">${esc(CURRENT_USER.email || "")}</b>` : ""}
        </p>

        <div class="field"><label>Mật khẩu hiện tại</label><input id="pw-current" type="password" placeholder="••••••••" autocomplete="current-password" /></div>
        <div class="field"><label>Mật khẩu mới <span style="font-weight:400;color:var(--pencil)">(tối thiểu 6 ký tự)</span></label><input id="pw-new1" type="password" placeholder="••••••••" autocomplete="new-password" /></div>
        <div class="field"><label>Nhập lại mật khẩu mới</label><input id="pw-new2" type="password" placeholder="••••••••" autocomplete="new-password" /></div>

        <p id="pw-err" class="error-box hidden"></p>
        <p id="pw-success" class="success-box hidden"></p>
        <button class="btn btn-primary btn-block" id="pw-submit">Đổi mật khẩu</button>
      </div>
    </div>`;

  $("#pw-back").addEventListener("click", () => go("exams"));

  const err = (m) => { $("#pw-err").textContent = m; $("#pw-err").classList.remove("hidden"); $("#pw-success").classList.add("hidden"); };
  const ok = (m) => { $("#pw-success").textContent = m; $("#pw-success").classList.remove("hidden"); $("#pw-err").classList.add("hidden"); };

  $("#pw-submit").addEventListener("click", async () => {
    $("#pw-err").classList.add("hidden"); $("#pw-success").classList.add("hidden");
    const cur = $("#pw-current").value;
    const pw1 = $("#pw-new1").value;
    const pw2 = $("#pw-new2").value;
    if (!cur || !pw1 || !pw2) return err("Vui lòng điền đầy đủ các ô.");
    if (pw1.length < 6) return err("Mật khẩu mới cần tối thiểu 6 ký tự.");
    if (pw1 !== pw2) return err("Mật khẩu xác nhận không khớp.");

    const btn = $("#pw-submit");
    btn.disabled = true; btn.textContent = "Đang xử lý…";
    try {
      if (isAuthAccount) {
        if (!CURRENT_USER.email) throw new Error("Tài khoản thiếu email nên không thể đổi mật khẩu qua hệ thống xác minh.");
        let res;
        try { res = await AUTH.signIn(CURRENT_USER.email, cur); }
        catch (e) { throw new Error("Mật khẩu hiện tại không đúng."); }
        await AUTH.updatePassword(res.access_token, pw1);
      } else {
        if (CURRENT_USER.password !== cur) throw new Error("Mật khẩu hiện tại không đúng.");
        const updated = { ...CURRENT_USER, password: pw1 };
        await DBX.remove("users", "username", CURRENT_USER.username);
        try { await DBX.insert("users", updated); }
        catch (e1) { const fb = { ...updated }; delete fb.session; await DBX.insert("users", fb); }
        CURRENT_USER.password = pw1;
        const idx = USERS.findIndex((u) => u.username === CURRENT_USER.username);
        if (idx > -1) USERS[idx] = updated;
      }
      ok("✓ Đã đổi mật khẩu thành công!");
      $("#pw-current").value = ""; $("#pw-new1").value = ""; $("#pw-new2").value = "";
      toast("Đổi mật khẩu thành công");
    } catch (e) {
      err(e.message);
    }
    btn.disabled = false; btn.textContent = "Đổi mật khẩu";
  });
}

/* =====================================================
   HỘP THOẠI & THÔNG BÁO
===================================================== */
function confirmModal(title, message, onConfirm) {
  $("#modal-root").innerHTML = `
    <div class="modal-overlay" id="modal-overlay">
      <div class="modal">
        <h3>${esc(title)}</h3>
        <p>${esc(message)}</p>
        <div class="modal-actions">
          <button class="btn btn-ghost btn-sm" id="modal-cancel">Hủy</button>
          <button class="btn btn-danger btn-sm" id="modal-ok">Đồng ý</button>
        </div>
      </div>
    </div>`;
  $("#modal-cancel").addEventListener("click", closeModal);
  $("#modal-overlay").addEventListener("click", (e) => e.target.id === "modal-overlay" && closeModal());
  $("#modal-ok").addEventListener("click", () => { closeModal(); onConfirm(); });
}
function closeModal() { $("#modal-root").innerHTML = ""; }

let toastTimer = null;
function toast(msg, isErr) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("err", !!isErr);
  el.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add("hidden"), 3000);
}
