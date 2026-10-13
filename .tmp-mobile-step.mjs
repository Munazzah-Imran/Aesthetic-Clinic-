/** Mobile viewport check for the two-step Add Staff form. */
import fs from "fs";
import puppeteer from "puppeteer-core";

const state = JSON.parse(fs.readFileSync(".tmp-rbac-state.json", "utf8"));
const BASE = "http://localhost:3000";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"] });
try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: 390, height: 844, isMobile: true });
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.evaluate((t) => localStorage.setItem("token", t), state.ownerToken);
  await page.goto(`${BASE}/dashboard/staff`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelectorAll("tbody tr").length > 0, { timeout: 60000 });
  await page.evaluate(() => {
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Add Staff"))?.click();
  });
  await page.waitForSelector("#staff-full-name", { timeout: 30000 });
  // Horizontal overflow check inside the modal
  const overflow = await page.evaluate(() => {
    const modal = document.querySelector("#staff-full-name")?.closest(".rounded-2xl");
    if (!modal) return "modal-not-found";
    return { modalW: modal.getBoundingClientRect().width, docOverflow: document.documentElement.scrollWidth > window.innerWidth };
  });
  console.log("layout:", JSON.stringify(overflow));
  await page.screenshot({ path: ".tmp-two-step-mobile.png" });
  // Go to step 2 on mobile too
  await page.type("#staff-full-name", "Mobile Check");
  await page.type("#staff-email", `mobile-${Date.now()}@example.com`);
  await page.evaluate(() => document.querySelectorAll('button[aria-haspopup="listbox"]')[0]?.click());
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('[role="option"]')).find((o) => o.textContent?.trim().startsWith("Doctor"))?.click();
  });
  await page.type("#staff-password", state.staffPassword);
  await page.type("#staff-confirm-password", state.staffPassword);
  await page.evaluate(() => {
    Array.from(document.querySelectorAll("button")).find((b) => b.textContent?.includes("Next"))?.click();
  });
  await page.waitForFunction(() => (document.body.textContent ?? "").includes("Step 2 of 2"), { timeout: 15000 });
  await page.screenshot({ path: ".tmp-two-step-mobile-step2.png" });
  console.log("mobile step 2 reached");
} finally {
  await browser.close();
}
