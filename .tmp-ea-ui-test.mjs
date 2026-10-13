/**
 * UI TEST — Urgent Dermatology Alerts Log, driven through real Chrome
 * against the running dev server (:3000), using the seeded throwaway
 * business (.tmp-ea-seed.mjs must run first).
 *
 * Verifies the page a human actually uses: exact title/subtitle, the 7 spec
 * columns, live rows, per-status actions, search (id/name/phone/message),
 * priority + status + date filters, view modal (real appointment/clinic/
 * notes), the real workflow (Acknowledge -> In Progress -> Resolve with
 * resolution notes), the required dismiss confirmation, the create form +
 * validation, refresh (real re-fetch, duplicate blocked), loading/error
 * states, mobile scroll confinement, sidebar navigation, the empty state,
 * and a clean console.
 *
 * Screenshots go to the OS temp dir (outside the project, so the Next dev
 * watcher never reloads the page mid-test).
 *
 * Requires: npm i -D puppeteer-core (locally installed Chrome).
 * Run: TEST_PORT=3000 node .tmp-ea-ui-test.mjs
 */
import fs from "fs";
import os from "os";
import path from "path";
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = `http://localhost:${process.env.TEST_PORT || "3000"}`;
const state = JSON.parse(fs.readFileSync(".tmp-ea-ui.json", "utf8"));
const SHOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ea-ui-"));

const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

const consoleErrors = [];
const rowCount = (page) => page.evaluate(() => document.querySelectorAll("tbody tr").length);

/** Status + action buttons of the row whose text contains `frag`. */
const rowInfo = (page, frag) =>
  page.evaluate((f) => {
    const row = Array.from(document.querySelectorAll("tbody tr")).find((r) =>
      r.textContent.includes(f)
    );
    if (!row) return null;
    const tds = row.querySelectorAll("td");
    return {
      patient: (tds[0]?.textContent ?? "").trim(),
      phone: (tds[1]?.textContent ?? "").trim(),
      priority: (tds[2]?.textContent ?? "").trim(),
      message: (tds[3]?.textContent ?? "").trim(),
      created: (tds[4]?.textContent ?? "").trim(),
      status: (tds[5]?.textContent ?? "").trim(),
      actions: Array.from(tds[6]?.querySelectorAll("button") ?? []).map((b) => b.textContent.trim()),
    };
  }, frag);

async function clickRowAction(page, frag, label) {
  return page.evaluate(
    (f, l) => {
      const row = Array.from(document.querySelectorAll("tbody tr")).find((r) =>
        r.textContent.includes(f)
      );
      if (!row) return false;
      const btn = Array.from(row.querySelectorAll("td")[6].querySelectorAll("button")).find(
        (b) => b.textContent.trim() === l
      );
      if (!btn) return false;
      btn.click();
      return true;
    },
    frag,
    label
  );
}

/** Read a labelled value from the open view modal. */
const modalField = (page, label) =>
  page.evaluate((l) => {
    const el = Array.from(document.querySelectorAll("div p")).find(
      (x) => x.textContent.trim() === l
    );
    if (!el || !el.parentElement || !el.parentElement.children[1]) return null;
    return el.parentElement.children[1].textContent.trim();
  }, label);

const modalOpen = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("div.fixed")).some((d) =>
      d.textContent.includes("Emergency Alert Details")
    )
  );

const confirmOpen = (page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll("div.fixed")).some((d) =>
      d.textContent.includes("Dismiss this alert?")
    )
  );

function clickInModal(page, modalTitle, label) {
  return page.evaluate(
    (t, l) => {
      const modal = Array.from(document.querySelectorAll("div.fixed")).find((d) =>
        d.textContent.includes(t)
      );
      if (!modal) return false;
      const btn = Array.from(modal.querySelectorAll("button")).find(
        (b) => b.textContent.trim() === l
      );
      if (!btn) return false;
      btn.click();
      return true;
    },
    modalTitle,
    label
  );
}

