import { createProject, reviseProject, attachEvidence, reviewRequirement, unreviewRequirement, reportRequirement, statusFor, hashBytes, applyReport, exportProject, importProject, restoreLocalProject, handoffFor } from "./model.mjs";

const $ = selector => document.querySelector(selector);
const STORE = "devam:workspaces:v1";
const samples = {
  daily: { title: "Atölye duyurusu", goal: "Mahalledeki seramik atölyesi için bir duyuru hazırla. Samimi ve kısa olsun. Yer, tarih ve kayıt bağlantısını ben vereceğim; eksik bilgileri uydurma.", items: ["Duyuru en fazla 120 kelime olsun.", "Verilmeyen tarih, adres ve bağlantıları uydurma.", "Son metni gözden geçirip paylaşmaya hazır bir dosyada sakla."] },
  code: { title: "CSV dışa aktarması", goal: "CSV dışa aktarmasında Türkçe karakter sorununu düzelt. Önce hatayı gösteren testi çalıştır; sonra değişikliği ve test sonucunu kaydet. Yayımlama yapma.", items: ["Türkçe karakterler dışa aktarmada korunsun.", "Hata ve düzeltilmiş davranış için test sonucu bulunsun.", "Yayımlama işlemi yapılmasın."] },
  app: { title: "Araç çağrısı sınırı", goal: "Araç çağrısı akışı kesildiğinde uygulamanın dosya yazmadığını sınayan bir entegrasyon örneği hazırla. Başarılı akışın bir kez yazdığı kontrolünü de göster.", items: ["Kesilmiş akışta dosya yazma sayısı sıfır olsun.", "Tamamlanmış çağrı kontrolünde dosya bir kez yazılsın.", "Sonuçlar sürümler ve çalıştırma komutuyla birlikte kaydedilsin."] },
};
const statusLabels = { pending: "Açık", reported: "AI bildirdi", evidence: "İnceleme bekliyor", stale: "Yeniden incele", reviewed: "Sen inceledin" };
let records = [];
let activeId;
let writable = true;
let noticeTimer;
let claimId;
let editingNew = false;

function announce(message, error = false) {
  clearTimeout(noticeTimer);
  const notice = $("#notice");
  notice.textContent = message;
  notice.classList.toggle("error", error);
  notice.hidden = false;
  noticeTimer = setTimeout(() => { notice.hidden = true; }, error ? 12000 : 6000);
}

function record() { return records.find(item => item.id === activeId); }
function project() { return record().project; }
function persist() {
  if (!writable) return;
  try { localStorage.setItem(STORE, JSON.stringify({ activeId, records })); }
  catch { announce("Tarayıcı kaydı yazılamadı. Çalışmanı indirme düğmesiyle yedekle.", true); }
}
function change(next) { record().project = next; persist(); render(); }
function action(fn) { try { fn(); } catch (error) { announce(error.message, true); } }
function addProject(value) {
  if (records.length >= 12) throw new Error("Bu prototip en fazla 12 çalışma saklar. Yeni işler için ayrı bir kayıt dosyası kullan.");
  const next = { id: crypto.randomUUID(), project: value };
  records.push(next); activeId = next.id; persist(); render();
}
function element(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}
function button(content, className, callback) {
  const node = element("button", className, content);
  node.type = "button"; node.addEventListener("click", () => action(callback)); return node;
}

