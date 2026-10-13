/**
 * UI TEST — Staff Inbox (frontend-only step), real Chrome against :3000.
 * Uses the TEMPORARY sample data shipped with the page (no seed needed).
 *
 * Run: TEST_PORT=3000 node .tmp-inbox-ui-test.mjs
 * Requires: npm i -D puppeteer-core (uses the locally installed Chrome).
 * Screenshots go to the OS temp dir (outside the project watcher).
 */
import fs from "fs";
import os from "os";
import path from "path";
import puppeteer from "puppeteer-core";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = `http://localhost:${process.env.TEST_PORT || "3000"}`;
const SHOT_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-ui-"));

const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

const consoleErrors = [];
const rowCount = (page) => page.evaluate(() => document.querySelectorAll(".divide-y > [role='button']").length);

const tabCounts = (page) =>
  page.evaluate(() => {
    const out = {};
    for (const b of document.querySelectorAll('button[aria-pressed]')) {
      const label = b.textContent.trim();
      const m = label.match(/^(.*?)(\d+)$/);
      if (m) out[m[1].trim()] = Number(m[2]);
    }
    return out;
  });

async function clickTab(page, label) {
  return page.evaluate((l) => {
    const b = Array.from(document.querySelectorAll('button[aria-pressed]')).find((x) =>
      x.textContent.trim().startsWith(l)
    );
    if (b) b.click();
    return !!b;
  }, label);
}

const searchInto = async (page, text) => {
  const input = await page.$('input[aria-label="Search messages by sender or subject"]');
  await input.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  if (text) await input.type(text);
  await new Promise((r) => setTimeout(r, 250));
};

