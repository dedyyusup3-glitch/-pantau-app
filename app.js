// === Notifikasi Telegram ===
const TELEGRAM_BOT_TOKEN = "8924473449:AAGh2hTBVq7F29y_u1z67kD3BzQB4VYyOUA";
const TELEGRAM_CHAT_ID = "-5357420061";

async function kirimNotifTelegram(data) {
  const severityLabel = { AA: "Extreme", A: "High", B: "Moderate", C: "Low" };
  const teks =
    `🚨 *Temuan Baru - PANTAU*\n\n` +
    `📍 Lokasi: ${data.lokasi}\n` +
    `⚠️ Kode Bahaya: ${data.severity} (${severityLabel[data.severity] || "-"})\n` +
    `📝 Temuan: ${data.temuan}\n` +
    `👤 Pelapor: ${data.dibuatOleh || "-"}\n` +
    `🏢 Departemen: ${data.departemen || "-"}\n` +
    `📌 Status: ${data.status || "Open"}`;

  try {
    await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: teks,
        parse_mode: "Markdown"
      })
    });
  } catch (e) {
    console.error("Gagal kirim notifikasi Telegram:", e);
  }
}


// === Mode Offline: antrian temuan yang belum terkirim ===
const PENDING_KEY = "pantau_pending";

function getPending() {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
  } catch { return []; }
}

function setPending(arr) {
  localStorage.setItem(PENDING_KEY, JSON.stringify(arr));
  renderPendingBadge();
}

function addPending(item) {
  const arr = getPending();
  arr.push(item);
  setPending(arr);
}

function renderPendingBadge() {
  const n = getPending().length;
  const el = document.getElementById("pendingBadge");
  if (!el) return;
  if (n > 0) {
    el.textContent = `⏳ ${n} temuan menunggu dikirim (offline)`;
    el.classList.remove("hidden");
  } else {
    el.classList.add("hidden");
  }
}

async function trySyncPending() {
  const arr = getPending();
  if (arr.length === 0) return;

  const sisa = [];
  for (const item of arr) {
    try {
      const data = { ...item.data };
      if (item.fotoBase64) {
        const up = await callApi("uploadFoto", { base64: item.fotoBase64, filename: `temuan-${item.ts}.jpg` });
        data.fotoUrl = up.url;
      }
      if (item.fotoTindakanBase64) {
        const up = await callApi("uploadFoto", { base64: item.fotoTindakanBase64, filename: `tindakan-${item.ts}.jpg` });
        data.fotoTindakanUrl = up.url;
      }
      await callApi("addTemuan", { data });
      kirimNotifTelegram(data);
    } catch (e) {
      sisa.push(item);
    }
  }
  setPending(sisa);
  if (sisa.length < arr.length) {
    await refreshTemuan();
  }
}

window.addEventListener("online", trySyncPending);

// =====================================================================
// PANTAU — app.js (versi Google Sheets + Apps Script)
// =====================================================================

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbwZDyLeDeyxNOPZs68hWJLK6-nHnZe1q8ZbzXTReT0bLlUOJFYn473BBw3caSaEwVzI/exec";
const SESSION_KEY = "pantau_session";
const SESSION_TIMEOUT_MS = 3 * 60 * 1000; // 3 menit
const POLL_INTERVAL_MS = 20 * 1000; // 20 detik

let allTemuan = [];
let editingId = null;
let selectedSeverity = null;
let chartSeverity, chartLokasi, chartDept, chartPic;
let pollTimer = null;

async function callApi(action, payload = {}) {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes("GANTI_DENGAN")) {
    throw new Error("APPS_SCRIPT_URL belum diisi di app.js.");
  }
  const res = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ action, ...payload })
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const json = await res.json();
  if (json.success === false) throw new Error(json.error || "Gagal memproses permintaan.");
  return json;
}

function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Date.now() - s.lastActive > SESSION_TIMEOUT_MS) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return s;
  } catch { return null; }
}

function setSession(nik, nama) {
  localStorage.setItem(SESSION_KEY, JSON.stringify({ nik, nama, lastActive: Date.now() }));
}

function touchSession() {
  const s = getSession();
  if (s) setSession(s.nik, s.nama);
}

function clearSession() {
  localStorage.removeItem(SESSION_KEY);
  if (pollTimer) clearInterval(pollTimer);
}

