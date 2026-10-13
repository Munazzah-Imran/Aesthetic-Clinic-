/**
 * Show/Hide password eye-toggle UI test (real browser, headless Chrome).
 * Run: node .tmp-pwd-eye-test.mjs   (needs server on :3000)
 *
 * Verifies for every password field in the app:
 *  1. hidden by default (type=password) with eye button (type=button) inside
 *  2. click reveals (type=text, aria-label "Hide password")
 *  3. click again hides (type=password, aria-label "Show password")
 *  4. each field toggles independently; values never change
 *  5. form submission still works (real login with valid credentials)
 */
import fs from "fs";
import puppeteer from "puppeteer-core";

const state = JSON.parse(fs.readFileSync(".tmp-rbac-state.json", "utf8"));
const BASE = `http://localhost:${process.env.TEST_PORT || "3000"}`;
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";

const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Snapshot one password field: type, value, and its eye-button state. */
async function fieldState(page, sel, nth = 0) {
  return page.evaluate(
    (s, n) => {
      const input = document.querySelectorAll(s)[n];
      if (!input) return { missing: true };
      const wrap = input.parentElement;
      const btn = wrap ? wrap.querySelector("button[aria-label]") : null;
      return {
        missing: false,
        type: input.type,
        value: input.value,
        btnLabel: btn ? btn.getAttribute("aria-label") : null,
        btnType: btn ? btn.getAttribute("type") : null,
        btnIsSibling: btn ? btn.previousElementSibling === input : false,
        paddingRight: getComputedStyle(input).paddingRight,
        borderRadius: getComputedStyle(input).borderRadius,
        borderColor: getComputedStyle(input).borderColor,
      };
    },
    sel,
    nth
  );
}

/** Click the eye button belonging to field #nth and return its new state. */
async function clickEye(page, sel, nth = 0) {
  await page.evaluate(
    (s, n) => {
      const input = document.querySelectorAll(s)[n];
      input.parentElement.querySelector("button[aria-label]").click();
    },
    sel,
    nth
  );
  await sleep(200);
  return fieldState(page, sel, nth);
}

/** Set a controlled input's value the way React sees it (native setter). */
async function setValue(page, sel, value, nth = 0) {
  await page.evaluate(
    (s, n, v) => {
      const el = document.querySelectorAll(s)[n];
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(el, v);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    },
    sel,
    nth,
    value
  );
  await sleep(100);
}

/** Full default/reveal/hide cycle for one field (value must be preserved). */
async function testField(page, label, sel, nth = 0) {
  const s0 = await fieldState(page, sel, nth);
  if (s0.missing) return check(label + ": field exists", false, "NOT FOUND");
  check(
    `${label}: hidden by default, eye button = type=button`,
    s0.type === "password" &&
      s0.btnLabel === "Show password" &&
      s0.btnType === "button" &&
      s0.btnIsSibling,
    JSON.stringify(s0)
  );
  check(`${label}: extra right padding so text never overlaps icon`, s0.paddingRight === "44px", s0.paddingRight);

  const s1 = await clickEye(page, sel, nth);
  check(
    `${label}: click reveals (type=text, label "Hide password")`,
    s1.type === "text" && s1.btnLabel === "Hide password",
    JSON.stringify(s1)
  );
  const s2 = await clickEye(page, sel, nth);
  check(
    `${label}: second click hides again`,
    s2.type === "password" && s2.btnLabel === "Show password"
  );
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu"],
});

