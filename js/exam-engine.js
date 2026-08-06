/* =====================================================
   exam-engine.js — Đọc file đề (.txt / .json)
   và chấm điểm theo quy chế thi tốt nghiệp THPT 2025
   - Phần I  (trắc nghiệm A B C D): 0,25đ / câu
   - Phần II (đúng/sai 4 ý): 1 ý = 0,1 · 2 ý = 0,25
                              3 ý = 0,5 · 4 ý = 1,0
   - Phần III (trả lời ngắn): 0,25đ / câu
   Điểm quy về thang 10.
===================================================== */

const SAMPLE_EXAM_TEXT = `TIÊU ĐỀ: Đề thi thử Toán – Đề số 01
MÔN: Toán
THỜI GIAN: 15

[PHẦN 1]
Câu 1: Đạo hàm của hàm số y = x³ là?
A. 3x²
B. x²
C. 3x
D. x³/3
Đáp án: A

Câu 2: Nghiệm của phương trình 2x − 6 = 0 là?
A. x = 2
B. x = 3
C. x = −3
D. x = 6
Đáp án: B

Câu 3: Giá trị của log₂(8) bằng?
A. 2
B. 4
C. 3
D. 8
Đáp án: C

[PHẦN 2]
Câu 1: Cho hàm số f(x) = x² − 4x + 3. Xét tính đúng sai của các khẳng định sau:
a) f(1) = 0 = Đ
b) Hàm số có đỉnh tại x = 2 = Đ
c) f(x) > 0 với mọi x = S
d) Phương trình f(x) = 0 có hai nghiệm phân biệt = Đ

[PHẦN 3]
Câu 1: Tính tích phân của f(x) = 2x trên đoạn [0; 3]. (Làm tròn đến số nguyên)
Đáp án: 9

Câu 2: Số nghiệm nguyên của bất phương trình x² < 5 là?
Đáp án: 3`;

/* ---------- Đọc đề dạng văn bản ---------- */
function parseExamText(text) {
  const lines = text.split(/\r?\n/);
  const exam = { title: "Đề thi thử", subject: "Chưa rõ", duration: 45, p1: [], p2: [], p3: [] };
  let section = null;
  let cur = null;

  const flush = () => {
    if (!cur) return;
    if (section === 1 && cur.options && cur.options.length >= 2 && cur.answer) exam.p1.push(cur);
    if (section === 2 && cur.items && cur.items.length >= 1) exam.p2.push(cur);
    if (section === 3 && cur.answer != null) exam.p3.push(cur);
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    const up = line.toUpperCase().replace(/\s+/g, "");
    if (up.startsWith("TIÊUĐỀ:") || up.startsWith("TIEUDE:")) { exam.title = afterColon(line); continue; }
    if (up.startsWith("MÔN:") || up.startsWith("MON:")) { exam.subject = afterColon(line); continue; }
    if (up.startsWith("FILEĐỀ:") || up.startsWith("FILEDE:")) { exam.sourceFile = afterColon(line); continue; }
    if (up.startsWith("THỜIGIAN:") || up.startsWith("THOIGIAN:")) {
      const n = parseInt(afterColon(line), 10);
      if (n > 0) exam.duration = n;
      continue;
    }

    if (/^\[PH[ẦA]N\s*1\]$/i.test(line)) { flush(); section = 1; continue; }
    if (/^\[PH[ẦA]N\s*2\]$/i.test(line)) { flush(); section = 2; continue; }
    if (/^\[PH[ẦA]N\s*3\]$/i.test(line)) { flush(); section = 3; continue; }

    const q = line.match(/^C[âa]u\s*\d+\s*[:.]\s*(.*)$/i);
    if (q) {
      flush();
      cur = section === 1 ? { q: q[1], options: [], answer: null }
        : section === 2 ? { q: q[1], items: [] }
        : { q: q[1], answer: null };
      continue;
    }
    if (!cur) continue;

    // Ảnh minh họa cho câu hỏi hiện tại: "Hình: <link ảnh hoặc link Drive>"
    const img = line.match(/^H[ìi]nh\s*:\s*(\S+)/i);
    if (img) { cur.img = toDirectImage(img[1]); continue; }

    if (section === 1) {
      const opt = line.match(/^([A-D])\s*[.)]\s*(.*)$/i);
      if (opt) { cur.options.push(opt[2]); continue; }
      const ans = line.match(/^[ĐD][áa]p\s*[áa]n\s*[:.]\s*([A-D])/i);
      if (ans) { cur.answer = ans[1].toUpperCase(); continue; }
      cur.q += " " + line;
    } else if (section === 2) {
      const item = line.match(/^[a-d]\s*[.)]\s*(.*)$/i);
      if (item) {
        const m = item[1].match(/^(.*?)[=|]\s*([ĐSđs])\s*$/);
        if (m) cur.items.push({ text: m[1].trim(), answer: m[2].toUpperCase() === "Đ" });
        continue;
      }
      cur.q += " " + line;
    } else if (section === 3) {
      const ans = line.match(/^[ĐD][áa]p\s*[áa]n\s*[:.]\s*(.*)$/i);
      if (ans) { cur.answer = ans[1].trim(); continue; }
      cur.q += " " + line;
    }
  }
  flush();

  if (exam.p1.length + exam.p2.length + exam.p3.length === 0) {
    throw new Error("Không tìm thấy câu hỏi nào. Hãy kiểm tra lại định dạng file (xem mẫu bên phải).");
  }
  return exam;
}

