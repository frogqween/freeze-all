// Node for Max helper: runs freeze_menu.ps1 and streams its progress back to freezeall.js
const maxApi = require("max-api");
const { spawn } = require("child_process");
const path = require("path");

const ps1 = path.join(__dirname, "freeze_menu.ps1");
let ps = null;

// Stop waiting (a freeze already running inside Live can't be interrupted).
maxApi.addHandler("stop", () => { if (ps) { ps.kill(); ps = null; } });

// "freezeall <start:count> <excluded,indices>" -> select the whole range and freeze it once
maxApi.addHandler("freezeall", (range, exclude) => {
  ps = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", ps1,
     "-Action", "all", "-Range", String(range), "-Exclude", String(exclude || "")],
    { windowsHide: true }
  );
  const me = ps;
  let buf = "";
  let finished = false;
  ps.stdout.on("data", (chunk) => {
    buf += chunk.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      let m;
      if ((m = line.match(/^RUN (\d+) (\S+)/))) maxApi.outlet("rundone", Number(m[1]), m[2]);
      else if (line === "DONE") { finished = true; maxApi.outlet("batchdone"); }
      else if (line.startsWith("ERR")) { finished = true; maxApi.outlet("failed", line.replace(/^ERR\s*/, "").slice(0, 120)); }
    }
  });
  ps.on("close", () => {
    if (!finished && ps === me) maxApi.outlet("failed", "helper stopped unexpectedly");
    if (ps === me) ps = null;
  });
});

// macOS: "macfreeze <count>" -> extend the selection by count-1 tracks and freeze once
maxApi.addHandler("macfreeze", (count) => {
  ps = spawn("osascript", ["-l", "JavaScript", path.join(__dirname, "freeze_mac.js"), String(count)]);
  const me = ps;
  let out = "";
  ps.stdout.on("data", (chunk) => { out += chunk.toString(); });
  ps.stderr.on("data", (chunk) => { out += chunk.toString(); });
  ps.on("close", () => {
    if (ps !== me) return; // stopped
    ps = null;
    const line = out.trim().split(/\r?\n/).pop() || "";
    if (line === "OK") maxApi.outlet("macdone");
    else maxApi.outlet("failed", (line.replace(/^ERR\s*/, "") || "macOS helper failed").slice(0, 120));
  });
});

maxApi.outlet("ready");
