/**
 * UI TEST — Online Virtual Dermatology Consultations, driven through real
 * Chrome against the running dev server (:3000), using the seeded throwaway
 * business (.tmp-vc-seed.mjs must run first).
 *
 * Verifies the page a human actually uses: exact title/subtitle, the 6 spec
 * columns, live rows, per-status actions, search, status + date filters,
 * view modal (real appointment/doctor/clinic/notes), the real workflow
 * (Accept -> Start -> Complete via PATCH), the create form + validation,
 * loading/empty/error states, mobile scroll confinement, and a clean
 * console. Screenshots go to the OS temp dir (outside the project, so the
 * Next dev watcher never reloads the page mid-test).
 *
 * Requires (not a project dependency, install on demand):
 *   npm i -D puppeteer-core  (uses the locally installed Chrome)
 * Run: TEST_PORT=3000 node .tmp-vc-ui-test.mjs
 */
import fs from "fs";
import os from "os";
import path from "path";
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = `http://localhost:${process.env.TEST_PORT || "3000"}`;
const state = JSON.parse(fs.readFileSync(".tmp-vc-ui.json", "utf8"));
const SHOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "vc-ui-"));

const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

const consoleErrors = [];
const rowCount = (page) => page.evaluate(() => document.querySelectorAll("tbody tr").length);
const rowTexts = (page) =>
  page.$$eval("tbody tr", (rows) =>
    rows.map((r) => Array.from(r.querySelectorAll("td")).map((c) => c.textContent.trim()).join(" | "))
  );
const statusCells = (page) =>
  page.$$eval("tbody tr", (rows) =>
    rows.map((r) => (r.querySelectorAll("td")[4]?.textContent ?? "").trim())
  );
const actionLabels = (page, consultationId) =>
  page.evaluate((cid) => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find(
      (r) => (r.querySelectorAll("td")[0]?.textContent ?? "").trim() === cid
    );
    if (!row) return null;
    const cell = row.querySelectorAll("td")[5];
    return Array.from(cell.querySelectorAll("button")).map((b) => b.textContent.trim());
  }, consultationId);
const shot = (name) => path.join(SHOT_DIR, `${name}.png`);

async function pickStatusFilter(page, label) {
  const opened = await page.$$eval('button[aria-haspopup="listbox"]', (btns) => {
    const b = btns.find((x) => x.textContent.includes("Status:"));
    if (!b) return false;
    b.click();
    return true;
  });
  if (!opened) return false;
  await page.waitForSelector('[role="listbox"]', { timeout: 5000 });
  const picked = await page.$$eval(
    '[role="listbox"] button',
    (opts, target) => {
      const o = opts.find((x) => x.textContent.trim() === target);
      if (o) o.click();
      return !!o;
    },
    `Status: ${label}`
  );
  await page.waitForFunction(
    (t) => {
      const b = Array.from(document.querySelectorAll('button[aria-haspopup="listbox"]')).find((x) =>
        x.textContent.includes("Status:")
      );
      return b && b.textContent.includes(t);
    },
    { timeout: 5000 },
    label
  );
  return picked;
}

async function typeInto(page, selector, text) {
  const input = await page.$(selector);
  await input.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  if (text) await input.type(text);
}

