import fs from "fs";
import jwt from "jsonwebtoken";
const env = fs.readFileSync(".env", "utf8");
const secret = env.match(/^JWT_SECRET=(.*)$/m)[1].trim();
const t1 = jwt.sign(
  { sub: 5, businessId: "ab6a2799-4979-40ad-8c0d-f617ef8fe8ff", email: "munazzahimran4@gmail.com" },
  secret,
  { expiresIn: "1h" }
);
const t2 = jwt.sign(
  { sub: 6, businessId: "cec97d21-e31d-4395-84d9-829dd54fd035", email: "rayyanimran549@gmail.com" },
  secret,
  { expiresIn: "1h" }
);
fs.writeFileSync(".test-token.tmp", t1);
fs.writeFileSync(".test-isolation.json", JSON.stringify({ token: t2 }));
console.log("tokens ok");
