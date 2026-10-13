const fs = require('fs');
const p = 'src/lib/staffDb.ts';
let s = fs.readFileSync(p, 'utf8');
// newlines
s = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
// em/en dashes (U+2014, U+2013) -> " -- "
s = s.replace(/\u2014/g, ' -- ').replace(/\u2013/g, ' - ');
// curly quotes -> straight
s = s.replace(/\u2018/g, "'").replace(/\u2019/g, "'").replace(/\u201c/g, '"').replace(/\u201d/g, '"');
// curly apostrophe already handled by 2019
// any other non-ASCII? replace remaining with a safe placeholder note
let out = [];
for (let i = 0; i < s.length; i++) {
  const c = s[i];
  const code = s.charCodeAt(i);
  if (code > 127) {
    out.push(`\\u${code.toString(16).padStart(4, '0')}`);
  } else {
    out.push(c);
  }
}
const fixed = out.join('');
fs.writeFileSync(p, fixed, 'utf8');
console.log('fixed; len now', fixed.length, '; non-ascii remaining:', [...fixed].filter(c => c.charCodeAt(0) > 127).length);
