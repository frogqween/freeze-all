# Freeze All helper for Ableton Live 12 (Windows).
#   -Action all -Range "0:37" -Exclude "5,9"
#        Selects tracks start..start+count-1 (Live's track order, groups unfolded) in one go,
#        Ctrl+clicks the excluded tracks out of the selection, and fires Freeze once.
#        Already-frozen tracks and group headers can stay in the selection: Live freezes the rest
#        and leaves them alone. Prints "RUN <n> OK|SINGLE" per freeze, then "DONE".
#   -Action freeze    freeze whatever is selected (prints OK / ERR ...)
#   -Action list      print every menu item (troubleshooting)
param([string]$Action = 'freeze', [string]$Range = '', [string]$Exclude = '')

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, Microsoft.VisualBasic
Add-Type @"
using System; using System.Text; using System.Runtime.InteropServices;
public static class FzW {
  [DllImport("user32.dll")] public static extern IntPtr GetMenu(IntPtr h);
  [DllImport("user32.dll")] public static extern int GetMenuItemCount(IntPtr m);
  [DllImport("user32.dll")] public static extern IntPtr GetSubMenu(IntPtr m, int p);
  [DllImport("user32.dll")] public static extern uint GetMenuItemID(IntPtr m, int p);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetMenuString(IntPtr m, uint id, StringBuilder s, int max, uint flag);
  [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern void mouse_event(uint flags, int dx, int dy, uint data, UIntPtr extra);
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X; public int Y; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  // Is Live's "Freeze..." progress window open?
  public static bool FreezeWindowOpen(uint pid) {
    bool found = false;
    EnumWindows((h, l) => {
      uint p; GetWindowThreadProcessId(h, out p);
      if (p == pid && IsWindowVisible(h)) {
        var sb = new StringBuilder(128); GetWindowText(h, sb, 128);
        if (sb.ToString().StartsWith("Freez")) { found = true; return false; }
      }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@
[void][FzW]::SetProcessDPIAware()   # so accessibility rectangles and the mouse use the same pixels

$MF_BYPOSITION = 0x400
$WM_COMMAND = 0x111
$WM_INITMENUPOPUP = 0x117
$WM_UNINITMENUPOPUP = 0x125

$proc = Get-Process | Where-Object { $_.ProcessName -like 'Ableton Live*' -and $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if (-not $proc) { Write-Output 'ERR Ableton Live window not found'; exit 1 }
$hwnd = $proc.MainWindowHandle
$top = [FzW]::GetMenu($hwnd)
if ($top -eq [IntPtr]::Zero) { Write-Output 'ERR Ableton menu bar not readable'; exit 1 }

# ---------- menu: find the Freeze command ----------
function Get-Label($menu, $pos) {
  $sb = New-Object System.Text.StringBuilder 256
  [void][FzW]::GetMenuString($menu, [uint32]$pos, $sb, 256, $MF_BYPOSITION)
  return (($sb.ToString() -replace '&', '') -split "`t")[0].Trim()
}
function Find-Item($menu, $index, $depth) {
  [void][FzW]::SendMessage($hwnd, $WM_INITMENUPOPUP, $menu, [IntPtr]$index)
  $count = [FzW]::GetMenuItemCount($menu)
  $found = $null
  for ($j = 0; $j -lt $count -and -not $found; $j++) {
    $label = Get-Label $menu $j
    $sub = [FzW]::GetSubMenu($menu, $j)
    if ($Action -eq 'list' -and $label) { [Console]::WriteLine(('  ' * $depth) + $label) }
    if ($sub -ne [IntPtr]::Zero) { $found = Find-Item $sub $j ($depth + 1) }
    # Live only refreshes this label when a person opens the menu, so it may read "Unfreeze".
    # It's the same command slot; with any unfrozen track selected Live freezes.
    elseif ($Action -ne 'list' -and $label -match '^(Un)?freeze Tracks?$') { $found = [FzW]::GetMenuItemID($menu, $j) }
  }
  [void][FzW]::SendMessage($hwnd, $WM_UNINITMENUPOPUP, $menu, [IntPtr]::Zero)
  return $found
}
$freezeId = $null
$n = [FzW]::GetMenuItemCount($top)
for ($i = 0; $i -lt $n -and -not $freezeId; $i++) {
  if ($Action -eq 'list') { [Console]::WriteLine((Get-Label $top $i)) }
  $freezeId = Find-Item ([FzW]::GetSubMenu($top, $i)) $i 1
}
if ($Action -eq 'list') { exit 0 }
if (-not $freezeId) { Write-Output 'ERR Freeze Track menu item not found'; exit 1 }

# Fire Freeze, then wait for Live's "Freeze..." progress window to come and go.
function Invoke-Freeze {
  [void][FzW]::SendMessage($hwnd, $WM_COMMAND, [IntPtr]([int]$freezeId), [IntPtr]::Zero)
  $pid_ = [uint32]$proc.Id
  $t0 = Get-Date
  while (-not [FzW]::FreezeWindowOpen($pid_) -and ((Get-Date) - $t0).TotalSeconds -lt 4) { Start-Sleep -Milliseconds 100 }
  while ([FzW]::FreezeWindowOpen($pid_)) { Start-Sleep -Milliseconds 300 }
  Start-Sleep -Milliseconds 500
}

if ($Action -eq 'freeze') { Invoke-Freeze; Write-Output 'OK'; exit 0 }

# ---------- all: one selection through Live 12's accessibility tree ----------
$AE = [System.Windows.Automation.AutomationElement]
$SIP = [System.Windows.Automation.SelectionItemPattern]::Pattern
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker

function Get-TrackItems {
  $root = $AE::FromHandle($hwnd)
  $cond = New-Object System.Windows.Automation.PropertyCondition($AE::NameProperty, 'Track Headers')
  $tree = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
  $list = New-Object System.Collections.ArrayList
  if (-not $tree) { return ,$list }
  function Add-Children($el) {
    $c = $walker.GetFirstChild($el)
    while ($c) {
      if ($c.Current.ControlType -eq [System.Windows.Automation.ControlType]::TreeItem) { [void]$list.Add($c); Add-Children $c }
      $c = $walker.GetNextSibling($c)
    }
  }
  Add-Children $tree
  return ,$list
}

function Focus-Live { [Microsoft.VisualBasic.Interaction]::AppActivate($proc.Id) | Out-Null }
function Key($vk, $up) { [FzW]::keybd_event([byte]$vk, 0, ($(if ($up) { 2 } else { 0 }) -bor 1), [UIntPtr]::Zero) }
function Is-Selected($item) { return $item.GetCurrentPattern($SIP).Current.IsSelected }

# Select start, then Shift+Down to extend - exactly what a person does by hand.
function Select-Range($items, $start, $count) {
  Focus-Live
  $items[$start].GetCurrentPattern($SIP).Select()
  try { $items[$start].SetFocus() } catch {}
  Start-Sleep -Milliseconds 200
  if ($count -gt 1) {
    [FzW]::keybd_event(0x10, 0, 0, [UIntPtr]::Zero)               # Shift down
    try {
      for ($k = 1; $k -lt $count; $k++) { Key 0x28 $false; Key 0x28 $true; Start-Sleep -Milliseconds 30 }  # Down
    } finally { [FzW]::keybd_event(0x10, 0, 2, [UIntPtr]::Zero) }  # Shift up
    Start-Sleep -Milliseconds 300
  }
}

# Ctrl+click a track header to take it out of the selection (only works if it's on screen).
function Deselect-ByClick($item) {
  $r = $item.Current.BoundingRectangle
  if ($r.IsEmpty -or $r.Width -le 0 -or $r.Height -le 0 -or [double]::IsInfinity($r.Left)) { return $false }
  $x = [int]($r.Left + $r.Width * 0.5); $y = [int]($r.Top + [Math]::Min(9, $r.Height / 2))
  $old = New-Object FzW+POINT; [void][FzW]::GetCursorPos([ref]$old)
  Focus-Live
  [void][FzW]::SetCursorPos($x, $y); Start-Sleep -Milliseconds 60
  [FzW]::keybd_event(0x11, 0, 0, [UIntPtr]::Zero)                  # Ctrl down
  try {
    [FzW]::mouse_event(0x02, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 40
    [FzW]::mouse_event(0x04, 0, 0, 0, [UIntPtr]::Zero)
  } finally { [FzW]::keybd_event(0x11, 0, 2, [UIntPtr]::Zero) }
  Start-Sleep -Milliseconds 150
  [void][FzW]::SetCursorPos($old.X, $old.Y)
  return -not (Is-Selected $item)
}

# Selected must be exactly: everything in the range except the excluded tracks.
function Test-Selection($items, $start, $count, $excl) {
  for ($i = 0; $i -lt $items.Count; $i++) {
    $want = ($i -ge $start -and $i -lt $start + $count -and -not ($excl -contains $i))
    if ((Is-Selected $items[$i]) -ne $want) { return $false }
  }
  return $true
}

function Is-Group($item) { return $null -ne $walker.GetFirstChild($item) }

# Select a range (with exclusions) and freeze it, retrying while Live settles.
function Freeze-Range($start, $count, $excl) {
  foreach ($wait in 300, 800, 1500, 2500) {
    Start-Sleep -Milliseconds $wait
    $items = Get-TrackItems
    if ($items.Count -lt $start + $count) { continue }
    Select-Range $items $start $count
    $okEx = $true
    foreach ($e in $excl) { if (Is-Selected $items[$e]) { if (-not (Deselect-ByClick $items[$e])) { $okEx = $false; break } } }
    if (-not $okEx) { return 'EXCL' }
    if (Test-Selection $items $start $count $excl) { Invoke-Freeze; return 'OK' }
  }
  return 'FAIL'
}

$parts = $Range -split ':'
if ($parts.Count -ne 2) { Write-Output 'ERR bad range'; exit 1 }
$start = [int]$parts[0]; $count = [int]$parts[1]
$excl = @($Exclude -split ',' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ })

$res = Freeze-Range $start $count $excl
if ($res -eq 'OK') { [Console]::WriteLine('RUN 1 OK'); [Console]::WriteLine('DONE'); exit 0 }

# Plan B: a track that can't be frozen couldn't be taken out of the selection (it was off screen),
# so freeze the stretches either side of it - still one freeze per stretch, not per track.
$runs = @(); $s = -1
for ($i = $start; $i -le $start + $count; $i++) {
  $inRun = ($i -lt $start + $count) -and -not ($excl -contains $i)
  if ($inRun -and $s -lt 0) { $s = $i }
  if (-not $inRun -and $s -ge 0) { $runs += ,@($s, $i - $s); $s = -1 }
}
$r = 0
foreach ($run in $runs) {
  $r++
  $res = Freeze-Range $run[0] $run[1] @()
  if ($res -eq 'OK') { [Console]::WriteLine("RUN $r OK"); continue }
  # Last resort: one track at a time (skip groups and anything already frozen).
  for ($i = $run[0]; $i -lt $run[0] + $run[1]; $i++) {
    Start-Sleep -Milliseconds 400
    $items = Get-TrackItems
    if ($items.Count -le $i -or (Is-Group $items[$i]) -or $items[$i].Current.Name -match ', Frozen') { continue }
    Focus-Live
    $items[$i].GetCurrentPattern($SIP).Select()
    Start-Sleep -Milliseconds 200
    if (Test-Selection $items $i 1 @()) { Invoke-Freeze }
  }
  [Console]::WriteLine("RUN $r SINGLE")
}
[Console]::WriteLine('DONE')