/** Pick an option from one of the FormSelect listboxes. */
async function pickSelect(page, btnFragment, optionText) {
  const opened = await page.$$eval(
    'button[aria-haspopup="listbox"]',
    (btns, frag) => {
      const b = btns.find((x) => x.textContent.includes(frag));
      if (!b) return false;
      b.click();
      return true;
    },
    btnFragment
  );
  if (!opened) return false;
  await page.waitForSelector('[role="listbox"]', { timeout: 5000 });
  const picked = await page.$$eval(
    '[role="listbox"] button',
    (opts, target) => {
      // Options may render a hint next to the label (label + hint concatenated).
      const o = opts.find((x) => {
        const t = x.textContent.trim();
        return t === target || t.startsWith(target);
      });
      if (o) o.click();
      return !!o;
    },
    optionText
  );
  await new Promise((r) => setTimeout(r, 250));
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

const waitForToast = async (page, text) => {
  try {
    await page.waitForFunction(
      (t) => {
        const el = document.querySelector("div.fixed.bottom-6");
        return el && el.textContent.includes(t);
      },
      { timeout: 8000 },
      text
    );
    return true;
  } catch {
    return false;
  }
};

/** Control how /api/emergency-alerts GET requests behave (null = normal). */
let listMode = null; // null | "fail500" | "delay"
let listBody = "";
async function setListMode(page, mode) {
  if (mode && !page.__eaListener) {
    page.__eaListener = async (req) => {
      const u = req.url();
      if (!u.includes("/api/emergency-alerts") || req.method() !== "GET") {
        return req.continue();
      }
      if (listMode === "fail500") {
        return req.respond({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ data: null, error: "fail", success: false, message: "fail" }),
        });
      }
      if (listMode === "delay") {
        await new Promise((r) => setTimeout(r, 1400));
        return req.respond({ status: 200, contentType: "application/json", body: listBody });
      }
      return req.continue();
    };
    page.on("request", page.__eaListener);
    await page.setRequestInterception(true);
  } else if (!mode && page.__eaListener) {
    page.off("request", page.__eaListener);
    page.__eaListener = null;
    await page.setRequestInterception(false);
  }
  listMode = mode;
}