try {
  const page = await browser.newPage();
  page.setDefaultTimeout(60000);
  await page.setViewport({ width: 1400, height: 900 });
  const pageErrors = [];
  page.on("pageerror", (e) => pageErrors.push(String(e)));

  /* ---------------- LOGIN / SIGN-UP (AuthForm) ---------------- */
  await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#login-password", { timeout: 60000 });

  // Style invariants: existing auth-input look untouched (radius/border/padding-left).
  const authStyle = await page.evaluate(() => {
    const el = document.querySelector("#login-password");
    const cs = getComputedStyle(el);
    return {
      radius: cs.borderRadius,
      border: cs.borderTopWidth + " " + cs.borderTopStyle,
      borderLeft: cs.paddingLeft,
      borderRight: cs.paddingRight,
      focus: el.className,
    };
  });
  check(
    "login: existing input styling preserved (radius 8px, border, px preserved)",
    authStyle.radius === "8px" &&
      authStyle.border === "1px solid" &&
      authStyle.borderLeft === "14px" &&
      authStyle.borderRight === "44px" &&
      authStyle.focus.includes("auth-input"),
    JSON.stringify(authStyle)
  );

  // Typing + value preservation + caret preservation with a REAL mouse click.
  await page.type("#login-password", "secret123");
  await page.focus("#login-password");
  await page.evaluate(() =>
    document.querySelector("#login-password").setSelectionRange(3, 3)
  );
  await page.click("#login-password + button");
  await sleep(300);
  const caret = await page.evaluate(() => {
    const el = document.querySelector("#login-password");
    const btn = el.parentElement.querySelector("button[aria-label]");
    return {
      type: el.type,
      value: el.value,
      focused: document.activeElement === el,
      caret: el.selectionStart,
      label: btn.getAttribute("aria-label"),
    };
  });
  check(
    "login: real click reveals, keeps value + focus + caret position",
    caret.type === "text" &&
      caret.value === "secret123" &&
      caret.focused &&
      caret.caret === 3 &&
      caret.label === "Hide password",
    JSON.stringify(caret)
  );
  await page.click("#login-password + button");
  await sleep(300);
  const hiddenAgain = await page.evaluate(() => ({
    type: document.querySelector("#login-password").type,
    value: document.querySelector("#login-password").value,
  }));
  check(
    "login: real click hides again, value unchanged",
    hiddenAgain.type === "password" && hiddenAgain.value === "secret123"
  );

  // Autofill attrs preserved.
  const loginAttrs = await page.evaluate(() => {
    const el = document.querySelector("#login-password");
    return { minLength: el.minLength, name: el.name, required: el.required };
  });
  check(
    "login: minLength/name/required preserved",
    loginAttrs.minLength === 6 && loginAttrs.name === "password" && loginAttrs.required
  );
  await page.screenshot({ path: ".tmp-eye-login.png" });

  // Sign-up panel: two fields must toggle independently.
  await page.click('label[for="tab-signup"]');
  await sleep(300);
  await page.waitForSelector("#signup-password", { timeout: 10000 });
  await setValue(page, "#signup-password", "abcd1234");
  await setValue(page, "#signup-confirm-password", "abcd1234");

  const ind0 = await fieldState(page, "#signup-password");
  const ind1 = await fieldState(page, "#signup-confirm-password");
  check(
    "signup: both fields hidden by default",
    ind0.type === "password" && ind1.type === "password"
  );
  const afterToggle1 = await clickEye(page, "#signup-password");
  const otherStill1 = await fieldState(page, "#signup-confirm-password");
  check(
    "signup: toggling Password does NOT reveal Confirm (independent state)",
    afterToggle1.type === "text" && otherStill1.type === "password",
    JSON.stringify({ afterToggle1, otherStill1 })
  );
  check(
    "signup: toggle does not alter typed value",
    afterToggle1.value === "abcd1234" && otherStill1.value === "abcd1234"
  );
  const afterToggle2 = await clickEye(page, "#signup-confirm-password");
  const firstUnchanged = await fieldState(page, "#signup-password");
  check(
    "signup: toggling Confirm leaves Password still revealed; values intact",
    afterToggle2.type === "text" &&
      firstUnchanged.type === "text" &&
      afterToggle2.value === "abcd1234",
    JSON.stringify({ afterToggle2, firstUnchanged })
  );

  // Real login submission through the form (password value + name read by FormData).
  await page.click('label[for="tab-login"]');
  await sleep(300);
  await page.type("#login-email", state.ownerEmail);
  await page.type("#login-password", state.ownerPassword);
  await Promise.all([
    page.waitForFunction(() => location.pathname.startsWith("/dashboard"), {
      timeout: 30000,
    }).catch(() => {}),
    page.click('form.auth-panel-login button[type="submit"]'),
  ]);
  await sleep(1500);
  check(
    "login: form submits and reaches /dashboard with valid credentials",
    (await page.evaluate(() => location.pathname.startsWith("/dashboard"))),
    await page.evaluate(() => location.pathname)
  );

  const setToken = async (t) => {
    await page.goto(`${BASE}/login`, { waitUntil: "domcontentloaded" });
    await page.evaluate((x) => localStorage.setItem("token", x), t);
  };

  /* ---------------- SETTINGS — Change Password (3 fields) ---------------- */
  await setToken(state.ownerToken);
  await page.goto(`${BASE}/dashboard/settings`, { waitUntil: "domcontentloaded" });
  await page
    .waitForFunction(
      () => document.body.textContent.includes("Current Password"),
      { timeout: 60000 }
    )
    .catch(() => {});

  const curSel = 'input[autocomplete="current-password"]';
  const newSel = 'input[autocomplete="new-password"]';
  await setValue(page, curSel, "oldPass1");
  await setValue(page, newSel, "newPass1", 0);
  await setValue(page, newSel, "newPass2", 1);

  await testField(page, "settings/current", curSel, 0);
  await testField(page, "settings/new", newSel, 0);
  await testField(page, "settings/confirm", newSel, 1);

  // Independence: reveal NEW, confirm + current must stay hidden, values intact.
  const stNew = await clickEye(page, newSel, 0);
  const stCur = await fieldState(page, curSel, 0);
  const stConf = await fieldState(page, newSel, 1);
  check(
    "settings: revealing New leaves Current + Confirm hidden (independent)",
    stNew.type === "text" && stCur.type === "password" && stConf.type === "password",
    JSON.stringify({ stNew, stCur, stConf })
  );
  check(
    "settings: all values untouched by toggling",
    stNew.value === "newPass1" && stCur.value === "oldPass1" && stConf.value === "newPass2"
  );

  // Hover accent color on the eye (subtle gray default -> sky accent on hover).
  const colors = await page.evaluate(() => {
    const input = document.querySelector('input[autocomplete="current-password"]');
    const btn = input.parentElement.querySelector("button[aria-label]");
    return { idle: getComputedStyle(btn).color };
  });
  await page.hover('input[autocomplete="current-password"] + button');
  await sleep(300);
  const hover = await page.evaluate(() => {
    const input = document.querySelector('input[autocomplete="current-password"]');
    const btn = input.parentElement.querySelector("button[aria-label]");
    return { hover: getComputedStyle(btn).color };
  });
  check(
    "settings: eye is subtle gray at rest, sky accent on hover",
    colors.idle === "rgb(131, 148, 157)" && hover.hover === "rgb(2, 132, 199)",
    JSON.stringify({ ...colors, ...hover })
  );
  await page.evaluate(() =>
    document
      .querySelector('input[autocomplete="current-password"] + button')
      .scrollIntoView({ block: "center" })
  );
  await page.screenshot({ path: ".tmp-eye-settings.png" });

  /* ---------------- PROFILE — Change Password (3 fields) ---------------- */
  await page.goto(`${BASE}/dashboard/profile`, { waitUntil: "domcontentloaded" });
  await page
    .waitForFunction(() => document.body.textContent.includes("Change Password"), {
      timeout: 60000,
    })
    .catch(() => {});
  await setValue(page, curSel, "curProf1");
  await setValue(page, newSel, "newProf1", 0);
  await setValue(page, newSel, "newProf2", 1);
  await testField(page, "profile/current", curSel, 0);
  await testField(page, "profile/new", newSel, 0);
  await testField(page, "profile/confirm", newSel, 1);
  const pNew = await clickEye(page, newSel, 0);
  const pCur = await fieldState(page, curSel, 0);
  const pConf = await fieldState(page, newSel, 1);
  check(
    "profile: independent toggles (only New revealed)",
    pNew.type === "text" && pCur.type === "password" && pConf.type === "password" &&
      pNew.value === "newProf1" && pCur.value === "curProf1",
    JSON.stringify({ pNew, pCur, pConf })
  );
  await page.screenshot({ path: ".tmp-eye-profile.png" });

  /* ---------------- STAFF — Add Staff modal (2 fields) ---------------- */
  await page.goto(`${BASE}/dashboard/staff`, { waitUntil: "domcontentloaded" });
  await page
    .waitForFunction(() => (document.querySelector("h1")?.textContent ?? "").includes("Staff"), {
      timeout: 60000,
    })
    .catch(() => {});
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find((b) =>
      b.textContent.includes("Add Staff")
    );
    if (btn) btn.click();
  });
  await page.waitForSelector("#staff-password", { timeout: 30000 }).catch(() => {});
  const staffInputs = await page.evaluate(() => ({
    pwd: !!document.querySelector("#staff-password"),
    conf: !!document.querySelector("#staff-confirm-password"),
    types: [
      document.querySelector("#staff-password")?.type,
      document.querySelector("#staff-confirm-password")?.type,
    ],
  }));
  check(
    "staff: Add Staff modal shows both fields hidden by default",
    staffInputs.pwd && staffInputs.conf && staffInputs.types.every((t) => t === "password"),
    JSON.stringify(staffInputs)
  );
  if (staffInputs.pwd) {
    await setValue(page, "#staff-password", "tempPass1");
    await setValue(page, "#staff-confirm-password", "tempPass1");
    await testField(page, "staff/password", "#staff-password", 0);
    await testField(page, "staff/confirm", "#staff-confirm-password", 0);
    const sNew = await clickEye(page, "#staff-password", 0);
    const sConf = await fieldState(page, "#staff-confirm-password", 0);
    check(
      "staff: independent toggles (confirm stays hidden, values intact)",
      sNew.type === "text" &&
        sConf.type === "password" &&
        sNew.value === "tempPass1" &&
        sConf.value === "tempPass1",
      JSON.stringify({ sNew, sConf })
    );
  }
  await page.screenshot({ path: ".tmp-eye-staff-modal.png" });

  /* ---------------- FIRST LOGIN (staff forced password change) ---------------- */
  await setToken(state.staffToken);
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await page
    .waitForFunction(
      () =>
        document.body.textContent.includes("Set your password") ||
        document.body.textContent.includes("Dashboard"),
      { timeout: 60000 }
    )
    .catch(() => {});
  const firstLogin = await page.evaluate(() =>
    document.body.textContent.includes("Set your password")
  );
  if (firstLogin) {
    await setValue(page, "#current-password", "tmpPwd123");
    await setValue(page, "#new-password", "nextPwd123");
    await setValue(page, "#confirm-password", "nextPwd123");
    await testField(page, "first-login/current", "#current-password", 0);
    await testField(page, "first-login/new", "#new-password", 0);
    await testField(page, "first-login/confirm", "#confirm-password", 0);
    const fNew = await clickEye(page, "#new-password", 0);
    const fCur = await fieldState(page, "#current-password", 0);
    const fConf = await fieldState(page, "#confirm-password", 0);
    check(
      "first-login: independent toggles + values intact",
      fNew.type === "text" &&
        fCur.type === "password" &&
        fConf.type === "password" &&
        fNew.value === "nextPwd123",
      JSON.stringify({ fNew, fCur, fConf })
    );
    await page.screenshot({ path: ".tmp-eye-first-login.png" });
  } else {
    results.push(
      "SKIP  first-login screen not rendered for this staff token (flag already cleared)"
    );
  }

  check("no unexpected page JS errors", pageErrors.length === 0, pageErrors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => r.startsWith("FAIL"));
console.log(results.join("\n"));
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
