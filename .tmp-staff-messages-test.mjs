/**
 * API E2E TEST — /api/staff-messages (Staff Inbox Step 3).
 * Requires the dev server on :3000 (or TEST_PORT) and the configured DB.
 * Run: TEST_PORT=3000 node .tmp-staff-messages-test.mjs
 *
 * Creates throwaway users INSIDE throwaway businesses and deletes those
 * businesses afterwards (FK cascade removes users + messages) — the run
 * ends by asserting the staff tables are empty again (no fake data left).
 * Exit code 0 = all checks passed.
 */
const PORT = process.env.TEST_PORT || "3000";
const B = `http://localhost:${PORT}/api`;

const results = [];
const check = (name, cond, extra = "") =>
  results.push(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);

async function call(path, opts = {}, token = "") {
  const res = await fetch(B + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: opts.body,
  });
  let json = null;
  try {
    json = await res.json();
  } catch {}
  return { status: res.status, json, text: JSON.stringify(json) };
}

const envelopeOk = (r) =>
  r.json && typeof r.json === "object" &&
  "data" in r.json && "error" in r.json && "success" in r.json && "message" in r.json;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const stamp = Date.now();
const businesses = [];
let pool = null;
let baseline = null;

async function signup(label) {
  const email = `sm-test-${label}-${stamp}@example.com`;
  let r = await call("/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      businessName: `SM Test ${label} ${stamp}`,
      name: `Dr SM ${label}`,
      email,
      password: "secret123",
    }),
  });
  if (r.status !== 201) throw new Error(`signup failed: ${r.status} ${r.json?.message}`);
  const businessId = r.json.data.business.id;
  r = await call("/auth/login", { method: "POST", body: JSON.stringify({ email, password: "secret123" }) });
  const token = r.json.data.token;
  const user = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  businesses.push(businessId);
  return { businessId, token, userId: user.rows[0].id, name: `Dr SM ${label}`, email };
}

async function addStaff(businessId, name) {
  const bcrypt = await import("bcryptjs");
  const hashSync = bcrypt.hashSync ?? bcrypt.default?.hashSync;
  const email = `sm-staff-${name.toLowerCase().replace(/\W+/g, "")}-${stamp}@example.com`;
  const r = await pool.query(
    "INSERT INTO users (name, email, password, business_id) VALUES ($1, $2, $3, $4) RETURNING id",
    [name, email, hashSync("secret123", 10), businessId]
  );
  const login = await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: "secret123" }),
  });
  if (login.status >= 300) throw new Error(`staff login failed: ${login.status}`);
  return { userId: r.rows[0].id, token: login.json.data.token, name };
}

const send = (token, body, rawBody) =>
  call("/staff-messages", { method: "POST", body: rawBody ?? JSON.stringify(body) }, token);

const list = (token, qs = "") => call(`/staff-messages${qs}`, {}, token);
const ids = (r) => (r.json?.data ?? []).map((m) => m.id);