const pad2 = (n) => String(n).padStart(2, "0");
const localDay = (d) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(45000);
  await page.setViewport({ width: 1440, height: 900 });
  page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e}`));
  page.on("console", (m) => {
    const url = m.location()?.url ?? "";
    const text = m.text();
    if (m.type() === "error" && !url.includes("favicon")) {
      // Network-level notices are covered by explicit state assertions
      // (the error tests deliberately inject a 500 through interception).
      if (text.startsWith("Failed to load resource")) return;
      consoleErrors.push(`console: ${text} @ ${url}`);
    }
  });

  const a1 = state.alerts.find((x) => x.status === "new"); // critical NEW
  const a1Day = localDay(new Date(a1.createdAt));
  const tomorrow = localDay(new Date(Date.now() + 24 * 3600 * 1000));

  // Authenticate exactly the way the app does: JWT in localStorage.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), state.token);
  await page.goto(`${BASE}/dashboard/emergency-alerts`, { waitUntil: "domcontentloaded" });

  // ---- 1. shell ----
  await page.waitForFunction(
    () => document.querySelector("h1")?.textContent?.includes("Urgent Dermatology"),
    { timeout: 60000 }
  );
  const h1 = await page.$eval("h1", (el) => el.textContent.trim());
  check("EA1  page title matches spec", h1 === "🚨 Urgent Dermatology Alerts Log", h1);
  const subtitle = await page.$eval("main p", (el) => el.textContent.trim());
  check(
    "EA2  subtitle matches spec",
    subtitle === "Monitor and manage urgent patient alerts and follow-up actions.",
    subtitle
  );

  const headerButtons = await page.$$eval("main > div:first-child button", (b) =>
    b.map((x) => x.textContent.trim())
  );
  check(
    "EA3  Create Alert + Refresh Alerts present",
    headerButtons.some((t) => t.includes("Create Alert")) &&
      headerButtons.some((t) => t.includes("Refresh Alerts")),
    headerButtons.join(" / ")
  );

  const searchPh = await page.$eval('input[aria-label="Search emergency alerts"]', (el) => el.placeholder);
  check("EA4  search placeholder matches spec", searchPh === "Search emergency alerts...", searchPh);

  const selectLabels = await page.$$eval('button[aria-haspopup="listbox"]', (b) =>
    b.map((x) => x.textContent.trim())
  );
  check(
    "EA5  priority + status filters present",
    selectLabels.some((t) => t.startsWith("Priority:")) && selectLabels.some((t) => t.startsWith("Status:")),
    selectLabels.join(" / ")
  );
  const hasDate = await page.$('input[aria-label="Filter by created date"]');
  check("EA6  date filter present", Boolean(hasDate));

  // ---- 2. columns + rows ----
  // Wait for the table itself first (it is hidden behind the skeleton while loading).
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length >= 5, {
    timeout: 30000,
  });
  const heads = await page.$$eval("thead th", (ths) => ths.map((t) => t.textContent.trim()));
  const want = ["Patient", "Phone", "Priority", "Alert Message", "Created Date & Time", "Status", "Actions"];
  check(
    "EA7  exact 7 spec columns",
    heads.length === 7 && heads.every((h, i) => h === want[i]),
    heads.join(" | ")
  );
  check("EA8  all 5 seeded rows render", (await rowCount(page)) === 5, `n=${await rowCount(page)}`);

  const r1 = await rowInfo(page, "Severe allergic reaction");
  check(
    "EA9  NEW row shows patient/phone/priority/status/actions",
    r1 && r1.patient.includes("Muhammad Ahmed") && r1.phone === "+92 300 1112223" &&
      r1.priority === "Critical" && r1.status === "New" &&
      ["View Details", "Acknowledge", "Dismiss"].every((x) => r1.actions.includes(x)),
    r1 ? `${r1.patient} / ${r1.priority} / ${r1.status} / ${r1.actions.join(",")}` : "row missing"
  );
  const r4 = await rowInfo(page, "sunburn");
  check(
    "EA10  alert without patient shows dashes (no invented data)",
    r4 && r4.patient === "—" && r4.phone === "—" && r4.priority === "Low",
    r4 ? `${r4.patient} / ${r4.phone}` : "row missing"
  );
  const r2 = await rowInfo(page, "hives");
  check(
    "EA11  ACKNOWLEDGED actions",
    r2 && r2.status === "Acknowledged" &&
      r2.actions.join(",") === "View Details,Mark In Progress,Mark Resolved",
    r2 ? r2.actions.join(",") : "row missing"
  );
  const r3 = await rowInfo(page, "psoriasis");
  check(
    "EA12  IN PROGRESS actions",
    r3 && r3.status === "In Progress" && r3.actions.join(",") === "View Details,Mark Resolved",
    r3 ? r3.actions.join(",") : "row missing"
  );
  check(
    "EA13  RESOLVED actions = View only",
    r4 && r4.status === "Resolved" && r4.actions.join(",") === "View Details",
    r4 ? r4.actions.join(",") : "row missing"
  );
  const r5 = await rowInfo(page, "Persistent itching");
  check(
    "EA14  DISMISSED actions = View only",
    r5 && r5.status === "Dismissed" && r5.actions.join(",") === "View Details",
    r5 ? r5.actions.join(",") : "row missing"
  );
  const createdOk = r1 && r1.created.includes("·");
  check("EA15  created date & time cell rendered", createdOk, r1?.created);

  // ---- 3. search ----
  await typeInto(page, 'input[aria-label="Search emergency alerts"]', "Muhammad Ahmed");
  await new Promise((r) => setTimeout(r, 250));
  check("EA16  search by patient name -> 4 rows", (await rowCount(page)) === 4, `n=${await rowCount(page)}`);
  await typeInto(page, 'input[aria-label="Search emergency alerts"]', "300 111");
  await new Promise((r) => setTimeout(r, 250));
  check("EA17  search by phone -> 4 rows", (await rowCount(page)) === 4, `n=${await rowCount(page)}`);
  await typeInto(page, 'input[aria-label="Search emergency alerts"]', "hives");
  await new Promise((r) => setTimeout(r, 250));
  check("EA18  search by message -> 1 row", (await rowCount(page)) === 1, `n=${await rowCount(page)}`);
  await typeInto(page, 'input[aria-label="Search emergency alerts"]', a1.alertId);
  await new Promise((r) => setTimeout(r, 250));
  check(
    "EA19  search by alert ID -> 1 row",
    (await rowCount(page)) === 1 && (await page.evaluate(() => document.body.textContent.includes("Severe allergic"))),
    `n=${await rowCount(page)} id=${a1.alertId}`
  );
  await typeInto(page, 'input[aria-label="Search emergency alerts"]', "zzz-no-such-alert");
  await new Promise((r) => setTimeout(r, 300));
  const noMatch = await page.evaluate(() => document.body.textContent.includes("No alerts match your search."));
  check("EA20  no-match state shown", noMatch);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Clear");
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 250));
  check("EA21  Clear restores all rows", (await rowCount(page)) === 5, `n=${await rowCount(page)}`);

  // ---- 4. filters ----
  check("EA22  priority filter Critical -> 2 rows", await (async () => {
    await pickSelect(page, "Priority:", "Priority: Critical");
    await new Promise((r) => setTimeout(r, 250));
    const n = await rowCount(page);
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Clear");
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 250));
    return n === 2;
  })());
  check("EA23  status filter New -> 1 row (a1)", await (async () => {
    await pickSelect(page, "Status:", "Status: New");
    await new Promise((r) => setTimeout(r, 250));
    const n = await rowCount(page);
    const onlyNew = await page.evaluate(() => document.body.textContent.includes("Severe allergic"));
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Clear");
      btn?.click();
    });
    await new Promise((r) => setTimeout(r, 250));
    return n === 1 && onlyNew;
  })());
  await setDateString(page, a1Day);
  await new Promise((r) => setTimeout(r, 300));
  check("EA24  date filter (seed day) -> 5 rows", (await rowCount(page)) === 5, `n=${await rowCount(page)}`);
  await setDateString(page, tomorrow);
  await new Promise((r) => setTimeout(r, 300));
  check(
    "EA25  date filter (other day) -> no-match state",
    await page.evaluate(() => document.body.textContent.includes("No alerts match your search."))
  );
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) => b.textContent.trim() === "Clear");
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 250));
  check("EA26  Clear resets filters", (await rowCount(page)) === 5, `n=${await rowCount(page)}`);

  // ---- 5. view modal ----
  await clickRowAction(page, "Severe allergic reaction", "View Details");
  await page.waitForFunction(
    () => document.body.textContent.includes("Emergency Alert Details"),
    { timeout: 8000 }
  );
  const vId = await modalField(page, "Alert ID");
  const vPatient = await modalField(page, "Patient Name");
  const vPhone = await modalField(page, "Patient Phone");
  const vPriority = await modalField(page, "Priority");
  const vStatus = await modalField(page, "Status");
  const vCreated = await modalField(page, "Created Date & Time");
  const vMessage = await modalField(page, "Alert Message");
  const vAppt = await modalField(page, "Related Appointment");
  const vClinic = await modalField(page, "Related Clinic");
  check(
    "EA27  view modal shows alert ID/patient/phone/priority/status/created/message",
    vId === a1.alertId && vPatient.includes("Muhammad Ahmed") && vPhone === "+92 300 1112223" &&
      vPriority.includes("Critical") && vStatus.includes("New") &&
      vCreated !== "—" && vCreated !== null && vMessage.includes("Severe allergic reaction"),
    `${vId} / ${vPriority} / ${vStatus} / ${vCreated}`
  );
  check(
    "EA28  view modal shows REAL related appointment + clinic",
    (vAppt ?? "").includes(state.appointmentCode) && (vClinic ?? "").includes("EA Test Clinic"),
    `${vAppt} / ${vClinic}`
  );
  await page.screenshot({ path: path.join(SHOT_DIR, "view-modal.png") });
  await clickInModal(page, "Emergency Alert Details", "Close");
  await new Promise((r) => setTimeout(r, 300));
  check("EA29  view modal closes", !(await modalOpen(page)));

  // ---- 6. create ----
  await page.evaluate(() => {
    window.__eaNoReload = 1;
  });
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("main button")).find((b) =>
      b.textContent.includes("Create Alert")
    );
    btn?.click();
  });
  await page.waitForFunction(() => document.body.textContent.includes("Create Emergency Alert"), {
    timeout: 8000,
  });
  // Empty submit -> required-field validation (no request is sent).
  await clickInModal(page, "Create Emergency Alert", "Create Alert");
  await new Promise((r) => setTimeout(r, 300));
  const invalid = await page.evaluate(() => {
    const t = document.body.textContent;
    return t.includes("Please choose a priority.") && t.includes("Alert message is required.");
  });
  check("EA30  empty create form shows required-field errors", invalid);
  // Fill: patient + priority + message.
  await pickSelect(page, "No patient", "Muhammad Ahmed");
  await pickSelect(page, "Select priority", "High");
  const NEW_MSG = "New rash after prescribed dosage — created from the UI test.";
  await page.evaluate((m) => {
    const modal = Array.from(document.querySelectorAll("div.fixed")).find((d) =>
      d.textContent.includes("Create Emergency Alert")
    );
    const ta = modal.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, m);
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  }, NEW_MSG);
  await page.screenshot({ path: path.join(SHOT_DIR, "create-modal.png") });
  await clickInModal(page, "Create Emergency Alert", "Create Alert");
  const toastCreated = await waitForToast(page, "Emergency alert recorded.");
  check("EA31  create succeeds with success toast", toastCreated);
  await new Promise((r) => setTimeout(r, 300));
  check("EA32  new row prepended (6 rows, no browser reload)",
    (await rowCount(page)) === 6 && (await page.evaluate(() => window.__eaNoReload === 1)),
    `n=${await rowCount(page)}`);
  const created = await rowInfo(page, "created from the UI test");
  check(
    "EA33  created row shows real data (patient, High, New)",
    created && created.patient.includes("Muhammad Ahmed") && created.priority === "High" &&
      created.status === "New" && created.actions.includes("Dismiss"),
    created ? `${created.priority} / ${created.status}` : "row missing"
  );

  // ---- 7. dismiss requires confirmation ----
  await clickRowAction(page, "created from the UI test", "Dismiss");
  await page.waitForFunction(() => document.body.textContent.includes("Dismiss this alert?"), {
    timeout: 8000,
  });
  check("EA34  dismiss asks for confirmation", await confirmOpen(page));
  await clickInModal(page, "Dismiss this alert?", "Cancel");
  await new Promise((r) => setTimeout(r, 300));
  const afterCancel = await rowInfo(page, "created from the UI test");
  check(
    "EA35  cancelling keeps the alert New",
    !(await confirmOpen(page)) && afterCancel?.status === "New",
    afterCancel?.status
  );
  await clickRowAction(page, "created from the UI test", "Dismiss");
  await page.waitForFunction(() => document.body.textContent.includes("Dismiss this alert?"), {
    timeout: 8000,
  });
  await clickInModal(page, "Dismiss this alert?", "Dismiss Alert");
  const toastDismissed = await waitForToast(page, "Alert dismissed.");
  const afterDismiss = await rowInfo(page, "created from the UI test");
  check(
    "EA36  confirming dismisses the alert + toast + View only",
    toastDismissed && afterDismiss?.status === "Dismissed" &&
      afterDismiss.actions.join(",") === "View Details",
    `${afterDismiss?.status} / ${afterDismiss?.actions.join(",")}`
  );

  // ---- 8. full workflow with resolution notes ----
  await clickRowAction(page, "Severe allergic reaction", "Acknowledge");
  const ackToast = await waitForToast(page, "Alert acknowledged.");
  const r1b = await rowInfo(page, "Severe allergic reaction");
  check(
    "EA37  Acknowledge persists + actions advance",
    ackToast && r1b?.status === "Acknowledged" && r1b.actions.includes("Mark In Progress"),
    r1b?.status
  );
  await clickRowAction(page, "Severe allergic reaction", "Mark In Progress");
  const progToast = await waitForToast(page, "Alert marked in progress.");
  const r1c = await rowInfo(page, "Severe allergic reaction");
  check(
    "EA38  Mark In Progress persists",
    progToast && r1c?.status === "In Progress" && r1c.actions.join(",") === "View Details,Mark Resolved",
    r1c?.status
  );
  await clickRowAction(page, "Severe allergic reaction", "View Details");
  await page.waitForFunction(() => document.body.textContent.includes("Emergency Alert Details"), {
    timeout: 8000,
  });
  await page.evaluate(() => {
    const modal = Array.from(document.querySelectorAll("div.fixed")).find((d) =>
      d.textContent.includes("Emergency Alert Details")
    );
    const ta = modal.querySelector("textarea");
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    setter.call(ta, "Escalated to the on-call dermatologist; cream prescribed.");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await clickInModal(page, "Emergency Alert Details", "Mark Resolved");
  const resToast = await waitForToast(page, "Alert resolved.");
  const vStatus2 = await modalField(page, "Status");
  const vNotes = await modalField(page, "Resolution Notes");
  check(
    "EA39  Mark Resolved from modal persists status + resolution notes",
    resToast && (vStatus2 ?? "").includes("Resolved") &&
      (vNotes ?? "").includes("Escalated to the on-call dermatologist"),
    `${vStatus2} / ${vNotes}`
  );
  await clickInModal(page, "Emergency Alert Details", "Close");
  await new Promise((r) => setTimeout(r, 300));

  // ---- 9. persistence after a real reload ----
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length >= 6, {
    timeout: 30000,
  });
  const persist1 = await rowInfo(page, "Severe allergic reaction");
  const persist2 = await rowInfo(page, "created from the UI test");
  check(
    "EA40  statuses persist after reload (Resolved + Dismissed)",
    persist1?.status === "Resolved" && persist2?.status === "Dismissed",
    `${persist1?.status} / ${persist2?.status}`
  );
  const notesAfterReload = await (async () => {
    await clickRowAction(page, "Severe allergic reaction", "View Details");
    await page.waitForFunction(() => document.body.textContent.includes("Emergency Alert Details"), {
      timeout: 8000,
    });
    const n = await modalField(page, "Resolution Notes");
    await clickInModal(page, "Emergency Alert Details", "Close");
    return n;
  })();
  check(
    "EA41  resolution notes persist after reload",
    (notesAfterReload ?? "").includes("Escalated to the on-call dermatologist"),
    notesAfterReload ?? "null"
  );

  // ---- 10. refresh really re-fetches; duplicates are blocked ----
  let listCalls = 0;
  const counter = (req) => {
    if (req.url().includes("/api/emergency-alerts") && req.method() === "GET") listCalls++;
  };
  page.on("request", counter);
  const baseline = 0;
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("main button")).find((b) =>
      b.textContent.includes("Refresh Alerts")
    );
    btn.click();
    btn.click(); // immediately — must be swallowed by the busy guard
  });
  await new Promise((r) => setTimeout(r, 2500));
  page.off("request", counter);
  check(
    "EA42  refresh re-fetches from backend; duplicate click blocked",
    listCalls === baseline + 1,
    `listCalls=${listCalls}`
  );

  // ---- 11. refresh failure shows a banner + retry recovers ----
  await setListMode(page, "fail500");
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("main button")).find((b) =>
      b.textContent.includes("Refresh Alerts")
    );
    btn?.click();
  });
  const bannerShown = await page
    .waitForFunction(
      () => document.body.textContent.includes("Unable to refresh emergency alerts."),
      { timeout: 10000 }
    )
    .then(() => true)
    .catch(() => false);
  const rowsStill = await rowCount(page);
  check("EA43  failed refresh shows error banner without losing rows", bannerShown && rowsStill === 6, `rows=${rowsStill}`);
  await setListMode(page, null);
  await page.evaluate(() => {
    const p = Array.from(document.querySelectorAll("p")).find((x) =>
      x.textContent.includes("Unable to refresh emergency alerts.")
    );
    const btn = p?.parentElement?.querySelector("button");
    btn?.click();
  });
  const bannerGone = await page
    .waitForFunction(
      () => !document.body.textContent.includes("Unable to refresh emergency alerts."),
      { timeout: 15000 }
    )
    .then(() => true)
    .catch(() => false);
  check("EA44  banner Retry recovers the list", bannerGone && (await rowCount(page)) === 6, `n=${await rowCount(page)}`);

  // ---- 12. initial-load error state + Retry ----
  await setListMode(page, "fail500");
  await page.reload({ waitUntil: "domcontentloaded" });
  const errShown = await page
    .waitForFunction(
      () =>
        document.body.textContent.includes("Unable to load emergency alerts.") &&
        document.body.textContent.includes("Please try again."),
      { timeout: 30000 }
    )
    .then(() => true)
    .catch(() => false);
  check("EA45  load error state with Retry", errShown);
  await setListMode(page, null);
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent.trim() === "Retry"
    );
    btn?.click();
  });
  const recovered = await page
    .waitForFunction(() => document.querySelectorAll("tbody tr").length >= 6, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
  check("EA46  Retry recovers the list", recovered, `rows=${await rowCount(page)}`);

  // ---- 13. loading skeleton while data is in flight ----
  const fresh = await fetch(`http://localhost:${process.env.TEST_PORT || "3000"}/api/emergency-alerts`, {
    headers: { Authorization: `Bearer ${state.token}` },
  });
  listBody = JSON.stringify(await fresh.json());
  await setListMode(page, "delay");
  await page.reload({ waitUntil: "domcontentloaded" });
  const skeleton = await page
    .waitForSelector("div.animate-pulse", { timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  check("EA47  loading skeleton shown while fetching", skeleton);
  const afterDelay = await page
    .waitForFunction(() => document.querySelectorAll("tbody tr").length >= 6, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  await setListMode(page, null);
  check("EA48  rows replace the skeleton", afterDelay);

  // ---- 14. mobile: scroll stays inside the table container ----
  await page.setViewport({ width: 375, height: 800 });
  await new Promise((r) => setTimeout(r, 400));
  const scroll = await page.evaluate(() => {
    const doc = document.documentElement;
    const box = document.querySelector("main .overflow-x-auto");
    return {
      pageScrolls: doc.scrollWidth > window.innerWidth + 1,
      tableScrolls: box ? box.scrollWidth > box.clientWidth : false,
    };
  });
  check(
    "EA49  no page-wide horizontal scroll; table scrolls internally",
    !scroll.pageScrolls && scroll.tableScrolls,
    JSON.stringify(scroll)
  );
  await page.setViewport({ width: 1440, height: 900 });
  await new Promise((r) => setTimeout(r, 300));

  // ---- 15. sidebar navigation opens this page ----
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  const sidebarClicked = await (async () => {
    try {
      await page.waitForSelector('a[href="/dashboard/emergency-alerts"]', { timeout: 30000 });
      await page.click('a[href="/dashboard/emergency-alerts"]');
      await page.waitForFunction(
        () =>
          location.pathname === "/dashboard/emergency-alerts" &&
          document.querySelector("h1")?.textContent?.includes("Urgent Dermatology"),
        { timeout: 30000 }
      );
      return true;
    } catch {
      return false;
    }
  })();
  check("EA50  sidebar 'Emergency Alerts' navigates to the page", sidebarClicked);

  // ---- 16. empty state on a business without alerts ----
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), state.emptyToken);
  await page.goto(`${BASE}/dashboard/emergency-alerts`, { waitUntil: "domcontentloaded" });
  const emptyShown = await page
    .waitForFunction(
      () =>
        document.body.textContent.includes("No emergency alerts yet.") &&
        document.body.textContent.includes(
          "New emergency alerts will appear here when they are recorded."
        ),
      { timeout: 30000 }
    )
    .then(() => true)
    .catch(() => false);
  check("EA51  empty state matches spec (no fake records)", emptyShown);
  const emptyRows = await rowCount(page);
  check("EA52  empty state has zero table rows", emptyRows === 0, `n=${emptyRows}`);
  await page.screenshot({ path: path.join(SHOT_DIR, "empty-state.png") });

  // ---- 17. console ----
  check("EA53  clean console (no page/JS errors)", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" // "));
} finally {
  await browser.close();
}

const failed = results.filter((x) => x.startsWith("FAIL"));
console.log(results.join("\n"));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`screenshots: ${SHOT_DIR}`);
process.exit(failed.length === 0 ? 0 : 1);
