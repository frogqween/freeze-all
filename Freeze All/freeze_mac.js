// Freeze All helper for Ableton Live 12 on macOS (JavaScript for Automation, run with osascript).
// Usage: osascript -l JavaScript freeze_mac.js <count>
// The device has already selected the first track. This extends the selection down by
// <count - 1> tracks (Shift+Down, like doing it by hand) and clicks Edit > Freeze Tracks once.
// Needs: System Settings > Privacy & Security > Accessibility > Ableton Live switched on.

function run(argv) {
	var count = parseInt(argv[0] || "1", 10);
	var se = Application("System Events");

	var procs = se.processes.whose({ bundleIdentifier: { _beginsWith: "com.ableton.live" } })();
	if (!procs.length) return "ERR Ableton Live not found";
	var live = procs[0];

	try {
		live.frontmost = true;
		delay(0.3);
		var bar = live.menuBars[0];
		// Put keyboard focus on the Arrangement so Shift+Down extends the track selection.
		bar.menuBarItems.byName("Navigate").menus[0].menuItems.byName("Arrangement View").click();
	} catch (e) {
		return "ERR Mac blocked it - turn on Accessibility for Ableton Live (see the READ ME)";
	}
	delay(0.4);

	for (var i = 1; i < count; i++) {
		se.keyCode(125, { using: "shift down" }); // Down arrow
		delay(0.03);
	}
	delay(0.4);

	// Open the Edit menu (so Live refreshes it), then click Freeze.
	var editItem = bar.menuBarItems.byName("Edit");
	editItem.click();
	delay(0.3);
	var items = editItem.menus[0].menuItems();
	var freeze = null;
	for (var k = 0; k < items.length; k++) {
		var name = "";
		try { name = items[k].name() || ""; } catch (e) {}
		if (/^Freeze Tracks?$/.test(name)) { freeze = items[k]; break; }
	}
	if (!freeze || !freeze.enabled()) {
		se.keyCode(53); // Escape closes the menu
		return "ERR Live won't freeze this selection";
	}
	freeze.click();

	// Wait for Live's "Freeze..." progress window to come and go.
	delay(1);
	var start = Date.now();
	while (Date.now() - start < 3600 * 1000) {
		var busy = false;
		try {
			var wins = live.windows();
			for (var w = 0; w < wins.length; w++) {
				if (/^Freez/.test(wins[w].name() || "")) { busy = true; break; }
			}
		} catch (e) { busy = true; }
		if (!busy) break;
		delay(0.5);
	}
	delay(0.5);
	return "OK";
}