const setDateString = (page, value) =>
  page.$eval(
    'input[aria-label="Filter by created date"]',
    (el, v) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    },
    value
  );

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e}`));
  page.on("console", (m) => {
    const url = m.location()?.url ?? "";
    const text = m.text();
    if (m.type() === "error" && !url.includes("favicon")) {
      // Network-level notices are covered by explicit state assertions
      // (VC40 deliberately injects a 500 through interception).
      if (text.startsWith("Failed to load resource")) return;
      consoleErrors.push(`console: ${text} @ ${url}`);
    }
  });

  // Authenticate exactly the way the app does: JWT in localStorage.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), state.token);
  await page.goto(`${BASE}/dashboard/virtual-consultation`, { waitUntil: "domcontentloaded" });

  // ---- 1. shell ----
  await page.waitForFunction(
    () => document.querySelector("h1")?.textContent?.includes("Online Virtual Dermatology"),
    { timeout: 60000 }
  );
  const h1 = await page.$eval("h1", (el) => el.textContent.trim());
  check("VC1  page title matches spec", h1 === "Online Virtual Dermatology Consultations", h1);
  const subtitle = await page.$eval("main p", (el) => el.textContent.trim());
  check(
    "VC2  subtitle matches spec",
    subtitle === "Manage online dermatology consultations and patient requests.",
    subtitle
  );

  const headerButtons = await page.$$eval("main > div:first-child button", (b) =>
    b.map((x) => x.textContent.trim())
  );
  check(
    "VC3  New Consultation + Refresh Consultations present",
    headerButtons.some((t) => t.includes("New Consultation")) &&
      headerButtons.some((t) => t.includes("Refresh Consultations")),
    headerButtons.join(" / ")
  );

  // ---- 2. table: EXACTLY the 6 spec columns ----
  await page.waitForSelector("tbody tr", { timeout: 60000 });
  const headers = await page.$$eval("thead th", (th) =>
    th.map((x) => x.textContent.trim().replace(/\s+/g, " "))
  );
  const wanted = [
    "Consultation ID",
    "Patient Name",
    "Phone",
    "Dermatology Concern",
    "Status",
    "Actions",
  ];
  check(
    "VC4  all 6 required columns, no extras",
    headers.length === 6 && wanted.every((w, i) => headers[i] === w),
    headers.join(" | ")
  );

  // ---- 3. live seeded rows ----
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 5);
  const ids = await page.$$eval("tbody tr td:first-child", (td) =>
    td.map((x) => x.textContent.trim())
  );
  check(
    "VC5  5 real rows with VC-YYYYMMDD-NNNN ids",
    ids.length === 5 && state.created.every((c) => ids.includes(c.consultationId)),
    ids.join(",")
  );
  const statuses = await statusCells(page);
  const need = ["PENDING", "ACCEPTED", "IN PROGRESS", "COMPLETED", "CANCELLED"];
  check(
    "VC6  one row per workflow status",
    need.every((s) => statuses.some((x) => x === s)),
    statuses.join(",")
  );
  const texts = await rowTexts(page);
  check(
    "VC7  patient name + phone come from the real patient row",
    texts.every((t) => t.includes("Ayesha Khan") && t.includes("4455667")),
    texts[0]?.slice(0, 80)
  );
  const concernCol = texts.map((t) => t.split(" | ")[3]);
  check(
    "VC8  dermatology concerns displayed",
    concernCol.includes("Acne & Pigmentation") && concernCol.includes("Psoriasis"),
    concernCol.join(" / ")
  );

  // ---- 4. per-status actions ----
  const byStatus = Object.fromEntries(state.created.map((c, i) => [c.status, c.consultationId]));
  const aPending = await actionLabels(page, byStatus.pending);
  const aAccepted = await actionLabels(page, byStatus.accepted);
  const aInProgress = await actionLabels(page, byStatus.in_progress);
  const aCompleted = await actionLabels(page, byStatus.completed);
  const aCancelled = await actionLabels(page, byStatus.cancelled);
  const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  check(
    "VC9  pending -> View, Accept, Cancel",
    eq(aPending, ["View", "Accept", "Cancel"]),
    JSON.stringify(aPending)
  );
  check(
    "VC10 accepted -> View, Start Consultation, Cancel",
    eq(aAccepted, ["View", "Start Consultation", "Cancel"]),
    JSON.stringify(aAccepted)
  );
  check(
    "VC11 in progress -> View, Complete",
    eq(aInProgress, ["View", "Complete"]),
    JSON.stringify(aInProgress)
  );
  check("VC12 completed -> View only", eq(aCompleted, ["View"]), JSON.stringify(aCompleted));
  check("VC13 cancelled -> View only", eq(aCancelled, ["View"]), JSON.stringify(aCancelled));

  // ---- 5. search (dynamic, no reload) ----
  await page.type('input[aria-label="Search consultations"]', state.created[0].consultationId);
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
  check("VC14 search by consultation ID -> 1 row", (await rowCount(page)) === 1);
  await typeInto(page, 'input[aria-label="Search consultations"]', "Ayesha");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 5);
  check("VC15 search by patient name -> all 5 rows", (await rowCount(page)) === 5);
  await typeInto(page, 'input[aria-label="Search consultations"]', "4455667");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 5);
  check("VC16 search by phone -> all 5 rows", (await rowCount(page)) === 5);
  await typeInto(page, 'input[aria-label="Search consultations"]', "Melasma");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
  check("VC17 search by concern -> 1 row", (await rowCount(page)) === 1);
  await typeInto(page, 'input[aria-label="Search consultations"]', "zzzz-no-such");
  await page.waitForFunction(() =>
    document.body.textContent.includes("No consultations match your search.")
  );
  check("VC18 unknown search shows the no-match state", true);
  await typeInto(page, 'input[aria-label="Search consultations"]', "");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 5);

  // ---- 6. status filter ----
  await pickStatusFilter(page, "Pending");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
  check(
    "VC19 status filter Pending -> only the pending row",
    (await statusCells(page))[0] === "PENDING"
  );
  await pickStatusFilter(page, "Completed");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
  check(
    "VC20 status filter Completed -> only the completed row",
    (await statusCells(page))[0] === "COMPLETED"
  );
  await pickStatusFilter(page, "All");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 5);
  check("VC21 status filter All restores 5 rows", (await rowCount(page)) === 5);

  // ---- 7. date filter ----
  // Derive the seeded day from the DATA (local time may cross midnight
  // between seeding and this run — "today" could differ from the rows' day).
  const apiList = await fetch(`${BASE}/api/virtual-consultations`, {
    headers: { Authorization: `Bearer ${state.token}` },
  }).then((r) => r.json());
  const seedDate = new Date(apiList.data[0].createdAt);
  const pad2 = (n) => String(n).padStart(2, "0");
  const today = `${seedDate.getFullYear()}-${pad2(seedDate.getMonth() + 1)}-${pad2(seedDate.getDate())}`;
  await setDateString(page, today);
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 5);
  check("VC22 date filter = the rows' day keeps all 5 rows", (await rowCount(page)) === 5);
  await setDateString(page, "2020-01-01");
  await page.waitForFunction(() =>
    document.body.textContent.includes("No consultations match your search.")
  );
  check("VC23 date filter = empty day shows the no-match state", true);
  await page.$$eval("button", (btns) => {
    const c = btns.find((x) => x.textContent.trim() === "Clear");
    if (c) c.click();
  });
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 5);
  check("VC24 Clear restores 5 rows", (await rowCount(page)) === 5);

  await page.screenshot({ path: shot("page"), fullPage: true });

  // ---- 8. view modal (linked appointment/doctor/clinic row) ----
  const linked = state.created.find((c) => c.status === "accepted");
  await page.evaluate((cid) => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find(
      (r) => (r.querySelectorAll("td")[0]?.textContent ?? "").trim() === cid
    );
    row?.querySelector('button[title="View consultation"]')?.click();
  }, linked.consultationId);
  await page.waitForFunction(
    () => document.querySelector(".fixed.inset-0.z-50 h3")?.textContent?.includes("Virtual Consultation"),
    { timeout: 10000 }
  );
  const modalText = await page.evaluate(() => {
    const modal = document.querySelector(".fixed.inset-0.z-50");
    return modal ? modal.textContent : "";
  });
  check(
    "VC25 modal shows consultation ID, patient, phone, concern, status, created",
    modalText.includes(linked.consultationId) &&
      modalText.includes("Ayesha Khan") &&
      modalText.includes("4455667") &&
      modalText.includes("Hair Loss") &&
      modalText.includes("ACCEPTED") &&
      modalText.includes("Created Date & Time"),
    modalText.slice(0, 120)
  );
  check(
    "VC26 modal shows the REAL related appointment + doctor + clinic",
    modalText.includes("APT-") &&
      modalText.includes("Hina Noor") &&
      modalText.includes("Derma Virtual — DHA"),
    "appointment/doctor/clinic"
  );
  check(
    "VC27 modal shows preferred date/time + notes + no-video honesty note",
    modalText.includes("Preferred Date & Time") &&
      modalText.includes("Prefers evening slot") &&
      modalText.includes("No video provider is configured yet"),
    "preferred/notes/note"
  );
  // The patient's uploads are fetched when the modal opens — wait for the
  // real result (list or honest empty line) before asserting it.
  await page.waitForFunction(
    () => {
      const modal = document.querySelector(".fixed.inset-0.z-50");
      if (!modal) return false;
      const t = modal.textContent ?? "";
      return (
        t.includes("No uploaded reports or images for this patient yet.") ||
        t.includes("Uploaded Reports / Images") && !t.includes("Loading...")
      );
    },
    { timeout: 15000 }
  );
  const modalText2 = await page.evaluate(() => {
    const modal = document.querySelector(".fixed.inset-0.z-50");
    return modal ? modal.textContent : "";
  });
  check(
    "VC28 patient's uploads section states the truth (no fake files)",
    modalText2.includes("No uploaded reports or images for this patient yet."),
    "empty uploads"
  );
  await page.screenshot({ path: shot("view-modal") });
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll(".fixed.inset-0.z-50 button")).find((b) =>
      b.textContent.trim() === "Close"
    );
    btn?.click();
  });
  await page.waitForFunction(() => !document.querySelector(".fixed.inset-0.z-50"));

  // ---- 9. real workflow: Accept -> Start -> Complete (PATCH to backend) ----
  const pendingId = byStatus.pending;
  await page.evaluate((cid) => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find(
      (r) => (r.querySelectorAll("td")[0]?.textContent ?? "").trim() === cid
    );
    const btn = Array.from(row?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent.includes("Accept")
    );
    btn?.click();
  }, pendingId);
  await page.waitForFunction(
    (cid) => {
      const row = Array.from(document.querySelectorAll("tbody tr")).find(
        (r) => (r.querySelectorAll("td")[0]?.textContent ?? "").trim() === cid
      );
      return row && row.querySelectorAll("td")[5].textContent.includes("Start Consultation");
    },
    { timeout: 20000 },
    pendingId
  );
  check("VC29 Accept advances pending -> accepted in the row", true);
  await page.evaluate((cid) => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find(
      (r) => (r.querySelectorAll("td")[0]?.textContent ?? "").trim() === cid
    );
    const btn = Array.from(row?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent.includes("Start Consultation")
    );
    btn?.click();
  }, pendingId);
  await page.waitForFunction(
    (cid) => {
      const row = Array.from(document.querySelectorAll("tbody tr")).find(
        (r) => (r.querySelectorAll("td")[0]?.textContent ?? "").trim() === cid
      );
      return row && row.querySelectorAll("td")[5].textContent.includes("Complete");
    },
    { timeout: 20000 },
    pendingId
  );
  check("VC30 Start Consultation advances accepted -> in progress", true);
  await page.evaluate((cid) => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find(
      (r) => (r.querySelectorAll("td")[0]?.textContent ?? "").trim() === cid
    );
    const btn = Array.from(row?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent.trim() === "Complete"
    );
    btn?.click();
  }, pendingId);
  await page.waitForFunction(
    (cid) => {
      const row = Array.from(document.querySelectorAll("tbody tr")).find(
        (r) => (r.querySelectorAll("td")[0]?.textContent ?? "").trim() === cid
      );
      const badge = row?.querySelectorAll("td")[5]?.parentElement;
      void badge;
      return row && row.textContent.includes("COMPLETED");
    },
    { timeout: 20000 },
    pendingId
  );
  const doneActions = await actionLabels(page, pendingId);
  check("VC31 Complete finishes in_progress -> completed (View only)", eq(doneActions, ["View"]), JSON.stringify(doneActions));

  // Persisted in the DATABASE (not just local React state)?
  const persisted = await fetch(`${BASE}/api/virtual-consultations`, {
    headers: { Authorization: `Bearer ${state.token}` },
  }).then((r) => r.json());
  const fromDb = (persisted.data ?? []).find((c) => c.consultationId === pendingId);
  check("VC32 workflow persisted in PostgreSQL", fromDb?.status === "completed", fromDb?.status);

  // ---- 10. create consultation (real POST) ----
  await page.$$eval("main > div:first-child button", (btns) => {
    const b = btns.find((x) => x.textContent.includes("New Consultation"));
    b?.click();
  });
  await page.waitForFunction(
    () => document.querySelector(".fixed.inset-0.z-50 h3")?.textContent?.includes("New Virtual Consultation"),
    { timeout: 10000 }
  );
  // submit empty -> field errors (client mirrors server rules)
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll(".fixed.inset-0.z-50 button")).find((b) =>
      b.textContent.includes("Create Consultation")
    );
    btn?.click();
  });
  await page.waitForFunction(() => {
    const modal = document.querySelector(".fixed.inset-0.z-50");
    return modal && modal.textContent.includes("Please select a patient.");
  });
  check("VC33 empty create form shows field validation", true);

  // pick the patient in the modal FormSelect
  const picked = await page.$$eval('button[aria-haspopup="listbox"]', (btns) => {
    const b = btns.find((x) => x.textContent.includes("Select patient"));
    if (!b) return false;
    b.click();
    return true;
  });
  if (picked) {
    await page.waitForSelector('[role="listbox"]', { timeout: 5000 });
    await page.$$eval('[role="listbox"] button', (opts) => {
      const o = opts.find((x) => x.textContent.includes("Ayesha Khan"));
      if (o) o.click();
    });
  }
  check("VC34 patient selectable from existing records", picked);
  await page.type('.fixed.inset-0.z-50 input[list="vc-concern-options"]', "Skin Allergy");
  await page.screenshot({ path: shot("create-modal") });
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll(".fixed.inset-0.z-50 button")).find((b) =>
      b.textContent.includes("Create Consultation")
    );
    btn?.click();
  });
  await page.waitForFunction(
    () =>
      !document.querySelector(".fixed.inset-0.z-50") &&
      document.querySelectorAll("tbody tr").length === 6,
    { timeout: 30000 }
  );
  const newTop = await page.$$eval("tbody tr:first-child td", (td) =>
    td.map((x) => x.textContent.trim())
  );
  check(
    "VC35 new consultation appears at the top with a fresh VC id + PENDING",
    /^VC-\d{8}-\d{4}$/.test(newTop[0]) &&
      !state.created.some((c) => c.consultationId === newTop[0]) &&
      newTop[4] === "PENDING",
    `${newTop[0]} / ${newTop[4]}`
  );
  const toastVisible = await page.evaluate(() =>
    document.body.textContent.includes("Consultation request created.")
  );
  check("VC36 success toast shown", toastVisible);

  // ---- 11. Refresh does a real refetch without duplicates ----
  await page.$$eval("main > div:first-child button", (btns) => {
    const b = btns.find((x) => x.textContent.includes("Refresh Consultations"));
    b?.click();
    b?.click(); // duplicate click must be ignored by the busy guard
  });
  await page.waitForFunction(
    () => !document.querySelector("main button[disabled]"),
    { timeout: 30000 }
  );
  await new Promise((r) => setTimeout(r, 400));
  check("VC37 Refresh keeps exactly 6 rows (no dupes, real refetch)", (await rowCount(page)) === 6);

  // ---- 12. loading / empty / error states (network interception) ----
  await page.setRequestInterception(true);
  const interceptMode = { mode: null, active: true };
  page.on("request", (req) => {
    if (!interceptMode.active) return; // interception was turned off again
    const url = req.url();
    if (interceptMode.mode && url.includes("/api/virtual-consultations")) {
      if (interceptMode.mode === "loading") {
        // hold the response so the skeleton stays visible
        return;
      }
      if (interceptMode.mode === "empty") {
        return req.respond({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ data: [], error: null, success: true, message: "Consultations loaded" }),
        });
      }
      if (interceptMode.mode === "error") {
        return req.respond({
          status: 500,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            data: null,
            error: "Unable to load virtual consultations",
            success: false,
            message: "Unable to load virtual consultations",
          }),
        });
      }
    }
    try {
      return req.continue();
    } catch {
      return; // interception already disabled — the browser handles it
    }
  });

  // loading skeleton
  interceptMode.mode = "loading";
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".animate-pulse", { timeout: 20000 });
  check("VC38 loading state shows a clean skeleton (no fake rows)", true);
  await page.screenshot({ path: shot("loading") });

  // empty state
  interceptMode.mode = "empty";
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.body.textContent.includes("No virtual consultations yet."),
    { timeout: 20000 }
  );
  const emptyOk = await page.evaluate(() =>
    document.body.textContent.includes(
      "Patient virtual consultation requests will appear here."
    )
  );
  check("VC39 empty state matches spec wording", emptyOk);
  await page.screenshot({ path: shot("empty") });

  // error state + Retry recovers
  interceptMode.mode = "error";
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () => document.body.textContent.includes("Unable to load virtual consultations."),
    { timeout: 20000 }
  );
  check("VC40 error state shows spec wording", true);
  await page.screenshot({ path: shot("error") });
  interceptMode.mode = null; // Retry must hit the real backend
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.trim() === "Retry"
    );
    btn?.click();
  });
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 6, {
    timeout: 30000,
  });
  check("VC41 Retry recovers and loads the real data", true);
  interceptMode.active = false;
  await page.setRequestInterception(false);

  // ---- 13. responsive: scrolling confined to the table on mobile ----
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  // Let the reflow settle (and any dev-reload finish) before measuring.
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 6, {
    timeout: 30000,
  });
  await new Promise((r) => setTimeout(r, 800));
  const geo = await page.evaluate(() => {
    const scroller = document.querySelector("main .overflow-x-auto");
    return {
      docScroll: document.documentElement.scrollWidth,
      docClient: document.documentElement.clientWidth,
      innerCanScroll: scroller ? scroller.scrollWidth > scroller.clientWidth : false,
      tablePresent: Boolean(document.querySelector("table")),
    };
  });
  check(
    "VC42 no page-level horizontal scroll on mobile",
    geo.docScroll <= geo.docClient + 1,
    `scroll=${geo.docScroll} client=${geo.docClient}`
  );
  check(
    "VC43 table container scrolls horizontally inside itself",
    geo.tablePresent && geo.innerCanScroll,
    `table=${geo.tablePresent} innerScrolls=${geo.innerCanScroll}`
  );
  await page.screenshot({ path: shot("mobile"), fullPage: true });
  await page.setViewport({ width: 1440, height: 900 });

  // ---- 14. clean console ----
  check("VC44 zero console/page errors during the run", consoleErrors.length === 0, consoleErrors.join(" ;; ").slice(0, 300));
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(results.join("\n"));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`screenshots: ${SHOT_DIR}`);
process.exit(failed.length === 0 ? 0 : 1);