function render() {
  const current = project();
  $("#project-title").textContent = current.title;
  $("#project-goal").textContent = current.goal;
  $("#revision").textContent = `İSTEK ${String(current.revision).padStart(2, "0")}`;
  const nav = $("#project-list"); nav.replaceChildren();
  for (const item of records) {
    const node = button(item.project.title, `project-button${item.id === activeId ? " active" : ""}`, () => { activeId = item.id; persist(); render(); });
    if (item.id === activeId) node.setAttribute("aria-current", "page");
    nav.append(node);
  }
  // The mobile layout has the same create action without hiding navigation.
  nav.append(button("+ Yeni çalışma", "project-button new-mobile", openNew));
  const reviewed = current.requirements.filter(item => statusFor(current, item) === "reviewed").length;
  $("#review-count").textContent = `${reviewed} / ${current.requirements.length} incelendi`;
  $("#handoff-summary").replaceChildren(
    element("p", "", `İstek sürümü ${current.revision} · ${current.requirements.length} iş maddesi`),
    element("strong", "", `${reviewed} maddeyi inceledin · ${current.requirements.length - reviewed} madde kontrol bekliyor`),
  );
  $("#handoff-preview").value = handoffFor(current);
  const list = $("#requirements"); list.replaceChildren();
  for (const item of current.requirements) {
    const status = statusFor(current, item);
    const card = element("article", "requirement"); card.dataset.requirement = item.id;
    const head = element("div", "requirement-head");
    const label = element("div", "requirement-label");
    label.append(element("span", "item-id", item.id.toUpperCase()), element("h4", "requirement-title", item.text));
    head.append(label, element("span", `status ${status}`, statusLabels[status])); card.append(head);
    if (item.claim) card.append(element("p", "claim", item.claim.note));
    if (item.evidence) {
      const detail = element("details", "evidence");
      detail.append(element("summary", "", `↳ ${item.evidence.name}`), element("p", "", `SHA-256 ${item.evidence.sha256}\n${item.evidence.size} bayt · İçerik saklanmaz; yalnızca dosya izi tutulur.`));
      card.append(detail);
    }
    const actions = element("div", "item-actions");
    const fileInput = document.createElement("input"); fileInput.type = "file"; fileInput.hidden = true;
    fileInput.setAttribute("aria-label", `${item.id} için dayanak dosyası`);
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0]; if (!file) return;
      const idAtStart = activeId, revisionAtStart = current.revision;
      try {
        if (file.size > 10 * 1024 * 1024) throw new Error("Dosya en fazla 10 MB olabilir.");
        const sha256 = await hashBytes(await file.arrayBuffer());
        if (activeId !== idAtStart || project().revision !== revisionAtStart) throw new Error("Dosya okunurken çalışma değişti. Güncel maddeye yeniden ekle.");
        const changed = item.evidence && item.evidence.sha256 !== sha256;
        change(attachEvidence(project(), item.id, { name: file.name, size: file.size, sha256 }));
        announce(changed ? "Dosyanın içeriği değişmiş. Önceki inceleme kaldırıldı." : "Dosya izi eklendi. İçerik tarayıcıdan gönderilmedi.");
      } catch (error) { announce(error.message, true); }
    });
    const claim = button("AI beyanı ekle", "", () => {
      claimId = item.id; $("#claim-item").textContent = item.text;
      $("#claim-note").value = item.claim?.note ?? ""; $("#claim-dialog").showModal();
    });
    const review = button(status === "reviewed" ? "İncelemeyi geri al" : "Dosyayı ve maddeyi inceledim", "review-button", () => {
      change(status === "reviewed" ? unreviewRequirement(project(), item.id) : reviewRequirement(project(), item.id));
      announce(status === "reviewed" ? "İnceleme kaldırıldı. Madde yeniden kontrol bekliyor." : "İncelemen bu istek sürümü ve dosya izi için kaydedildi.");
    });
    review.disabled = !item.evidence;
    review.title = item.evidence ? "Bu, senin inceleme kaydındır; otomatik doğrulama değildir." : "Önce bu madde için dayanak dosyası ekle.";
    actions.append(claim, button(item.evidence ? "Dosyayı yeniden kontrol et" : "Dosya ekle", "", () => fileInput.click()), review, fileInput);
    card.append(actions); list.append(card);
  }
}

