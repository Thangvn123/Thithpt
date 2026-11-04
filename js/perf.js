/* =====================================================
   perf.js — Tải video bài giảng theo yêu cầu (lazy)
   Danh sách bài giảng không còn tải video_data; chỉ khi mở xem
   hoặc sửa một bài thì mới tải riêng cột đó của bài ấy.
===================================================== */
(function () {
  async function ensureFull(ls) {
    if (!ls || !ls._lite) return;
    try {
      const res = await fetch(DBX.base + "lessons?id=eq." + encodeURIComponent(ls.id) + "&select=video_data", { headers: DBX.headers });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const rows = await res.json();
      ls.videoData = (rows[0] && rows[0].video_data) || null;
      ls._lite = false;
    } catch (e) {
      console.error(e);
      toast("Không tải được video bài giảng: " + e.message, true);
      throw e;
    }
  }
  const loadingHtml = '<div class="loading"><div class="spinner"></div>Đang tải bài giảng…</div>';

  function wrap(name, viewName) {
    const orig = window[name];
    if (typeof orig !== "function") return;
    window[name] = function (main, id) {
      const ls = LESSONS.find((l) => l.id === id);
      if (ls && ls._lite && ls.videoType === "file") {
        main.innerHTML = loadingHtml;
        ensureFull(ls).then(() => { if (VIEW === viewName) orig(main, id); }).catch(() => go("lessons"));
      } else if (ls && ls._lite && viewName === "editlesson") {
        ensureFull(ls).then(() => { if (VIEW === viewName) orig(main, id); }).catch(() => go("lessons"));
      } else orig(main, id);
    };
  }
  wrap("renderLessonDetail", "lesson");
  wrap("renderEditLesson", "editlesson");
})();
