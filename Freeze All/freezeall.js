// Freeze All - selects every freezable track in one selection and freezes them all at once.
autowatch = 0;
inlets = 1;
outlets = 2; // 0 -> node helper, 1 -> UI (freezeall_ui.js)

var running = false;
var targets = [];   // [{ index, path, name }]
var total = 0, frozen = 0;
var skipped = [];
var unfolded = [];  // group track ids we opened, folded back at the end
var lastClick = 0;
var originalSel = null;
var uiState = "idle";

function num(v) { return parseInt(v instanceof Array ? v[0] : v, 10); }
function str(v) { return v instanceof Array ? v.join(" ") : String(v); }
function plural(n, word) { return n + " " + word + (n === 1 ? "" : "s"); }

function ui(state, l1, l2) {
	uiState = state;
	outlet(1, "state", state);
	outlet(1, "counts", frozen, total, skipped.length);
	outlet(1, "line1", l1 || "");
	outlet(1, "line2", l2 || "");
}

// Look at every track and sort it into a bucket.
function analyse() {
	var song = new LiveAPI("live_set");
	var me = new LiveAPI("this_device canonical_parent");
	var n = song.getcount("tracks");
	var r = { todo: [], already: 0, cannot: [], avoid: [], groups: [], n: n };
	for (var i = 0; i < n; i++) {
		var path = "live_set tracks " + i;
		var t = new LiveAPI(path);
		if (t.id == me.id) { r.avoid.push(i); continue; }   // never freeze the track this device sits on
		if (num(t.get("is_foldable")) === 1) { r.groups.push(t.id); continue; }
		if (num(t.get("is_frozen")) === 1) { r.already++; continue; }
		var name = str(t.get("name"));
		var cbf = t.get("can_be_frozen");
		if (cbf && cbf.length && num(cbf) === 0) { r.cannot.push(name); r.avoid.push(i); continue; } // e.g. MIDI trigger tracks
		r.todo.push({ index: i, path: path, name: name });
	}
	return r;
}

function detail(r) {
	var parts = [];
	if (r.already) parts.push(r.already + " already frozen");
	if (r.cannot.length) parts.push(r.cannot.length + " can't freeze");
	return parts.join("  ·  ");
}

// Called when the device loads and when the mouse leaves the panel.
function scan() {
	if (running || uiState !== "idle") return; // keep a finished run's summary on screen
	var r = analyse();
	total = r.todo.length; frozen = 0; skipped = [];
	if (total) ui("idle", plural(total, "track") + " ready to freeze", detail(r));
	else ui("idle", "Nothing left to freeze", detail(r));
}

function ready() {} // node helper started; the first scan comes from live.thisdevice

function bang() {
	var now = Date.now();
	if (now - lastClick < 500) return; // ignore press/release double-fires
	lastClick = now;
	if (running) stop(); else start();
}

function start() {
	var r = analyse();
	targets = r.todo; skipped = []; unfolded = []; frozen = 0;
	total = targets.length;
	if (!total) { ui("done", "Nothing left to freeze", detail(r)); return; }
	originalSel = new LiveAPI("live_set view").get("selected_track");

	// Open every folded group so all tracks are visible and selectable in one sweep.
	for (var g = 0; g < r.groups.length; g++) {
		var group = new LiveAPI("id " + r.groups[g]);
		if (num(group.get("fold_state")) === 1) { group.set("fold_state", 0); unfolded.push(r.groups[g]); }
	}

	// One selection from the first to the last track that needs freezing. Already-frozen tracks
	// and group headers inside it are fine (Live leaves them as they are); tracks Live can't
	// freeze get taken out of the selection by the helper.
	var first = targets[0].index, last = targets[targets.length - 1].index;
	var exclude = [];
	for (var a = 0; a < r.avoid.length; a++)
		if (r.avoid[a] > first && r.avoid[a] < last) exclude.push(r.avoid[a]);

	running = true;
	ui("running", "Freezing " + plural(total, "track"), "All at once  ·  Live shows its progress");

	if (max.os !== "macintosh") {
		outlet(0, "freezeall", first + ":" + (last - first + 1), exclude.length ? exclude.join(",") : "none");
		return;
	}
	// macOS: tracks that can't freeze split the selection (one freeze either side of them).
	macRuns = [];
	var s = -1;
	for (var i = first; i <= last + 1; i++) {
		var inRun = i <= last && exclude.indexOf(i) < 0;
		if (inRun && s < 0) s = i;
		if (!inRun && s >= 0) { macRuns.push([s, i - s]); s = -1; }
	}
	macNext();
}

// --- macOS: select the first track of each stretch here, the helper extends and freezes ---
var macRuns = [];
function macNext() {
	if (!running) return;
	if (!macRuns.length) { batchdone(); return; }
	var run = macRuns.shift();
	var t = new LiveAPI("live_set tracks " + run[0]);
	new LiveAPI("live_set view").set("selected_track", "id", t.id);
	outlet(0, "macfreeze", run[1]);
}
function macdone() { macNext(); }

function countFrozen() {
	var c = 0;
	for (var i = 0; i < targets.length; i++)
		if (num(new LiveAPI(targets[i].path).get("is_frozen")) === 1) c++;
	return c;
}

// --- replies from the node helper ---
function rundone() {
	if (!running) return;
	frozen = countFrozen();
	ui("running", "Freezing " + plural(total, "track"), "All at once  ·  Live shows its progress");
}

var settleTries = 0;
var settle = new Task(function () {
	frozen = countFrozen();
	if (frozen >= total || ++settleTries >= 20) { settle.cancel(); finish(); }
}, this);
settle.interval = 500;

function batchdone() {
	if (!running) return;
	settleTries = 0;
	settle.repeat(); // give Live a moment to report the last tracks as frozen
}

function finish() {
	if (!running) return;
	frozen = countFrozen();
	skipped = [];
	for (var i = 0; i < targets.length; i++)
		if (num(new LiveAPI(targets[i].path).get("is_frozen")) !== 1) skipped.push(targets[i].name);
	halt();
	ui("done", "Froze " + plural(frozen, "track"), skipped.length ? "Not frozen: " + skipped.join(", ") : "Ready to send");
}

function failed() {
	var msg = arrayfromargs(arguments).join(" ");
	frozen = countFrozen();
	halt();
	ui("error", "Couldn't freeze", msg);
}

function stop() {
	outlet(0, "stop");
	frozen = countFrozen();
	halt();
	ui("done", "Stopped after " + plural(frozen, "track"), "Click to carry on");
}

function halt() {
	running = false;
	if (originalSel && originalSel.length >= 2 && num(originalSel[1]) > 0)
		new LiveAPI("live_set view").set("selected_track", "id", num(originalSel[1]));
	for (var i = unfolded.length - 1; i >= 0; i--)
		new LiveAPI("id " + unfolded[i]).set("fold_state", 1);
	unfolded = [];
}