function openEditor(isNew) {
  editingNew = isNew;
  const current = isNew ? { title: "", goal: "", requirements: [] } : project();
  $("#task-title").value = current.title; $("#task-goal").value = current.goal;
  $("#task-items").value = current.requirements.map(item => item.text).join("\n");
  $("#edit-dialog").showModal();
}
function openNew() { openEditor(true); }
function download(name, contents, type) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = element("a"); link.href = url; link.download = name;
  document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("#new-project").addEventListener("click", openNew);
$("#edit-project").addEventListener("click", () => openEditor(false));
for (const node of document.querySelectorAll(".close-dialog")) node.addEventListener("click", () => node.closest("dialog").close());
for (const node of document.querySelectorAll("[data-sample]")) node.addEventListener("click", () => action(() => {
  addProject(createProject(samples[node.dataset.sample])); announce("Yeni bir örnek çalışma açıldı. Önceki çalışman listede duruyor.");
}));
$("#edit-form").addEventListener("submit", event => {
  event.preventDefault(); action(() => {
    const input = { title: $("#task-title").value, goal: $("#task-goal").value, items: $("#task-items").value.split("\n").filter(line => line.trim()) };
    if (editingNew) addProject(createProject(input)); else change(reviseProject(project(), input));
    $("#edit-dialog").close(); announce("Güncel istek kaydedildi.");
  });
});
$("#claim-form").addEventListener("submit", event => {
  event.preventDefault(); action(() => { change(reportRequirement(project(), claimId, $("#claim-note").value)); $("#claim-dialog").close(); announce("AI beyanı eklendi; inceleme bekliyor."); });
});
$("#apply-report").addEventListener("click", () => action(() => {
  change(applyReport(project(), $("#ai-report").value)); $("#ai-report").value = ""; announce("AI raporu eklendi. Kullanıcı incelemesi bekleyen beyanlar olarak kaydedildi.");
}));
$("#copy-handoff").addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(handoffFor(project())); announce("Güncel devam paketi kopyalandı. Yeni sohbete yapıştırabilirsin."); }
  catch { $(".preview").open = true; $("#handoff-preview").focus(); $("#handoff-preview").select(); announce("Panoya erişilemedi. Açılan metni elle kopyala.", true); }
});
$("#download-handoff").addEventListener("click", () => download("devam-paketi.md", handoffFor(project()), "text/markdown;charset=utf-8"));
$("#export-project").addEventListener("click", () => download("calisma.devam.json", exportProject(project()), "application/json;charset=utf-8"));
$("#import-project").addEventListener("click", () => $("#project-file").click());
$("#project-file").addEventListener("change", async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 800_000) throw new Error("Çalışma dosyası çok büyük.");
    const input = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    addProject(importProject(input)); announce("Çalışma ayrı bir kayıt olarak açıldı. Taşınan incelemeler yeniden kontrol bekliyor.");
  } catch (error) { announce(error.message, true); }
  event.target.value = "";
});

try {
  const raw = localStorage.getItem(STORE);
  if (raw) {
    if (raw.length > 2_500_000) throw new Error("Kayıt çok büyük.");
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved.records) || saved.records.length > 12) throw new Error("Kayıt biçimi geçersiz.");
    const ids = new Set();
    records = saved.records.map(entry => {
      if (typeof entry.id !== "string" || !/^[a-z0-9-]{1,50}$/.test(entry.id) || ids.has(entry.id)) throw new Error("Kayıt kimliği geçersiz.");
      ids.add(entry.id); return { id: entry.id, project: restoreLocalProject(JSON.stringify(entry.project)) };
    });
    activeId = records.some(entry => entry.id === saved.activeId) ? saved.activeId : records[0]?.id;
  }
} catch {
  writable = false;
  announce("Önceki tarayıcı kaydı okunamadı; üzerine yazılmadı. Bu oturumdaki çalışmanı dosya olarak indirebilirsin.", true);
}
if (!records.length) addProject(createProject(samples.daily)); else render();