async function main() {
  const { Pool } = await import("pg");
  const env = (await import("fs")).readFileSync(".env", "utf8");
  pool = new Pool({
    connectionString: env.match(/^DATABASE_URL=(.*)$/m)[1].trim(),
    ssl: { rejectUnauthorized: false },
  });

  // Baseline counts (before this run creates anything).
  const base = await pool.query(
    "SELECT (SELECT count(*) FROM users) AS u, (SELECT count(*) FROM business) AS b, (SELECT count(*) FROM staff_messages) AS m, (SELECT count(*) FROM staff_message_recipients) AS r"
  );
  baseline = base.rows[0];

  // ---- setup ----
  const A = await signup("a"); // sender / owner of business A
  const A2 = await addStaff(A.businessId, "Staff Two"); // recipient
  const A3 = await addStaff(A.businessId, "Staff Three"); // second recipient
  const Bz = await signup("b"); // separate business

  // ---- 1. authentication ----
  let r = await list("");
  check("A1  list without token -> 401", r.status === 401, `${r.status}`);
  r = await send("", { subject: "x", body: "y", recipientIds: [A2.userId] });
  check("A2  send without token -> 401", r.status === 401, `${r.status}`);
  r = await call(`/staff-messages/${crypto.randomUUID()}`, {}, "");
  check("A3  detail without token -> 401", r.status === 401, `${r.status}`);

  // ---- 2. list basics ----
  r = await list(A.token);
  check("L1  fresh inbox 200 + envelope + empty", r.status === 200 && envelopeOk(r) && r.json.data.length === 0, `${r.status} n=${r.json?.data?.length}`);
  r = await list(A.token, "?filter=banana");
  check("L2  invalid filter -> 400", r.status === 400, `${r.status}`);

  // ---- 3. send validation ----
  r = await send(A.token, {});
  check("V1  missing subject/body/recipients -> 400 + field errors",
    r.status === 400 && Boolean(r.json.data?.errors?.subject) &&
    Boolean(r.json.data?.errors?.body) && Boolean(r.json.data?.errors?.recipientIds),
    JSON.stringify(r.json?.data?.errors));
  r = await send(A.token, { subject: "x".repeat(256), body: "ok", recipientIds: [A2.userId] });
  check("V2  subject >255 -> 400", r.status === 400 && Boolean(r.json.data?.errors?.subject), `${r.status}`);
  r = await send(A.token, { subject: "ok", body: "x".repeat(20001), recipientIds: [A2.userId] });
  check("V3  body >20000 -> 400", r.status === 400 && Boolean(r.json.data?.errors?.body), `${r.status}`);
  r = await send(A.token, { subject: "ok", body: "ok", category: "gossip", recipientIds: [A2.userId] });
  check("V4a  invalid category -> 400", r.status === 400 && Boolean(r.json.data?.errors?.category), `${r.status}`);
  r = await send(A.token, { subject: "ok", body: "ok", priority: "asap", recipientIds: [A2.userId] });
  check("V4b  invalid priority -> 400", r.status === 400 && Boolean(r.json.data?.errors?.priority), `${r.status}`);
  r = await send(A.token, { subject: "ok", body: "ok", recipientIds: "A2" });
  check("V5a  recipientIds not a list -> 400", r.status === 400 && Boolean(r.json.data?.errors?.recipientIds), `${r.status}`);
  r = await send(A.token, { subject: "ok", body: "ok", recipientIds: [] });
  check("V5b  empty recipientIds -> 400", r.status === 400, `${r.status}`);
  r = await send(A.token, { subject: "ok", body: "ok", recipientIds: [1.5] });
  check("V5c  non-integer recipient id -> 400", r.status === 400, `${r.status}`);
  r = await send(A.token, { subject: "ok", body: "ok", recipientIds: [99999999] });
  check("V6  unknown recipient id -> 400", r.status === 400 && Boolean(r.json.data?.errors?.recipientIds), `${r.status}`);
  r = await send(Bz.token, { subject: "cross", body: "cross", recipientIds: [A2.userId] });
  check("V7  cross-business recipient rejected -> 400", r.status === 400, `${r.status}`);
  r = await send(A.token, null, "{not valid json");
  check("V8  invalid JSON body -> 400 (safe)", r.status === 400, `${r.status}`);

  // ---- 4. no partial send ----
  r = await send(A.token, { subject: "should not exist", body: "partial?", recipientIds: [A2.userId, 99999999] });
  check("T1  mixed valid+invalid recipients -> 400, nothing written",
    r.status === 400, `${r.status}`);
  let sentList = await list(A.token, "?filter=sent");
  check("T2  no message row was created by the failed send",
    sentList.status === 200 && sentList.json.data.length === 0, `n=${sentList.json?.data?.length}`);

  // ---- 5. successful sends ----
  r = await send(A.token, {
    subject: "Lab results review",
    body: "Please check the 100% margin report before noon.",
    category: "announcement",
    priority: "urgent",
    recipientIds: [A2.userId],
  });
  const M1 = r.json?.data;
  check("C1  send 201 + envelope + shape",
    r.status === 201 && envelopeOk(r) && UUID_RE.test(M1?.id ?? "") &&
    M1.senderId === A.userId && M1.senderName === A.name && M1.isSentByMe === true &&
    M1.category === "announcement" && M1.priority === "urgent" &&
    M1.recipientCount === 1 && M1.isRead === null && typeof M1.createdAt === "string",
    `${r.status} ${M1?.senderName} / ${M1?.category} / ${M1?.priority}`);

  r = await send(A.token, {
    subject: "Shift roster next week",
    body: "Reply by Wednesday please.",
    recipientIds: [String(A2.userId), String(A3.userId)], // numeric strings accepted
  });
  const M2 = r.json?.data;
  check("C2  multi-recipient send + defaults",
    r.status === 201 && M2.recipientCount === 2 && M2.category === "general" && M2.priority === "normal",
    `${r.status} count=${M2?.recipientCount} ${M2?.category}/${M2?.priority}`);

  r = await send(A.token, { subject: "Note to self", body: "Self reminder.", recipientIds: [A.userId] });
  const M3 = r.json?.data;
  check("C3  self-send creates my own recipient row",
    r.status === 201 && M3.isSentByMe === true && M3.isRead === false,
    `${r.status} read=${M3?.isRead}`);

  r = await send(A.token, { subject: "Sterilizer service", body: "Done this afternoon.", recipientIds: [A2.userId] });
  const M4 = r.json?.data;
  check("C4  fourth message sent", r.status === 201, `${r.status}`);

  // ---- 6. list filters + search ----
  r = await list(A2.token, "?filter=inbox");
  check("F1  recipient inbox = 3, newest first",
    r.status === 200 && ids(r).length === 3 && ids(r)[0] === M4.id &&
    [M1.id, M2.id, M4.id].every((x) => ids(r).includes(x)),
    ids(r).map((x) => x.slice(0, 8)).join(","));
  r = await list(A2.token, "?filter=unread");
  check("F2  unread = 3 before reading", ids(r).length === 3, `n=${ids(r).length}`);
  r = await list(A2.token, "?filter=sent");
  check("F3  recipient's own sent = 0", ids(r).length === 0, `n=${ids(r).length}`);
  r = await list(A.token, "?filter=sent");
  check("F4  sender's sent = 4", ids(r).length === 4, `n=${ids(r).length}`);
  r = await list(A.token, "?filter=inbox");
  check("F5  sender's inbox = self-send only", ids(r).length === 1 && ids(r)[0] === M3.id, `n=${ids(r).length}`);
  r = await list(A3.token, "?filter=inbox");
  check("F6  second recipient sees only their message", ids(r).length === 1 && ids(r)[0] === M2.id, `n=${ids(r).length}`);
  r = await list(Bz.token);
  check("F7  other business sees zero messages", r.status === 200 && ids(r).length === 0, `n=${ids(r).length}`);

  r = await list(A2.token, "?q=Lab%20results");
  check("S1  search by subject -> 1", ids(r).length === 1 && ids(r)[0] === M1.id, `n=${ids(r).length}`);
  r = await list(A2.token, `?q=${encodeURIComponent(A.name)}`);
  check("S2  search by sender name -> 3", ids(r).length === 3, `n=${ids(r).length}`);
  r = await list(A2.token, "?q=" + encodeURIComponent("100% margin"));
  check("S3  search by body with literal % -> 1 (wildcards escaped)",
    ids(r).length === 1 && ids(r)[0] === M1.id, `n=${ids(r).length}`);
  r = await list(A2.token, "?q=zzz-nothing");
  check("S4  no-match search -> empty", r.status === 200 && ids(r).length === 0, `n=${ids(r).length}`);
  r = await list(A2.token, "?q=(");
  check("S5  regex/special char search is safe (200)", r.status === 200, `${r.status}`);

  // ---- 7. detail authorization ----
  r = await call(`/staff-messages/${M1.id}`, {}, A.token);
  check("G1  sender can read detail", r.status === 200 && r.json.data?.id === M1.id, `${r.status}`);
  r = await call(`/staff-messages/${M1.id}`, {}, A2.token);
  check("G2  recipient can read detail with sender details + body",
    r.status === 200 && r.json.data?.senderName === A.name &&
    r.json.data?.body.includes("100% margin") && envelopeOk(r),
    `${r.status}`);
  r = await call(`/staff-messages/${M1.id}`, {}, A3.token);
  check("G3  same-business non-participant -> 404", r.status === 404, `${r.status}`);
  r = await call(`/staff-messages/${M1.id}`, {}, Bz.token);
  check("G4  cross-business detail -> 404", r.status === 404, `${r.status}`);
  r = await call("/staff-messages/not-a-uuid", {}, A.token);
  check("G5  malformed id -> 400", r.status === 400, `${r.status}`);

  // ---- 8. recipient status actions ----
  r = await call(`/staff-messages/${M1.id}`, { method: "PATCH", body: JSON.stringify({ isRead: true }) }, A2.token);
  check("P1  mark read 200 + readAt stamped",
    r.status === 200 && r.json.data?.isRead === true && typeof r.json.data?.readAt === "string" && envelopeOk(r),
    `${r.status} readAt=${r.json?.data?.readAt}`);
  r = await list(A2.token, "?filter=unread");
  check("P2  unread filter drops to 2", ids(r).length === 2 && !ids(r).includes(M1.id), `n=${ids(r).length}`);
  r = await call(`/staff-messages/${M1.id}`, { method: "PATCH", body: JSON.stringify({ isRead: false }) }, A2.token);
  check("P3  mark unread clears readAt",
    r.status === 200 && r.json.data?.isRead === false && r.json.data?.readAt === null,
    `${r.status} readAt=${r.json?.data?.readAt}`);
  r = await call(`/staff-messages/${M1.id}`, { method: "PATCH", body: JSON.stringify({ isRead: true }) }, A2.token);
  check("P4  re-read stamps readAt again", r.status === 200 && typeof r.json.data?.readAt === "string", `${r.status}`);
  r = await call(`/staff-messages/${M1.id}`, { method: "PATCH", body: JSON.stringify({ isStarred: true }) }, A2.token);
  check("P5  star toggle 200", r.status === 200 && r.json.data?.isStarred === true, `${r.status}`);
  r = await list(A2.token, "?filter=important");
  check("P6  important filter shows starred message", ids(r).length === 1 && ids(r)[0] === M1.id, `n=${ids(r).length}`);
  r = await call(`/staff-messages/${M1.id}`, { method: "PATCH", body: JSON.stringify({ isArchived: true }) }, A2.token);
  check("P7  archive 200", r.status === 200 && r.json.data?.isArchived === true, `${r.status}`);
  r = await list(A2.token, "?filter=archived");
  check("P8  archived filter shows it", ids(r).length === 1 && ids(r)[0] === M1.id, `n=${ids(r).length}`);
  r = await list(A2.token, "?filter=inbox");
  check("P9  inbox drops to 2 while archived", ids(r).length === 2, `n=${ids(r).length}`);
  // persisted across a fresh read
  r = await call(`/staff-messages/${M1.id}`, {}, A2.token);
  check("P10  status persists (fresh GET)",
    r.json.data?.isRead === true && r.json.data?.isStarred === true && r.json.data?.isArchived === true,
    `${r.json?.data?.isRead}/${r.json?.data?.isStarred}/${r.json?.data?.isArchived}`);
  r = await call(`/staff-messages/${M1.id}`, { method: "PATCH", body: JSON.stringify({ isStarred: false, isArchived: false }) }, A2.token);
  check("P11  multi-key unstar+unarchive applied together",
    r.status === 200 && r.json.data?.isStarred === false && r.json.data?.isArchived === false && r.json.data?.isRead === true,
    `${r.status}`);

  // ---- 9. status action authorization ----
  r = await call(`/staff-messages/${M1.id}`, { method: "PATCH", body: JSON.stringify({ isRead: true }) }, A.token);
  check("P12  sender (non-recipient) cannot change recipient status -> 403", r.status === 403, `${r.status}`);
  r = await call(`/staff-messages/${M1.id}`, { method: "PATCH", body: JSON.stringify({ isRead: true }) }, A3.token);
  check("P13  same-business non-participant PATCH -> 404", r.status === 404, `${r.status}`);
  r = await call(`/staff-messages/${M1.id}`, { method: "PATCH", body: JSON.stringify({ isRead: true }) }, Bz.token);
  check("P14  cross-business PATCH -> 404", r.status === 404, `${r.status}`);
  r = await call(`/staff-messages/${M1.id}`, { method: "PATCH", body: JSON.stringify({ isRead: "yes" }) }, A2.token);
  check("P15  non-boolean isRead -> 400", r.status === 400 && Boolean(r.json.data?.errors?.isRead), `${r.status}`);
  r = await call(`/staff-messages/${M1.id}`, { method: "PATCH", body: JSON.stringify({}) }, A2.token);
  check("P16  empty PATCH -> 400", r.status === 400 && Boolean(r.json.data?.errors?.form), `${r.status}`);
  // dual role: sender AND recipient of the same message (self-send)
  r = await call(`/staff-messages/${M3.id}`, { method: "PATCH", body: JSON.stringify({ isRead: true }) }, A.token);
  check("P17  self-sent message: sender is also recipient -> PATCH allowed",
    r.status === 200 && r.json.data?.isRead === true, `${r.status}`);

  // ---- 10. client-supplied ids are ignored (send as another user?) ----
  r = await send(A.token, {
    subject: "Spoof probe",
    body: "senderId/businessId in the body must be ignored.",
    recipientIds: [A2.userId],
    senderId: Bz.userId,
    userId: Bz.userId,
    businessId: Bz.businessId,
  });
  check("Y1  spoofed senderId/userId/businessId in body ignored",
    r.status === 201 && r.json.data?.senderId === A.userId,
    `${r.status} senderId=${r.json?.data?.senderId} (expected ${A.userId})`);
  r = await list(Bz.token);
  check("Y2  spoofed send still lands only in the sender's business",
    r.status === 200 && ids(r).length === 0, `n=${ids(r).length}`);

  // ---- 10. no credential leakage ----
  const allText = [sentList, r].map((x) => x.text).join(" ") + (await list(A2.token)).text +
    (await call(`/staff-messages/${M1.id}`, {}, A2.token)).text;
  check("X1  responses never contain passwords or emails",
    !allText.includes("password") && !allText.includes("@example.com"),
    allText.slice(0, 0));
}