document.getElementById("btnLoginKaryawan").addEventListener("click", async () => {
  const nik = document.getElementById("loginNik").value.trim();
  const nama = document.getElementById("loginNama").value.trim();
  const errEl = document.getElementById("loginError");
  errEl.classList.remove("show");

  if (!nik || !nama) {
    errEl.textContent = "NIK dan Nama wajib diisi.";
    errEl.classList.add("show");
    return;
  }

  try {
    const result = await callApi("login", { nik, nama });
    if (!result.success) {
      errEl.textContent = result.error || "NIK atau Nama tidak cocok.";
      errEl.classList.add("show");
      return;
    }
    setSession(result.nik, result.nama);
    enterApp(result.nama);
  } catch (e) {
    errEl.textContent = "Gagal menghubungi server: " + e.message;
    errEl.classList.add("show");
    console.error(e);
  }
});

document.getElementById("btnLogout").addEventListener("click", () => {
  clearSession();
  location.reload();
});

function enterApp(nama) {
  const s = getSession();
  document.getElementById("loginScreen").classList.add("hidden");
  document.getElementById("app").classList.remove("hidden");
  document.getElementById("userLabel").textContent = nama;
  document.getElementById("fDibuatOleh").value = nama;
  document.getElementById("fNik").value = s ? s.nik : "";
  renderPendingBadge();
  trySyncPending();
  refreshTemuan();
  pollTimer = setInterval(() => { trySyncPending(); refreshTemuan(); }, POLL_INTERVAL_MS);
}

(function initAuth() {
  const s = getSession();
  if (s) enterApp(s.nama);
  ["click", "keydown", "touchstart"].forEach(ev =>
    document.addEventListener(ev, touchSession, { passive: true })
  );
})();

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    ["viewInput", "viewRiwayat", "viewDashboard"].forEach(id => {
      document.getElementById(id).classList.toggle("hidden", id !== btn.dataset.tab);
    });
    if (btn.dataset.tab === "viewDashboard") renderDashboard();
    if (btn.dataset.tab === "viewRiwayat") refreshTemuan();
  });
});

document.querySelectorAll(".sev-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".sev-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    selectedSeverity = btn.dataset.sev;
  });
});

let fotoBase64 = null;
let fotoTindakanBase64 = null;

