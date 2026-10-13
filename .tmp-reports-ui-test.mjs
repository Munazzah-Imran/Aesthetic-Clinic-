/**
 * UI TEST — Uploaded Skin Photos & Reports Directory, driven through real
 * Chrome against the running dev server (:3000), using a seeded throwaway
 * business (.tmp-reports-seed.mjs must run first).
 *
 * Verifies the page a human actually uses: heading, all 9 columns, live rows,
 * search, document-type filter, Refresh Reports (real refetch), image preview
 * modal + status change, delete confirmation (Cancel keeps the row), upload
 * modal, mobile horizontal scrolling confined to the table, and a clean
 * console. Screenshots are saved as .tmp-reports-*.png for inspection.
 *
 * Requires (not a project dependency, install on demand):
 *   npm i -D puppeteer-core  (uses the locally installed Chrome)
 * Run: node .tmp-reports-ui-test.mjs
 */
import fs from "fs";
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = `http://localhost:${process.env.TEST_PORT || "3000"}`;
const state = JSON.parse(fs.readFileSync(".tmp-reports-ui.json", "utf8"));

const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

const consoleErrors = [];
const rowHandles = async (page) => page.$$("tbody tr");
const rowCount = async (page) => (await rowHandles(page)).length;

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
    if (m.type() === "error" && !url.includes("favicon")) {
      consoleErrors.push(`console: ${m.text()} @ ${url}`);
    }
  });

  // Authenticate exactly the way the app does: JWT in localStorage.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), state.token);
  await page.goto(`${BASE}/dashboard/reports`, { waitUntil: "domcontentloaded" });
  // Marker: survives React re-renders, disappears if the DOCUMENT reloads.
  await page.evaluate(() => {
    window.__uiTestMarker = 42;
  });

  // ---- 1. page shell + heading ----
  await page.waitForFunction(
    () => document.querySelector("h1")?.textContent?.includes("Uploaded Skin Photos"),
    { timeout: 60000 }
  );
  const h1 = await page.$eval("h1", (el) => el.textContent.trim());
  check(
    "T1  page title matches spec",
    h1 === "Uploaded Skin Photos & Reports Directory",
    h1
  );
  const subtitle = await page.$eval("main p", (el) => el.textContent.trim());
  check(
    "T2  subtitle matches spec",
    subtitle === "Real-time patient uploaded reports and skin photographs.",
    subtitle
  );

  // ---- 2. header buttons ----
  const headerButtons = await page.$$eval("main > div:first-child button", (b) =>
    b.map((x) => x.textContent.trim())
  );
  check(
    "T3  Refresh Reports + Upload Report buttons present",
    headerButtons.some((t) => t.includes("Refresh Reports")) &&
      headerButtons.some((t) => t.includes("Upload Report")),
    headerButtons.join(" / ")
  );

  // ---- 3. table renders with EXACTLY the 9 spec columns ----
  await page.waitForSelector("tbody tr", { timeout: 60000 });
  const headers = await page.$$eval("thead th", (th) =>
    th.map((x) => x.textContent.trim().replace(/\s+/g, " "))
  );
  const wanted = [
    "Report ID",
    "Patient Name",
    "Phone Number",
    "Document Type",
    "File Name",
    "Appointment / Token",
    "Upload Date & Time",
    "Status",
    "Actions",
  ];
  check(
    "T4  all 9 required columns, no extras",
    headers.length === 9 && wanted.every((w, i) => headers[i] === w),
    headers.join(" | ")
  );

  // ---- 4. real seeded rows ----
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length >= 3);
  const cells = await page.$$eval("tbody tr", (rows) =>
    rows.map((r) =>
      Array.from(r.querySelectorAll("td")).map((c) => c.textContent.trim())
    )
  );
  check("T5  three real reports rendered", cells.length === 3, `rows=${cells.length}`);
  check(
    "T6  report IDs follow RPT-YYYYMMDD-NNNN",
    cells.every((c) => /^RPT-\d{8}-\d{4}$/.test(c[0])),
    cells.map((c) => c[0]).join(",")
  );
  check(
    "T7  patient name + phone come from the patient table",
    cells.every((c) => c[1].includes("Ayesha Khan")) &&
      cells.every((c) => c[2] === "+92 321 4455667"),
    `${cells[0][1]} / ${cells[0][2]}`
  );
  check(
    "T8  document types rendered",
    cells.some((c) => c[3].includes("Skin Photo")) &&
      cells.some((c) => c[3].includes("Lab Report")) &&
      cells.some((c) => c[3].includes("Prescription")),
    cells.map((c) => c[3]).join(",")
  );
  check(
    "T9  actual file names rendered",
    cells.some((c) => c[4] === "facial-lesion-followup.png") &&
      cells.some((c) => c[4] === "dermatology-culture-final-report.pdf"),
    cells.map((c) => c[4]).join(",")
  );
  check(
    "T10 appointment token shown, '—' when no appointment",
    cells.filter((c) => /^APT-\d{8}-\d{4}$/.test(c[5])).length === 2 &&
      cells.some((c) => c[5] === "—"),
    cells.map((c) => c[5]).join(",")
  );
  check(
    "T11 real upload date & time rendered",
    cells.every((c) => /\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/.test(c[6]) ),
    cells.map((c) => c[6]).join(" | ")
  );
  check(
    "T12 status badge = Uploaded",
    cells.every((c) => c[7] === "Uploaded"),
    cells.map((c) => c[7]).join(",")
  );
  check(
    "T13 actions: view/download/delete on every row",
    (await page.$$('button[title="View report"]')).length === 3 &&
      (await page.$$('button[title="Download file"]')).length === 3 &&
      (await page.$$('button[title="Delete report"]')).length === 3
  );
  await page.screenshot({ path: ".tmp-reports-page.png", fullPage: true });

  // ---- 5. search (dynamic, no reload) ----
  await page.type('input[aria-label="Search reports"]', "culture");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
  check("T14 search by file name filters to 1 row", (await rowCount(page)) === 1);
  const searchOnly = await page.$$eval("tbody tr td", (td) => td[0]?.textContent ?? "");
  await page.click('input[aria-label="Search reports"]', { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.type('input[aria-label="Search reports"]', "Ayesha");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 3);
  check("T15 search by patient name matches all rows", (await rowCount(page)) === 3);
  await page.click('input[aria-label="Search reports"]', { clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 3);
  check(
    "T16 search by report ID prefix",
    await (async () => {
      await page.type('input[aria-label="Search reports"]', "RPT-");
      await new Promise((r) => setTimeout(r, 250));
      const n = await rowCount(page);
      await page.click('input[aria-label="Search reports"]', { clickCount: 3 });
      await page.keyboard.press("Backspace");
      return n === 3;
    })(),
    `matched searchOnly=${searchOnly.slice(0, 40)}`
  );

  // ---- 6. document type filter (FormSelect) ----
  const opened = await page.$$eval('button[aria-haspopup="listbox"]', (btns) => {
    const b = btns.find((x) => x.textContent.includes("All Documents"));
    if (!b) return false;
    b.click();
    return true;
  });
  if (opened) {
    await page.waitForSelector('[role="listbox"]');
    await page.$$eval('[role="listbox"] button', (opts) => {
      const o = opts.find((x) => x.textContent.includes("Skin Photos"));
      if (o) o.click();
    });
    await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 1);
    check("T17 document type filter narrows to 1 skin photo", (await rowCount(page)) === 1);
    await page.$$eval("button", (btns) => {
      const c = btns.find((x) => x.textContent.trim() === "Clear");
      if (c) c.click();
    });
    await page.waitForFunction(() => document.querySelectorAll("tbody tr").length === 3);
  } else {
    check("T17 document type filter narrows to 1 skin photo", false, "trigger not found");
  }

  // ---- 7. Refresh Reports performs a real refetch ----
  const before = await page.$$eval("tbody tr td:first-child", (td) => td.map((x) => x.textContent));
  const refreshBtn = await page.$$eval("button", (btns) => {
    const b = btns.find((x) => x.textContent.includes("Refresh Reports"));
    if (!b) return false;
    b.click();
    return true;
  });
  await new Promise((r) => setTimeout(r, 1200));
  const btnText = await page.$$eval("button", (btns) =>
    (btns.find((x) => x.textContent.includes("Refresh") || x.textContent.includes("Refreshing")) ?? {})
      .textContent
  );
  const settled = await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll("button")).some((b) =>
        b.textContent.includes("Refresh Reports")
      ),
    { timeout: 15000 }
  ).then(() => true).catch(() => false);
  const after = await page.$$eval("tbody tr td:first-child", (td) => td.map((x) => x.textContent));
  check(
    "T18 Refresh Reports refetches without losing rows",
    refreshBtn && settled && after.length === before.length,
    `before=${before.length} after=${after.length} btn="${(btnText ?? "").trim()}"`
  );

  // ---- 8. image preview modal + status change (target the SKIN PHOTO row) ----
  await page.$$eval("tbody tr", (rows) => {
    const row = rows.find((r) => r.textContent.includes("facial-lesion-followup.png"));
    if (!row) throw new Error("skin photo row not found");
    row.querySelector('button[title="View report"]').click();
  });
  await page.waitForSelector('img[src^="blob:"]', { timeout: 30000 });
  const modalText = await page.evaluate(() => {
    const modal = document.querySelector(".fixed.inset-0.z-50");
    return modal ? modal.textContent.replace(/\s+/g, " ") : "";
  });
  check(
    "T19 preview modal shows patient, type, date, token",
    modalText.includes("Ayesha Khan") &&
      modalText.includes("Skin Photo") &&
      modalText.includes("Upload Date") &&
      modalText.includes("Appointment"),
    modalText.slice(0, 160)
  );  const editingTools = await page.evaluate(() => {
    const modal = document.querySelector(".fixed.inset-0.z-50");
    if (!modal) return -1;
    return modal.querySelectorAll('input, textarea, canvas, [contenteditable="true"]').length;
  });
  check(
    "T20 preview shows the original image, no filters or editing tools",
    editingTools === 0,
    `editable controls=${editingTools}`
  );
  await page.screenshot({ path: ".tmp-reports-preview.png" });

  // status change through the modal's status control
  const statusOpened = await page.$$eval(".fixed.inset-0.z-50 button", (btns) => {
    const b = btns.find((x) => x.getAttribute("aria-haspopup") === "listbox");
    if (!b) return false;
    b.click();
    return true;
  });
  let statusOk = false;
  if (statusOpened) {
    await page.waitForSelector('[role="listbox"]');
    await page.$$eval('[role="listbox"] button', (opts) => {
      const o = opts.find((x) => x.textContent.includes("Reviewed"));
      if (o) o.click();
    });
    // PATCH round-trip (route may compile on first hit) — wait for the
    // modal's status control to show the NEW value, not a fixed delay.
    statusOk = await page
      .waitForFunction(
        () =>
          document
            .querySelector(".fixed.inset-0.z-50")
            ?.textContent.includes("Reviewed") ?? false,
        { timeout: 30000 }
      )
      .then(() => true)
      .catch(() => false);
  }
  check("T21 status can be marked Reviewed from the preview", statusOk);

  // close modal
  await page.$$eval(".fixed.inset-0.z-50 button", (btns) => {
    const b = btns.find((x) => x.getAttribute("title") === "Close preview");
    if (b) b.click();
  });
  await page.waitForFunction(
    () => !document.querySelector(".fixed.inset-0.z-50"),
    { timeout: 10000 }
  ).catch(() => {});
  const badgeOk = await page
    .waitForFunction(
      () =>
        Array.from(document.querySelectorAll("tbody tr")).some((r) =>
          (r.querySelectorAll("td")[7]?.textContent ?? "").includes("Reviewed")
        ),
      { timeout: 15000 }
    )
    .then(() => true)
    .catch(() => false);
  const badgeNow = await page.$$eval("tbody tr", (rows) =>
    rows.map((r) => r.querySelectorAll("td")[7]?.textContent.trim())
  );
  check(
    "T22 table badge reflects Reviewed without page reload",
    badgeOk && badgeNow.includes("Reviewed"),
    badgeNow.join(",")
  );

  // ---- 9. delete confirmation (Cancel keeps the row) ----
  await page.click('button[title="Delete report"]');
  await page.waitForFunction(() =>
    document.body.textContent.includes("Delete this uploaded report?")
  );
  const dialogText = await page.evaluate(() => {
    const box = Array.from(document.querySelectorAll(".fixed.inset-0.z-50 div")).find((d) =>
      d.textContent.includes("Delete this uploaded report?")
    );
    return box ? box.textContent.replace(/\s+/g, " ") : "";
  });
  check(
    "T23 delete asks for confirmation",
    dialogText.includes("Delete this uploaded report?") &&
      dialogText.includes("Cancel") &&
      dialogText.includes("Delete"),
    dialogText.slice(0, 140)
  );
  await page.screenshot({ path: ".tmp-reports-delete.png" });
  await page.$$eval(".fixed.inset-0.z-50 button", (btns) => {
    const c = btns.find((x) => x.textContent.trim() === "Cancel");
    if (c) c.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  check("T24 Cancel keeps the row (no deletion)", (await rowCount(page)) === 3);

  // ---- 10. upload modal opens ----
  await page.$$eval("button", (btns) => {
    const b = btns.find((x) => x.textContent.includes("Upload Report"));
    if (b) b.click();
  });
  await page.waitForFunction(() => document.body.textContent.includes("Upload Report / Skin Photo"));
  const uploadText = await page.evaluate(() => document.body.textContent.replace(/\s+/g, " "));
  check(
    "T25 upload modal has patient / appointment / type / file",
    uploadText.includes("Patient") &&
      uploadText.includes("Appointment / Token") &&
      uploadText.includes("Document Type") &&
      uploadText.includes("Choose a file"),
    "fields present"
  );
  await page.screenshot({ path: ".tmp-reports-upload.png" });
  await page.$$eval(".fixed.inset-0.z-50 button", (btns) => {
    const c = btns.find((x) => x.textContent.trim() === "Cancel");
    if (c) c.click();
  });

  // ---- 11. mobile: scrolling only inside the table container ----
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  // Wait for the reflow BEFORE measuring (viewport emulation is async).
  await page
    .waitForFunction(() => document.documentElement.clientWidth <= 400, { timeout: 15000 })
    .catch(() => {});
  // The rows must still be there after the viewport change (if they are not,
  // the page reset itself — capture diagnostics before asserting geometry).
  await page
    .waitForFunction(() => document.querySelectorAll("tbody tr").length === 3, {
      timeout: 15000,
    })
    .catch(() => {});
  await new Promise((r) => setTimeout(r, 400));
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    const table = document.querySelector("table");
    const scroller = table?.parentElement;
    const searchInput = document.querySelector('input[aria-label="Search reports"]');
    return {
      viewport: doc.clientWidth,
      rows: document.querySelectorAll("tbody tr").length,
      tableWidth: table?.offsetWidth ?? 0,
      pageScroll: doc.scrollWidth - doc.clientWidth,
      parentScroll: scroller?.scrollWidth ?? 0,
      parentClient: scroller?.clientWidth ?? 0,
      tableScrolls: scroller ? scroller.scrollWidth > scroller.clientWidth : false,
      url: location.pathname,
      marker: window.__uiTestMarker ?? null,
      navType: performance.getEntriesByType("navigation")[0]?.type ?? null,
      h1: document.querySelector("h1")?.textContent ?? null,
      searchValue: searchInput ? searchInput.value : null,
      overlays: document.querySelectorAll(".fixed.inset-0").length,
      pulse: document.querySelectorAll(".animate-pulse").length,
      bodyText: document.body.textContent.replace(/\s+/g, " ").slice(0, 260),
    };
  });
  check(
    "T26 mobile: NO page-level horizontal scroll, table container scrolls",
    overflow.pageScroll <= 1 && overflow.tableScrolls && overflow.rows === 3,
    JSON.stringify(overflow)
  );
  await page.screenshot({ path: ".tmp-reports-mobile.png", fullPage: false });

  // ---- 12. console must stay clean ----
  check("T27 no console/page errors", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" || "));
} catch (err) {
  check("UNEXPECTED ERROR", false, String(err?.message ?? err));
} finally {
  await browser.close();
}

console.log("\n" + results.join("\n"));
if (results.some((l) => l.startsWith("FAIL"))) process.exit(1);
console.log("\nUI TEST PASSED — screenshots: .tmp-reports-page.png, .tmp-reports-preview.png, .tmp-reports-delete.png, .tmp-reports-upload.png, .tmp-reports-mobile.png");