main()
  .then(async () => {
    // Remove throwaway businesses (FK cascade removes users + messages).
    const ids = businesses;
    const del = await pool.query("DELETE FROM business WHERE id = ANY($1)", [ids]);
    const after = await pool.query(
      "SELECT (SELECT count(*) FROM users) AS u, (SELECT count(*) FROM business) AS b, (SELECT count(*) FROM staff_messages) AS m, (SELECT count(*) FROM staff_message_recipients) AS r"
    );
    check("Z1  throwaway businesses removed (cascade)", del.rowCount === businesses.length, `deleted=${del.rowCount}`);
    check("Z2  staff tables empty again (no fake data left)",
      Number(after.rows[0].m) === 0 && Number(after.rows[0].r) === 0,
      JSON.stringify(after.rows[0]));
    check("Z3  users/business counts restored to baseline",
      Number(after.rows[0].u) === Number(baseline.u) && Number(after.rows[0].b) === Number(baseline.b),
      `baseline u=${baseline.u} b=${baseline.b} -> u=${after.rows[0].u} b=${after.rows[0].b}`);
    await pool.end();
    const failed = results.filter((x) => x.startsWith("FAIL"));
    console.log(results.join("\n"));
    console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
    process.exit(failed.length === 0 ? 0 : 1);
  })
  .catch(async (err) => {
    console.log(results.join("\n"));
    console.error("TEST RUNNER ERROR:", err);
    try {
      if (pool && businesses.length) {
        await pool.query("DELETE FROM business WHERE id = ANY($1)", [businesses]);
      }
      await pool?.end();
    } catch {}
    process.exit(1);
  });