function afterColon(line) {
  return line.split(":").slice(1).join(":").trim();
}

/* ---------- Đọc đề: tự nhận .txt hoặc .json ---------- */
function parseExamAny(text) {
  const t = text.trim();
  if (t.startsWith("{")) {
    const j = JSON.parse(t);
    const exam = {
      title: j.title || "Đề thi thử",
      subject: j.subject || "Chưa rõ",
      duration: j.duration || 45,
      sourceFile: j.sourceFile || null,
      p1: j.p1 || [],
      p2: j.p2 || [],
      p3: j.p3 || [],
    };
    if (exam.p1.length + exam.p2.length + exam.p3.length === 0) {
      throw new Error("File JSON không có câu hỏi nào.");
    }
    return exam;
  }
  return parseExamText(text);
}

/* ---------- Chấm điểm ---------- */
const P2_SCORE = { 0: 0, 1: 0.1, 2: 0.25, 3: 0.5, 4: 1.0 };

function normalizeShort(s) {
  return String(s == null ? "" : s).trim().toLowerCase().replace(",", ".").replace(/\s+/g, "");
}

function gradeExam(exam, answers) {
  let raw = 0, maxRaw = 0;
  const detail = {
    p1: { correct: 0, total: exam.p1.length, score: 0 },
    p2: { score: 0, max: 0, perQ: [] },
    p3: { correct: 0, total: exam.p3.length, score: 0 },
  };

  exam.p1.forEach((q, i) => {
    maxRaw += 0.25;
    if (answers.p1[i] === q.answer) { raw += 0.25; detail.p1.correct++; detail.p1.score += 0.25; }
  });

  exam.p2.forEach((q, i) => {
    const n = Math.min(q.items.length, 4);
    const maxQ = P2_SCORE[n] != null ? P2_SCORE[n] : 1.0;
    maxRaw += maxQ;
    detail.p2.max += maxQ;
    let c = 0;
    q.items.forEach((it, j) => {
      const a = answers.p2[i] && answers.p2[i][j];
      if (a !== undefined && a === it.answer) c++;
    });
    const s = P2_SCORE[Math.min(c, 4)] || 0;
    raw += s;
    detail.p2.score += s;
    detail.p2.perQ.push({ correct: c, total: q.items.length, score: s });
  });

  exam.p3.forEach((q, i) => {
    maxRaw += 0.25;
    const a = normalizeShort(answers.p3[i]);
    const k = normalizeShort(q.answer);
    if (k !== "" && a === k) { raw += 0.25; detail.p3.correct++; detail.p3.score += 0.25; }
  });

  const score10 = maxRaw > 0 ? Math.round((raw / maxRaw) * 1000) / 100 : 0;
  return {
    raw: Math.round(raw * 100) / 100,
    maxRaw: Math.round(maxRaw * 100) / 100,
    score10,
    detail,
  };
}