function wireFotoInput(inputId, previewId, setter) {
  document.getElementById(inputId).addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 900;
        const scale = Math.min(1, maxW / img.width);
        const canvas = document.createElement("canvas");
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
        setter(dataUrl);
        const preview = document.getElementById(previewId);
        preview.src = dataUrl;
        preview.classList.remove("hidden");
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

wireFotoInput("fFoto", "fFotoPreview", (v) => fotoBase64 = v);
wireFotoInput("fFotoTindakan", "fFotoTindakanPreview", (v) => fotoTindakanBase64 = v);

document.getElementById("btnSimpanTemuan").addEventListener("click", async () => {
  const data = {
    tanggal: document.getElementById("fTanggal").value,
    nik: document.getElementById("fNik").value.trim(),
    jabatan: document.getElementById("fJabatan").value.trim(),
    departemen: document.getElementById("fDepartemen").value.trim(),
    lokasi: document.getElementById("fLokasi").value.trim(),
    temuan: document.getElementById("fTemuan").value.trim(),
    tindakan: document.getElementById("fTindakan").value.trim(),
    pic: document.getElementById("fPic").value.trim(),
    dueDate: document.getElementById("fDueDate").value,
    severity: selectedSeverity,
    dibuatOleh: document.getElementById("fDibuatOleh").value,
    status: document.getElementById("fStatus").value
  };

  if (!data.lokasi || !data.temuan || !data.severity) {
    alert("Lokasi, Temuan, dan Kode Bahaya wajib diisi.");
    return;
  }

  toggleLoading(true);
  try {
    if (fotoBase64) {
      const up = await callApi("uploadFoto", { base64: fotoBase64, filename: `temuan-${Date.now()}.jpg` });
      data.fotoUrl = up.url;
    }
    if (fotoTindakanBase64) {
      const up = await callApi("uploadFoto", { base64: fotoTindakanBase64, filename: `tindakan-${Date.now()}.jpg` });
      data.fotoTindakanUrl = up.url;
    }

    if (editingId) {
      await callApi("updateTemuan", { id: editingId, data });
    } else {
      await callApi("addTemuan", { data });
      kirimNotifTelegram(data);
    }
    resetForm();
    await refreshTemuan();
    alert("Data tersimpan.");
  } catch (e) {
    const isNetworkError = !navigator.onLine || /Failed to fetch|NetworkError|load failed/i.test(e.message);
    if (isNetworkError && !editingId) {
      addPending({
        ts: Date.now(),
        data,
        fotoBase64,
        fotoTindakanBase64
      });
      resetForm();
      alert("Tidak ada koneksi internet. Temuan disimpan sementara di HP dan akan otomatis terkirim saat sinyal kembali.");
    } else {
      alert("Gagal menyimpan data: " + e.message);
      console.error(e);
    }
  } finally {
    toggleLoading(false);
  }
});

document.getElementById("btnBatalEdit").addEventListener("click", resetForm);

function resetForm() {
  ["fTanggal","fJabatan","fDepartemen","fLokasi","fTemuan","fTindakan","fPic","fDueDate"]
    .forEach(id => document.getElementById(id).value = "");
  document.getElementById("fStatus").value = "open";
  document.querySelectorAll(".sev-btn").forEach(b => b.classList.remove("active"));
  selectedSeverity = null;
  fotoBase64 = null;
  fotoTindakanBase64 = null;
  document.getElementById("fFotoPreview").classList.add("hidden");
  document.getElementById("fFotoTindakanPreview").classList.add("hidden");
  document.getElementById("fFoto").value = "";
  document.getElementById("fFotoTindakan").value = "";
  editingId = null;
  document.getElementById("btnBatalEdit").classList.add("hidden");
}

async function refreshTemuan() {
  toggleLoading(true);
  try {
    const result = await callApi("listTemuan");
    allTemuan = (result.data || []).slice().reverse();
    renderRiwayat();
    if (!document.getElementById("viewDashboard").classList.contains("hidden")) {
      renderDashboard();
    }
  } catch (e) {
    console.error(e);
  } finally {
    toggleLoading(false);
  }
}

function toggleLoading(show) {
  document.getElementById("loadingBar").classList.toggle("hidden", !show);
}

document.getElementById("fFilterStatus").addEventListener("change", renderRiwayat);

function renderRiwayat() {
  const filter = document.getElementById("fFilterStatus").value;
  const listEl = document.getElementById("riwayatList");
  const emptyEl = document.getElementById("riwayatEmpty");
  let items = allTemuan;
  if (filter) items = items.filter(t => t.status === filter);

  listEl.innerHTML = "";
  emptyEl.classList.toggle("hidden", items.length > 0);

  items.forEach(t => {
    const el = document.createElement("div");
    el.className = "hist-item";
    el.innerHTML = `
      <div class="hist-top">
        <div>
          <div class="hist-loc">${escapeHtml(t.lokasi || "-")}</div>
          <div class="hist-desc">${escapeHtml(t.temuan || "")}</div>
        </div>
        <span class="sev-tag ${t.severity || ""}">${t.severity || "-"}</span>
      </div>
      <div class="hist-meta">
        <span class="status-pill ${t.status === 'closed' ? 'closed' : 'open'}">${t.status === 'closed' ? 'Closed' : 'Open'}</span>
        <span>${escapeHtml(t.dibuatOleh || "-")}${t.departemen ? " · " + escapeHtml(t.departemen) : ""}</span>
        <span>PIC: ${escapeHtml(t.pic || "-")}</span>
      </div>
    `;
    el.addEventListener("click", () => openForEdit(t));
    listEl.appendChild(el);
  });
}

function openForEdit(t) {
  editingId = t.id;
  document.getElementById("fTanggal").value = t.tanggal || "";
  document.getElementById("fJabatan").value = t.jabatan || "";
  document.getElementById("fDepartemen").value = t.departemen || "";
  document.getElementById("fLokasi").value = t.lokasi || "";
  document.getElementById("fTemuan").value = t.temuan || "";
  document.getElementById("fTindakan").value = t.tindakan || "";
  document.getElementById("fPic").value = t.pic || "";
  document.getElementById("fDueDate").value = t.dueDate || "";
  document.getElementById("fStatus").value = t.status || "open";
  if (t.fotoUrl) {
    document.getElementById("fFotoPreview").src = t.fotoUrl;
    document.getElementById("fFotoPreview").classList.remove("hidden");
  }
  if (t.fotoTindakanUrl) {
    document.getElementById("fFotoTindakanPreview").src = t.fotoTindakanUrl;
    document.getElementById("fFotoTindakanPreview").classList.remove("hidden");
  }
  selectedSeverity = t.severity;
  document.querySelectorAll(".sev-btn").forEach(b => b.classList.toggle("active", b.dataset.sev === t.severity));
  document.getElementById("btnBatalEdit").classList.remove("hidden");
  document.querySelector('.tab-btn[data-tab="viewInput"]').click();
}

function escapeHtml(str) {
  const d = document.createElement("div");
  d.textContent = str == null ? "" : String(str);
  return d.innerHTML;
}

function renderDashboard() {
  const total = allTemuan.length;
  const open = allTemuan.filter(t => t.status !== "closed").length;
  const closed = allTemuan.filter(t => t.status === "closed").length;
  const today = new Date().toISOString().slice(0, 10);
  const terlambat = allTemuan.filter(t => t.status !== "closed" && t.dueDate && t.dueDate < today).length;

  document.getElementById("statTotal").textContent = total;
  document.getElementById("statOpen").textContent = open;
  document.getElementById("statClosed").textContent = closed;
  document.getElementById("statTerlambat").textContent = terlambat;

  const sevCount = { AA: 0, A: 0, B: 0, C: 0 };
  allTemuan.forEach(t => { if (sevCount[t.severity] !== undefined) sevCount[t.severity]++; });

  const lokasiCount = {};
  allTemuan.forEach(t => {
    const key = t.lokasi || "Tidak diketahui";
    lokasiCount[key] = (lokasiCount[key] || 0) + 1;
  });
  const topLokasi = Object.entries(lokasiCount).sort((a,b) => b[1]-a[1]).slice(0, 8);

  const deptCount = {};
  allTemuan.forEach(t => {
    const key = t.departemen || "Tidak diketahui";
    deptCount[key] = (deptCount[key] || 0) + 1;
  });
  const topDept = Object.entries(deptCount).sort((a,b) => b[1]-a[1]).slice(0, 8);

  const picCount = {};
  allTemuan.forEach(t => {
    (t.pic || "-").split(",").map(s => s.trim()).filter(Boolean).forEach(p => {
      picCount[p] = (picCount[p] || 0) + 1;
    });
  });
  const topPic = Object.entries(picCount).sort((a,b) => b[1]-a[1]).slice(0, 8);

  drawChart("severity", "chartSeverity", "doughnut",
    ["AA Extreme", "A High", "B Moderate", "C Low"],
    [sevCount.AA, sevCount.A, sevCount.B, sevCount.C],
    ["#D6402A", "#E8792B", "#E0C22B", "#4C9A6A"]);

  drawChart("lokasi", "chartLokasi", "bar",
    topLokasi.map(x => x[0]), topLokasi.map(x => x[1]), "#F5A623");

  drawChart("dept", "chartDept", "bar",
    topDept.map(x => x[0]), topDept.map(x => x[1]), "#3E6E75");

  drawChart("pic", "chartPic", "bar",
    topPic.map(x => x[0]), topPic.map(x => x[1]), "#3E9A5C");
}

function drawChart(which, canvasId, type, labels, data, color) {
  const existing = { severity: chartSeverity, lokasi: chartLokasi, dept: chartDept, pic: chartPic }[which];
  if (existing) existing.destroy();

  const cfg = {
    type,
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: Array.isArray(color) ? color : color,
        borderRadius: type === "bar" ? 3 : 0,
        borderWidth: type === "doughnut" ? 2 : 0,
        borderColor: "#14171A"
      }]
    },
    options: {
      responsive: true,
      indexAxis: type === "bar" ? "y" : "x",
      plugins: { legend: { display: type === "doughnut", labels: { color: "#9AA3AC", font: { size: 11 } } } },
      scales: type === "bar" ? {
        x: { ticks: { color: "#9AA3AC" }, grid: { color: "#383E45" } },
        y: { ticks: { color: "#EDEFF1" }, grid: { display: false } }
      } : {}
    }
  };
  const chart = new Chart(document.getElementById(canvasId), cfg);
  if (which === "severity") chartSeverity = chart;
  if (which === "lokasi") chartLokasi = chart;
  if (which === "dept") chartDept = chart;
  if (which === "pic") chartPic = chart;
}

document.getElementById("btnExportExcel").addEventListener("click", () => {
  if (allTemuan.length === 0) {
    alert("Belum ada data untuk diexport.");
    return;
  }
  const rows = allTemuan.map(t => ({
    Tanggal: t.tanggal || "",
    Nama: t.dibuatOleh || "",
    NIK: t.nik || "",
    Jabatan: t.jabatan || "",
    Departemen: t.departemen || "",
    Lokasi: t.lokasi || "",
    "Temuan KTA/TTA": t.temuan || "",
    "Kode Bahaya": t.severity || "",
    "Tindakan Perbaikan": t.tindakan || "",
    PIC: t.pic || "",
    "Due Date": t.dueDate || "",
    Status: t.status || ""
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Temuan");
  XLSX.writeFile(wb, `PANTAU-Temuan-${new Date().toISOString().slice(0,10)}.xlsx`);
});
