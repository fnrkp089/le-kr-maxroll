// MAIN world용 묶음 파일 생성: src/core.js + src/hook.js → src/main.js
// 크롬은 같은 파일을 content_scripts 여러 항목에 넣으면 한 번만 주입해서(ISOLATED 쪽만 실행됨)
// MAIN world에는 엔진을 따로 묶은 파일을 넣어야 함.
const fs = require("fs");
const path = require("path");
const dir = path.join(__dirname, "..", "src");
const out =
  "// 자동 생성 파일: node tools/bundle.js (직접 수정 금지, src/core.js와 src/hook.js를 고칠 것)\n" +
  fs.readFileSync(path.join(dir, "core.js"), "utf8") +
  "\n" +
  fs.readFileSync(path.join(dir, "hook.js"), "utf8");
fs.writeFileSync(path.join(dir, "main.js"), out);
console.log("src/main.js", out.length, "bytes");