/* ---------- Trộn đề ngẫu nhiên (chống quay bài) ----------
   Trả về { exam, orderMap } — exam là bản đã trộn để hiển thị khi thi,
   orderMap là các mảng chỉ số nhỏ gọn để sau này "Xem lại bài làm"
   ánh xạ ngược về đúng câu gốc trong đề (không cần lưu lại toàn bộ nội dung). */
function shuffleArr(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function buildShuffledExam(ex) {
  const LETTERS = ["A", "B", "C", "D"];

  const p1Idx = shuffleArr(ex.p1.map((_, i) => i));
  const p1 = p1Idx.map((qi) => {
    const q = ex.p1[qi];
    const optOrder = shuffleArr(q.options.map((_, i) => i));
    const options = optOrder.map((oi) => q.options[oi]);
    const oldAnsIdx = LETTERS.indexOf(q.answer);
    const newAnsIdx = optOrder.indexOf(oldAnsIdx);
    return { ...q, options, answer: LETTERS[newAnsIdx], _opt: optOrder };
  });

  const p2Idx = shuffleArr(ex.p2.map((_, i) => i));
  const p2 = p2Idx.map((i) => ex.p2[i]);

  const p3Idx = shuffleArr(ex.p3.map((_, i) => i));
  const p3 = p3Idx.map((i) => ex.p3[i]);

  const orderMap = {
    p1: p1Idx.map((qi, i) => ({ q: qi, opt: p1[i]._opt })),
    p2: p2Idx,
    p3: p3Idx,
  };
  p1.forEach((q) => delete q._opt);

  return { exam: { ...ex, p1, p2, p3 }, orderMap };
}
function toYouTubeEmbed(url) {
  const m = String(url).match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/);
  return m ? "https://www.youtube.com/embed/" + m[1] : null;
}

/* ---------- Chuyển link Google Drive thành link ảnh nhúng được ---------- */
function toDirectImage(url) {
  const m = String(url).match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?id=)([\w-]+)/);
  if (m) return "https://drive.google.com/thumbnail?id=" + m[1] + "&sz=w1200";
  return url;
}

/* ---------- Chuyển đề ngược lại thành văn bản (để chỉnh sửa) ---------- */
/* Ảnh dạng base64 (tải lên trong web) không đưa vào văn bản — quản lý riêng ở mục Ảnh minh họa */
function isDataImg(u) { return typeof u === "string" && u.startsWith("data:"); }
function examToText(exam) {
  const L = [];
  const pushImg = (q) => { if (q.img && !isDataImg(q.img)) L.push("Hình: " + q.img); };
  if (exam.p1 && exam.p1.length) {
    L.push("[PHẦN 1]", "");
    exam.p1.forEach((q, i) => {
      L.push("Câu " + (i + 1) + ": " + q.q);
      pushImg(q);
      (q.options || []).forEach((o, j) => L.push("ABCD"[j] + ". " + o));
      L.push("Đáp án: " + q.answer, "");
    });
  }
  if (exam.p2 && exam.p2.length) {
    L.push("[PHẦN 2]", "");
    exam.p2.forEach((q, i) => {
      L.push("Câu " + (i + 1) + ": " + q.q);
      pushImg(q);
      (q.items || []).forEach((it, j) => L.push("abcd"[j] + ") " + it.text + " = " + (it.answer ? "Đ" : "S")));
      L.push("");
    });
  }
  if (exam.p3 && exam.p3.length) {
    L.push("[PHẦN 3]", "");
    exam.p3.forEach((q, i) => {
      L.push("Câu " + (i + 1) + ": " + q.q);
      pushImg(q);
      L.push("Đáp án: " + q.answer, "");
    });
  }
  return L.join("\n");
}
