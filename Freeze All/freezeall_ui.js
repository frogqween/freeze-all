// Freeze All - custom-drawn panel (jsui). Clicking the button sends "bang"; hovering sends "scan".
mgraphics.init();
mgraphics.relative_coords = 0;
mgraphics.autofill = 0;

inlets = 1;
outlets = 1;

var ICE      = [0.49, 0.80, 0.96, 1];   // Live's frozen-track blue, a little brighter
var ICE_DIM  = [0.49, 0.80, 0.96, 0.18];
var RED      = [0.95, 0.42, 0.38, 1];
var INK      = [0.07, 0.09, 0.11, 1];   // dark text on the ice button
var TEXT     = [0.90, 0.91, 0.92, 1];
var MUTED    = [0.60, 0.62, 0.65, 1];
var WELL     = [0.11, 0.12, 0.13, 1];   // recessed areas
var EDGE     = [1, 1, 1, 0.08];

var state = "idle";   // idle | running | done | error
var frozen = 0, total = 0, skipped = 0;
var line1 = "Loading…", line2 = "";
var hover = false, pressed = false;
var spin = 0;
var anim = new Task(function () { spin += 0.12; mgraphics.redraw(); }, this);
anim.interval = 40;

function W() { return box.rect[2] - box.rect[0]; }
function H() { return box.rect[3] - box.rect[1]; }
function btn() { return [8, 8, W() - 16, 54]; }

// --- messages from freezeall.js ---
function anything() {
	var a = arrayfromargs(arguments);
	switch (messagename) {
		case "state":
			state = String(a[0]);
			if (state === "running") anim.repeat(); else anim.cancel();
			break;
		case "counts": frozen = a[0]; total = a[1]; skipped = a[2]; break;
		case "line1": line1 = a.join(" "); break;
		case "line2": line2 = a.join(" "); break;
	}
	mgraphics.redraw();
}

// --- drawing ---
function rgba(c) { mgraphics.set_source_rgba(c[0], c[1], c[2], c[3]); }

function fit(s, maxw) {
	if (mgraphics.text_measure(s)[0] <= maxw) return s;
	while (s.length > 1 && mgraphics.text_measure(s + "…")[0] > maxw) s = s.slice(0, -1);
	return s + "…";
}

function textAt(s, x, y, size, color, bold, align, maxw) {
	mgraphics.select_font_face(bold ? "Ableton Sans Bold" : "Ableton Sans Medium");
	mgraphics.set_font_size(size);
	if (maxw) s = fit(s, maxw);
	var tw = mgraphics.text_measure(s)[0];
	if (align === "center") x -= tw / 2; else if (align === "right") x -= tw;
	rgba(color);
	mgraphics.move_to(x, y);
	mgraphics.show_text(s);
	return tw;
}

function snowflake(cx, cy, r, color, lw) {
	rgba(color);
	mgraphics.set_line_width(lw);
	mgraphics.set_line_cap("round");
	for (var k = 0; k < 6; k++) {
		var a = k * Math.PI / 3 - Math.PI / 2;
		var ex = cx + Math.cos(a) * r, ey = cy + Math.sin(a) * r;
		mgraphics.move_to(cx, cy); mgraphics.line_to(ex, ey);
		// little branches
		var bx = cx + Math.cos(a) * r * 0.55, by = cy + Math.sin(a) * r * 0.55;
		for (var s = -1; s <= 1; s += 2) {
			var b = a + s * 0.75;
			mgraphics.move_to(bx, by);
			mgraphics.line_to(bx + Math.cos(b) * r * 0.32, by + Math.sin(b) * r * 0.32);
		}
	}
	mgraphics.stroke();
}

function paint() {
	var w = W(), b = btn();
	var running = state === "running";

	// button
	mgraphics.rectangle_rounded(b[0], b[1], b[2], b[3], 8, 8);
	if (running) {
		rgba(hover ? [0.95, 0.42, 0.38, 0.22] : [0.95, 0.42, 0.38, 0.12]); mgraphics.fill_preserve();
		rgba(RED); mgraphics.set_line_width(1.5); mgraphics.stroke();
	} else {
		var c = pressed ? [0.38, 0.70, 0.88, 1] : hover ? [0.62, 0.87, 0.99, 1] : ICE;
		rgba(c); mgraphics.fill();
	}

	var cy = b[1] + b[3] / 2;
	if (running) {
		// spinning flake + STOP
		mgraphics.save();
		mgraphics.translate(b[0] + 26, cy);
		mgraphics.rotate(spin);
		snowflake(0, 0, 9, RED, 1.6);
		mgraphics.restore();
		textAt("STOP", b[0] + b[2] / 2 + 8, cy + 6, 17, RED, true, "center");
	} else {
		snowflake(b[0] + 26, cy, 9, INK, 1.8);
		textAt("FREEZE ALL", b[0] + b[2] / 2 + 10, cy + 6, 17, INK, true, "center");
	}

	// progress bar
	var py = b[1] + b[3] + 9, pw = b[2];
	mgraphics.rectangle_rounded(b[0], py, pw, 4, 2, 2); rgba(WELL); mgraphics.fill();
	var done = frozen + skipped;
	var p = total > 0 ? Math.min(1, done / total) : (state === "done" ? 1 : 0);
	if (p > 0) {
		mgraphics.rectangle_rounded(b[0], py, Math.max(4, pw * p), 4, 2, 2);
		rgba(state === "error" ? RED : ICE); mgraphics.fill();
	}

	// counters
	var sy = py + 12, colw = pw / 3;
	var stats = [
		[String(frozen), "FROZEN", ICE],
		[String(skipped), "SKIPPED", skipped ? [0.96, 0.75, 0.40, 1] : MUTED],
		[String(Math.max(0, total - done)), "LEFT", TEXT]
	];
	mgraphics.rectangle_rounded(b[0], sy, pw, 38, 6, 6); rgba(WELL); mgraphics.fill();
	for (var i = 0; i < 3; i++) {
		var cx = b[0] + colw * i + colw / 2;
		textAt(stats[i][0], cx, sy + 19, 15, stats[i][2], true, "center");
		textAt(stats[i][1], cx, sy + 31, 7.5, MUTED, true, "center");
		if (i) { rgba(EDGE); mgraphics.rectangle(b[0] + colw * i, sy + 8, 1, 22); mgraphics.fill(); }
	}

	// status lines
	var ty = sy + 38 + 16;
	var c1 = state === "error" ? RED : TEXT;
	textAt(line1, b[0] + 2, ty, 11, c1, true, "left", pw - 4);
	textAt(line2, b[0] + 2, ty + 14, 9.5, MUTED, false, "left", pw - 4);
}

// --- mouse ---
function inButton(x, y) { var b = btn(); return x >= b[0] && x <= b[0] + b[2] && y >= b[1] && y <= b[1] + b[3]; }

function onclick(x, y) {
	if (!inButton(x, y)) return;
	pressed = true; mgraphics.redraw();
}
function onidle(x, y) {
	var h = inButton(x, y);
	if (h !== hover) { hover = h; mgraphics.redraw(); }
}
function ondrag(x, y, but) {
	if (!but && pressed) { // mouse released
		pressed = false;
		if (inButton(x, y)) outlet(0, "bang");
		mgraphics.redraw();
	}
}
function onidleout() {
	if (hover || pressed) { hover = false; pressed = false; mgraphics.redraw(); }
	if (state === "idle") outlet(0, "scan"); // refresh the counts when the mouse leaves the panel
}