// Throwaway account for this run (cleaned up in finally).
const stamp = Date.now();
const email = `inbox-ui-${stamp}@example.com`;
const signupRes = await fetch(`${BASE}/api/auth/signup`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    businessName: `Inbox UI ${stamp}`,
    name: "Dr Inbox Tester",
    email,
    password: "secret123",
  }),
});
const signupJson = await signupRes.json().catch(() => null);
if (signupRes.status !== 201) {
  console.error(`signup failed: ${signupRes.status} ${signupJson?.message ?? ""}`);
  process.exit(1);
}
const businessId = signupJson.data.business.id;
const loginRes = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email, password: "secret123" }),
});
const token = (await loginRes.json()).data.token;

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
    if (m.type() === "error" && !url.includes("favicon")) {
      const text = m.text();
      if (text.startsWith("Failed to load resource")) return;
      consoleErrors.push(`console: ${text} @ ${url}`);
    }
  });

  // Auth the way the app does: JWT in localStorage.
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), token);
  await page.goto(`${BASE}/dashboard/staff-inbox`, { waitUntil: "domcontentloaded" });

  // ---- 1. shell ----
  await page.waitForFunction(() => document.querySelector("h1")?.textContent?.includes("Staff Inbox"), {
    timeout: 60000,
  });
  const h1 = await page.$eval("h1", (el) => el.textContent.trim());
  check("IN1  heading matches spec", h1 === "Staff Inbox", h1);
  const subtitle = await page.$eval("main p", (el) => el.textContent.trim());
  check("IN2  subtitle matches spec", subtitle === "Manage internal clinic communications", subtitle);

  const headerText = await page.evaluate(
    () => document.querySelector("main > div")?.textContent ?? ""
  );
  check("IN3  New Message button present", headerText.includes("New Message"));

  const notice = await page.evaluate(
    () =>
      document.body.textContent.includes("UI preview") &&
      document.body.textContent.includes("No database or backend is connected yet")
  );
  check("IN4  honest preview notice (no fake DB claim)", notice);

  // ---- 2. summary cards ----
  const cardText = await page.evaluate(() =>
    Array.from(document.querySelectorAll("main .grid > div"))
      .slice(0, 4)
      .map((el) => el.textContent.trim())
  );
  check(
    "IN5  4 summary cards: Total/Unread/Sent/Important",
    cardText.length === 4 &&
      cardText[0].includes("Total Messages") && cardText[0].includes("8") &&
      cardText[1].includes("Unread") && cardText[1].includes("3") &&
      cardText[2].includes("Sent") && cardText[2].includes("3") &&
      cardText[3].includes("Important") && cardText[3].includes("3"),
    cardText.join(" || ")
  );

  // ---- 3. search + tabs ----
  const ph = await page.$eval('input[aria-label="Search messages by sender or subject"]', (el) => el.placeholder);
  check("IN6  search field placeholder", ph === "Search by sender or subject...", ph);

  const tabs = await page.$$eval('button[aria-pressed]', (bs) =>
    bs.map((b) => b.textContent.replace(/\d+$/, "").trim())
  );
  const want = ["All Messages", "Inbox", "Sent", "Unread", "Important", "Archived"];
  check(
    "IN7  exactly the 6 spec filter tabs",
    tabs.length === 6 && tabs.every((t, i) => t === want[i]),
    tabs.join(" | ")
  );

  check("IN8  list shows all 8 active messages", (await rowCount(page)) === 8, `n=${await rowCount(page)}`);

  // ---- 4. row anatomy ----
  const firstRow = await page.evaluate(() => {
    const row = document.querySelector(".divide-y > [role='button']");
    if (!row) return null;
    return {
      text: row.textContent,
      hasAvatarInitials: Array.from(row.querySelectorAll("span")).some(
        (s) => s.className.includes("h-10 w-10") && s.textContent.trim() === "DI"
      ), // Dr. Sana Iqbal -> initials DI
      unreadDot: Boolean(row.querySelector("span[title='Unread']")),
      hasUrgentBadge: row.textContent.includes("Urgent"),
      starFilled: Boolean(row.querySelector("svg.fill-amber-400")),
      hasTime: /\d{4}.*\d{1,2}:\d{2}/.test(row.textContent.replace(/\s+/g, " ")),
    };
  });
  check(
    "IN9  row has initials, unread dot, priority badge, filled star, timestamp",
    firstRow && firstRow.hasAvatarInitials && firstRow.unreadDot && firstRow.hasUrgentBadge &&
      firstRow.starFilled && firstRow.hasTime,
    JSON.stringify(firstRow)
  );

  // ---- 5. search ----
  await searchInto(page, "Hina");
  check("IN10  search by sender -> 1 row", (await rowCount(page)) === 1, `n=${await rowCount(page)}`);
  await searchInto(page, "roster");
  check("IN11  search by subject -> 1 row", (await rowCount(page)) === 1, `n=${await rowCount(page)}`);
  await searchInto(page, "no-such-sender");
  check(
    "IN12  no-match empty state",
    await page.evaluate(() => document.body.textContent.includes("No messages found"))
  );
  await searchInto(page, "");
  check("IN13  search cleared -> 8 rows", (await rowCount(page)) === 8, `n=${await rowCount(page)}`);

  // ---- 6. filter tabs ----
  const counts0 = await tabCounts(page);
  check(
    "IN14  tab counts correct",
    counts0["All Messages"] === 8 && counts0["Inbox"] === 5 && counts0["Sent"] === 3 &&
      counts0["Unread"] === 3 && counts0["Important"] === 3 && counts0["Archived"] === 2,
    JSON.stringify(counts0)
  );
  await clickTab(page, "Inbox");
  check("IN15  Inbox tab -> 5 rows", (await rowCount(page)) === 5, `n=${await rowCount(page)}`);
  await clickTab(page, "Sent");
  check("IN16  Sent tab -> 3 rows", (await rowCount(page)) === 3, `n=${await rowCount(page)}`);
  await clickTab(page, "Unread");
  check("IN17  Unread tab -> 3 rows", (await rowCount(page)) === 3, `n=${await rowCount(page)}`);
  await clickTab(page, "Important");
  check("IN18  Important tab -> 3 rows", (await rowCount(page)) === 3, `n=${await rowCount(page)}`);
  await clickTab(page, "Archived");
  check("IN19  Archived tab -> 2 rows", (await rowCount(page)) === 2, `n=${await rowCount(page)}`);
  await clickTab(page, "All Messages");
  check("IN20  back to All Messages -> 8 rows", (await rowCount(page)) === 8, `n=${await rowCount(page)}`);

  // ---- 7. detail panel ----
  await page.evaluate(() => {
    const row = document.querySelector(".divide-y > [role='button']");
    row?.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  const detail = await page.evaluate(() => {
    const panel = Array.from(document.querySelectorAll(".lg\\:flex")).find((el) =>
      el.textContent.includes("Preview only")
    );
    if (!panel) return null;
    const t = panel.textContent;
    return {
      hasSubject: t.includes("Urgent: reaction on Room 3 patient"),
      hasBody: t.includes("soothing gel"),
      hasSenderRole: t.includes("Dermatologist"),
      hasFolderBadge: /inbox/i.test(t),
      hasCategory: t.includes("Clinical"),
      hasPreviewNote: t.includes("Preview only"),
    };
  });
  check(
    "IN21  detail panel shows subject/body/role/folder/category",
    detail && detail.hasSubject && detail.hasBody && detail.hasSenderRole &&
      detail.hasFolderBadge && detail.hasCategory && detail.hasPreviewNote,
    JSON.stringify(detail)
  );
  const dotGone = await page.evaluate(() => {
    const row = document.querySelector(".divide-y > [role='button']");
    return row && !row.querySelector("span[title='Unread']");
  });
  check("IN22  opening a message marks it read (dot clears)", Boolean(dotGone));
  const unreadAfter = await tabCounts(page);
  check("IN23  Unread count drops after reading", unreadAfter["Unread"] === 2, `unread=${unreadAfter["Unread"]}`);

  // ---- 8. star toggle ----
  const importantBefore = (await tabCounts(page))["Important"];
  await page.evaluate(() => {
    const rows = document.querySelectorAll(".divide-y > [role='button']");
    const row = Array.from(rows).find((r) => r.textContent.includes("Sterilizer maintenance"));
    row?.querySelector("button[aria-label='Mark as important']")?.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  const importantAfter = (await tabCounts(page))["Important"];
  check(
    "IN24  star toggle updates Important count",
    importantAfter === importantBefore + 1,
    `${importantBefore} -> ${importantAfter}`
  );

  // ---- 9. compose modal ----
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("main button")).find((x) =>
      x.textContent.includes("New Message")
    );
    b?.click();
  });
  await page.waitForFunction(() => document.body.textContent.includes("New Message"), { timeout: 8000 });
  await page.evaluate(() => {
    const modal = Array.from(document.querySelectorAll("div.fixed")).find((d) =>
      d.textContent.includes("Compose an internal message")
    );
    const send = Array.from(modal.querySelectorAll("button")).find((b) => b.textContent.trim() === "Send");
    send?.click();
  });
  await new Promise((r) => setTimeout(r, 300));
  const validation = await page.evaluate(() => {
    const t = document.body.textContent;
    return t.includes("Recipient is required.") && t.includes("Subject is required.") &&
      t.includes("Message is required.");
  });
  check("IN25  compose validates required fields", validation);
  await page.evaluate(() => {
    const modal = Array.from(document.querySelectorAll("div.fixed")).find((d) =>
      d.textContent.includes("Compose an internal message")
    );
    const set = (el, v) => {
      const s = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      s.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const inputs = modal.querySelectorAll("input");
    set(inputs[0], "Hina Shah");
    set(inputs[1], "Confirm the 4 PM walk-in");
    const ta = modal.querySelector("textarea");
    const ts = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
    ts.call(ta, "Please confirm the walk-in slot before noon.");
    ta.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await page.screenshot({ path: path.join(SHOT_DIR, "compose.png") });
  await page.evaluate(() => {
    const modal = Array.from(document.querySelectorAll("div.fixed")).find((d) =>
      d.textContent.includes("Compose an internal message")
    );
    const send = Array.from(modal.querySelectorAll("button")).find((b) => b.textContent.trim() === "Send");
    send?.click();
  });
  const toastShown = await page
    .waitForFunction(
      () => document.body.textContent.includes("Not sent yet"),
      { timeout: 8000 }
    )
    .then(() => true)
    .catch(() => false);
  check(
    "IN26  Send honestly reports backend not connected (no fake send)",
    toastShown
  );

  await page.screenshot({ path: path.join(SHOT_DIR, "desktop.png") });

  // ---- 10. mobile ----
  await page.setViewport({ width: 375, height: 800 });
  await new Promise((r) => setTimeout(r, 400));
  const scrollOk = await page.evaluate(
    () => document.documentElement.scrollWidth <= window.innerWidth + 1
  );
  check("IN27  no page-wide horizontal scroll on mobile", scrollOk);
  await page.evaluate(() => {
    const row = document.querySelector(".divide-y > [role='button']");
    row?.click();
  });
  const overlayOk = await page
    .waitForFunction(
      () => {
        const back = document.querySelector('button[aria-label="Back to message list"]');
        return back && back.getBoundingClientRect().width > 0;
      },
      { timeout: 8000 }
    )
    .then(() => true)
    .catch(() => false);
  check("IN28  mobile detail overlay with back button", overlayOk);
  await page.screenshot({ path: path.join(SHOT_DIR, "mobile-detail.png") });
  await page.evaluate(() => document.querySelector('button[aria-label="Back to message list"]')?.click());
  await new Promise((r) => setTimeout(r, 300));
  const backOk = await page.evaluate(() => !document.querySelector('button[aria-label="Back to message list"]'));
  check("IN29  back returns to the list", backOk);
  await page.setViewport({ width: 1440, height: 900 });

  // ---- 11. console ----
  check("IN30  clean console", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" // "));
} finally {
  await browser.close();
  // Remove the throwaway business (FK cascade cleans every row).
  try {
    const { Pool } = await import("pg");
    const env = fs.readFileSync(".env", "utf8");
    const pool = new Pool({
      connectionString: env.match(/^DATABASE_URL=(.*)$/m)[1].trim(),
      ssl: { rejectUnauthorized: false },
    });
    const del = await pool.query("DELETE FROM business WHERE id = $1", [businessId]);
    console.log(`cleanup: deleted ${del.rowCount} throwaway business`);
    await pool.end();
  } catch (err) {
    console.error("cleanup failed:", err?.message ?? err);
  }
}

const failed = results.filter((x) => x.startsWith("FAIL"));
console.log(results.join("\n"));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
console.log(`screenshots: ${SHOT_DIR}`);
process.exit(failed.length === 0 ? 0 : 1);
