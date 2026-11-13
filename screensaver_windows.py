#!/usr/bin/env python3
"""Sushi Rain screensaver for Windows.

Runs in the background while you are logged in. When the computer has had no
mouse or keyboard for a few minutes (screensaver.json, default 5), Sushi Rain
fills every monitor: a borderless browser window per screen (its own throwaway
profile, so your normal browser is untouched), your notes spread across the
screens and the time on your main screen.

Pressing N while it is showing lets you write a note without waking the
desktop: the rain holds still while you type, Enter saves the note into
notes.txt and brings the desktop back, Esc wakes it without saving. Any other
key or a mouse move wakes it as before.

It does not start while the lock screen is up or while a full-screen window is
in front, and it keeps the display awake while it is showing. Turn Windows' own
screen saver off so the two do not fight; see the README.

    screensaver_windows.py                 watch (the Startup shortcut runs this)
    screensaver_windows.py --install       start it with Windows (Startup shortcut)
    screensaver_windows.py --uninstall     remove that shortcut again
    screensaver_windows.py --stop          stop a running watcher and close the rain
    screensaver_windows.py --dry-run       only log what it would do
    screensaver_windows.py --now --for 8   show it right away, close after N seconds
"""
import argparse
import ctypes
import ctypes.wintypes as wt
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(HERE, 'screensaver.json')
PORT = int(os.environ.get('SUSHI_RAIN_PORT', '8777'))
BASE = 'http://127.0.0.1:%d' % PORT
# this visit only: a bit bigger text, and 30 frames a second is plenty for rain
URL = BASE + '/?screensaver=1&fontSize=24&fps=30' + os.environ.get('SUSHI_RAIN_SAVER_EXTRA', '')
PROFILE = os.path.join(os.environ.get('LOCALAPPDATA') or os.path.expanduser('~'), 'Sushi Rain', 'browser-saver')
STARTUP = os.path.join(os.environ.get('APPDATA') or os.path.expanduser('~'),
                       'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup',
                       'Sushi Rain screensaver.lnk')
DEFAULTS = {'enabled': True, 'minutes': 5, 'preview': 0, 'compose': 0, 'wake': 0}
TICK = 0.25              # how often to look at the idle time
GRACE = 2.0              # seconds after showing in which input is ignored (the browser starting)
HIDE_DELAY = 0.5         # seconds to wait before waking, so a note being typed can say so first
RECHECK = 10.0           # seconds between checks while something keeps the screen awake
CREATE_NO_WINDOW = 0x08000000
ES_CONTINUOUS = 0x80000000
ES_SYSTEM_REQUIRED = 0x00000001
ES_DISPLAY_REQUIRED = 0x00000002
SWP_SHOWWINDOW, SWP_FRAMECHANGED = 0x0040, 0x0020
ERROR_ALREADY_EXISTS = 183

PREFS = '''// Sushi Rain screensaver profile (rewritten by screensaver_windows.py):
// no first-run pages, no restore prompts, no default-browser nag, kiosk.
user_pref("browser.shell.checkDefaultBrowser", false);
user_pref("browser.startup.page", 0);
user_pref("browser.aboutwelcome.enabled", false);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("datareporting.policy.firstRunURL", "");
user_pref("toolkit.telemetry.reportingpolicy.firstRun", false);
user_pref("browser.sessionstore.resume_from_crash", false);
user_pref("browser.tabs.warnOnClose", false);
user_pref("browser.warnOnQuit", false);
user_pref("extensions.pocket.enabled", false);
user_pref("browser.translations.automaticallyPopup", false);
user_pref("full-screen-api.warning.timeout", 0);
user_pref("full-screen-api.transition-duration.enter", "0 0");
user_pref("full-screen-api.transition-duration.leave", "0 0");
'''


def log(*a):
    try:
        print(time.strftime('%H:%M:%S'), *a, flush=True)
    except Exception:   # pythonw has no console
        pass


# ---------------------------------------------------------------- Win32 bits
class LASTINPUTINFO(ctypes.Structure):
    _fields_ = [('cbSize', wt.DWORD), ('dwTime', wt.DWORD)]


class RECT(ctypes.Structure):
    _fields_ = [('left', wt.LONG), ('top', wt.LONG), ('right', wt.LONG), ('bottom', wt.LONG)]


class MONITORINFOEXW(ctypes.Structure):
    _fields_ = [('cbSize', wt.DWORD), ('rcMonitor', RECT), ('rcWork', RECT),
                ('dwFlags', wt.DWORD), ('szDevice', ctypes.c_wchar * 32)]


class WinIdle:
    """Milliseconds since the last key press or mouse move (GetLastInputInfo)."""

    def __init__(self):
        self.user32 = ctypes.windll.user32
        self.kernel32 = ctypes.windll.kernel32
        self.info = LASTINPUTINFO()
        self.info.cbSize = ctypes.sizeof(LASTINPUTINFO)
        self.user32.GetLastInputInfo.argtypes = [ctypes.POINTER(LASTINPUTINFO)]
        self.user32.GetLastInputInfo.restype = wt.BOOL
        self.kernel32.GetTickCount.argtypes = []
        self.kernel32.GetTickCount.restype = wt.DWORD

    def ms(self):
        if not self.user32.GetLastInputInfo(ctypes.byref(self.info)):
            return 0
        # GetTickCount wraps every ~49.7 days; the mask keeps the subtraction honest
        return (self.kernel32.GetTickCount() - self.info.dwTime) & 0xFFFFFFFF


def keep_awake(on):
    """While the rain is showing, stop the display / system going to sleep."""
    if os.name != 'nt':
        return
    flags = ES_CONTINUOUS | (ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED if on else 0)
    try:
        ctypes.windll.kernel32.SetThreadExecutionState(ctypes.c_uint(flags))
    except (AttributeError, OSError):
        pass


def locked():
    """True when the lock screen (or a UAC secure desktop) is up."""
    if os.name != 'nt':
        return False
    u = ctypes.windll.user32
    u.OpenInputDesktop.restype = ctypes.c_void_p
    u.OpenInputDesktop.argtypes = [wt.DWORD, wt.BOOL, wt.DWORD]
    handle = u.OpenInputDesktop(0, False, 0x0100)   # DESKTOP_SWITCHDESKTOP
    if not handle:
        return True
    try:
        u.GetUserObjectInformationW.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.c_void_p,
                                                wt.DWORD, ctypes.POINTER(wt.DWORD)]
        u.GetUserObjectInformationW.restype = wt.BOOL
        buf, need = ctypes.create_unicode_buffer(256), wt.DWORD(0)
        if not u.GetUserObjectInformationW(handle, 2, ctypes.cast(buf, ctypes.c_void_p),
                                           ctypes.sizeof(buf), ctypes.byref(need)):
            return True
        return buf.value.lower() != 'default'
    finally:
        u.CloseDesktop.argtypes = [ctypes.c_void_p]
        u.CloseDesktop(handle)


def window_text(hwnd):
    u = ctypes.windll.user32
    u.GetWindowTextLengthW.argtypes = [ctypes.c_void_p]
    u.GetWindowTextLengthW.restype = ctypes.c_int
    u.GetWindowTextW.argtypes = [ctypes.c_void_p, ctypes.c_wchar_p, ctypes.c_int]
    u.GetWindowTextW.restype = ctypes.c_int
    n = u.GetWindowTextLengthW(hwnd)
    buf = ctypes.create_unicode_buffer(n + 1)
    u.GetWindowTextW(hwnd, buf, n + 1)
    return buf.value


def fullscreen_in_front():
    """A full-screen app (game, video) is in front: stay out of the way."""
    if os.name != 'nt':
        return False
    u = ctypes.windll.user32
    u.GetForegroundWindow.restype = ctypes.c_void_p
    u.GetDesktopWindow.restype = ctypes.c_void_p
    u.GetShellWindow.restype = ctypes.c_void_p
    u.GetWindowRect.argtypes = [ctypes.c_void_p, ctypes.POINTER(RECT)]
    u.GetWindowRect.restype = wt.BOOL
    u.MonitorFromWindow.argtypes = [ctypes.c_void_p, wt.DWORD]
    u.MonitorFromWindow.restype = ctypes.c_void_p
    u.GetMonitorInfoW.argtypes = [ctypes.c_void_p, ctypes.POINTER(MONITORINFOEXW)]
    u.GetMonitorInfoW.restype = wt.BOOL
    hwnd = u.GetForegroundWindow()
    if not hwnd or hwnd in (u.GetDesktopWindow(), u.GetShellWindow()):
        return False
    if window_text(hwnd).startswith('Sushi Rain screensaver'):
        return False   # our own windows
    rect = RECT()
    if not u.GetWindowRect(hwnd, ctypes.byref(rect)):
        return False
    info = MONITORINFOEXW()
    info.cbSize = ctypes.sizeof(MONITORINFOEXW)
    mon = u.MonitorFromWindow(hwnd, 2)   # MONITOR_DEFAULTTONEAREST
    if not u.GetMonitorInfoW(mon, ctypes.byref(info)):
        return False
    m = info.rcMonitor
    return (rect.left <= m.left and rect.top <= m.top
            and rect.right >= m.right and rect.bottom >= m.bottom)


def monitors():
    """[(x, y, w, h, primary)] left to right."""
    if os.name != 'nt':
        return [(0, 0, 1920, 1080, True)]
    u = ctypes.windll.user32
    u.GetMonitorInfoW.argtypes = [ctypes.c_void_p, ctypes.POINTER(MONITORINFOEXW)]
    u.GetMonitorInfoW.restype = wt.BOOL
    out = []
    proc = ctypes.WINFUNCTYPE(wt.BOOL, ctypes.c_void_p, ctypes.c_void_p,
                              ctypes.POINTER(RECT), ctypes.c_void_p)

    def visit(hmon, hdc, lprc, data):
        info = MONITORINFOEXW()
        info.cbSize = ctypes.sizeof(MONITORINFOEXW)
        if u.GetMonitorInfoW(hmon, ctypes.byref(info)):
            r = info.rcMonitor
            out.append((r.left, r.top, r.right - r.left, r.bottom - r.top, bool(info.dwFlags & 1)))
        return True

    if not u.EnumDisplayMonitors(None, None, proc(visit), None) or not out:
        return [(0, 0, u.GetSystemMetrics(0), u.GetSystemMetrics(1), True)]
    return sorted(out)


def find_browser(pref='auto'):
    """('chromium' | 'firefox', exe) for Edge, Chrome or Firefox; (None, None) if none."""
    pfx86 = os.environ.get('ProgramFiles(x86)', '')
    pfx = os.environ.get('ProgramFiles', '')
    local = os.environ.get('LOCALAPPDATA', '')
    choices = []
    if pref in ('auto', 'edge'):
        choices.append(('chromium', [
            os.path.join(pfx86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            os.path.join(pfx, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
            shutil.which('msedge'),
        ]))
    if pref in ('auto', 'chrome'):
        choices.append(('chromium', [
            os.path.join(pfx, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            os.path.join(pfx86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            os.path.join(local, 'Google', 'Chrome', 'Application', 'chrome.exe'),
            shutil.which('chrome'),
        ]))
    if pref in ('auto', 'firefox'):
        choices.append(('firefox', [
            os.path.join(pfx, 'Mozilla Firefox', 'firefox.exe'),
            os.path.join(pfx86, 'Mozilla Firefox', 'firefox.exe'),
            shutil.which('firefox'),
        ]))
    for kind, paths in choices:
        for path in paths:
            if path and os.path.exists(path):
                return kind, path
    return None, None


def _taskkill(pid):
    try:
        subprocess.run(['taskkill', '/PID', str(pid), '/T', '/F'], timeout=10,
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW)
    except (OSError, subprocess.SubprocessError):
        pass


def _kill_by_marker(marker):
    """Kill any browser process using the throwaway profile (a crash may leave some)."""
    if os.name != 'nt':
        return
    marker = marker.replace("'", "''")
    ps = ("Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(msedge|chrome|firefox)\\.exe$' "
          "-and $_.CommandLine -and $_.CommandLine.Contains('%s') } | "
          "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }" % marker)
    try:
        subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                        '-Command', ps], timeout=20,
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW)
    except (OSError, subprocess.SubprocessError):
        pass


def run_powershell(script, timeout=20):
    try:
        return subprocess.run(['powershell', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                               '-Command', script], timeout=timeout,
                              stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                              stderr=subprocess.PIPE, creationflags=CREATE_NO_WINDOW).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


class Rain:
    """The browser windows, one per monitor."""

    def __init__(self, browser='auto'):
        self.browser = browser
        self.procs = []
        self.pending = {}
        self.deadline = 0.0

    def start(self):
        kind, exe = find_browser(self.browser)
        if not exe:
            log('no browser found: install Microsoft Edge, Google Chrome or Firefox')
            return
        _kill_by_marker(PROFILE)
        mons = monitors()
        n = max(1, len(mons))
        main = next((i for i, m in enumerate(mons) if m[4]), n // 2)   # the clock goes on the main screen
        urls = [URL + '&part=%d&parts=%d&ssid=%d&clock=%d' % (i, n, i, 1 if i == main else 0)
                for i in range(n)]
        self.procs, self.pending = [], {}
        for i, (x, y, w, h, _) in enumerate(mons):
            profile = os.path.join(PROFILE, 'm%d' % i)
            try:
                os.makedirs(profile, exist_ok=True)
                if kind == 'firefox':
                    with open(os.path.join(profile, 'user.js'), 'w', encoding='utf-8') as f:
                        f.write(PREFS)
                    cmd = [exe, '--new-instance', '--profile', profile, '--kiosk', urls[i]]
                else:
                    cmd = [exe, '--kiosk', urls[i],
                           '--user-data-dir=' + profile,
                           '--no-first-run', '--no-default-browser-check',
                           '--disable-session-crashed-bubble', '--disable-features=Translate,MediaRouter',
                           '--window-position=%d,%d' % (x, y), '--window-size=%d,%d' % (w, h)]
                self.procs.append(subprocess.Popen(
                    cmd, stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW))
                self.pending[i] = (x, y, w, h)
            except OSError as e:
                log('could not start', exe, ':', e)
        self.deadline = time.time() + 25

    def tick(self):
        """Put each window on its monitor as it appears."""
        if not self.pending:
            return
        if time.time() > self.deadline:
            log('gave up placing windows:', sorted(self.pending))
            self.pending = {}
            return
        u = ctypes.windll.user32
        u.EnumWindows.restype = wt.BOOL
        u.SetWindowPos.argtypes = [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_int, ctypes.c_int,
                                   ctypes.c_int, ctypes.c_int, wt.UINT]
        u.SetWindowPos.restype = wt.BOOL
        found = {}
        proc = ctypes.WINFUNCTYPE(wt.BOOL, ctypes.c_void_p, ctypes.c_void_p)

        def visit(hwnd, data):
            title = window_text(hwnd)
            if 'Sushi Rain screensaver' not in title:
                return True
            for i in list(self.pending):
                if 'Sushi Rain screensaver %d' % i in title:
                    found[i] = hwnd
            return True

        u.EnumWindows(proc(visit), None)
        for i, hwnd in found.items():
            x, y, w, h = self.pending.pop(i)
            u.SetWindowPos(hwnd, 0, x, y, w, h, SWP_SHOWWINDOW | SWP_FRAMECHANGED)

    def stop(self):
        if not self.procs and not self.pending:
            return
        procs, self.procs, self.pending = self.procs, [], {}
        for p in procs:
            _taskkill(p.pid)
        _kill_by_marker(PROFILE)


class Config:
    def __init__(self):
        self.mtime, self.cfg = None, dict(DEFAULTS)

    def get(self):
        try:
            m = os.stat(CONFIG).st_mtime_ns
        except FileNotFoundError:
            return self.cfg
        if m != self.mtime:
            self.mtime = m
            try:
                with open(CONFIG, encoding='utf-8') as f:
                    got = json.load(f)
                cfg = dict(DEFAULTS)
                if isinstance(got, dict):
                    cfg.update({k: got[k] for k in DEFAULTS if k in got})
                self.cfg = cfg
            except (OSError, ValueError):
                pass
        return self.cfg


def server_up():
    try:
        with urllib.request.urlopen(BASE + '/api/ping', timeout=1) as r:
            return r.status == 200
    except OSError:
        return False


def inhibited():
    # Windows has no public "something is keeping the screen awake" query;
    # full-screen games and videos are caught by fullscreen_in_front().
    return False


class Saver:
    def __init__(self, dry=False, minutes=None, now_for=None, browser='auto'):
        self.dry, self.minutes_override = dry, minutes
        self.idle, self.cfg, self.rain = WinIdle(), Config(), Rain(browser)
        self.shown_at = 0.0
        self.prev_idle = 0
        self.blocked_until = 0.0
        self.last_lock_check = 0.0
        self.last_why = None
        self.close_at = 0.0
        self.done = False
        self.hide_due = 0.0
        self.seen_preview = self.cfg.get().get('preview', 0)   # an old "Try it now" doesn't count
        self.seen_wake = self.cfg.get().get('wake', 0)         # ditto for an old saved note
        log('Sushi Rain screensaver watching%s' % (' (dry run)' if dry else ''))
        if now_for:
            self.show('--now')
            self.close_at = time.time() + now_for

    def showing(self):
        return self.shown_at > 0

    def step(self):
        now, idle = time.time(), self.idle.ms()
        cfg = self.cfg.get()
        if self.showing():
            self.rain.tick()
            if self.close_at and now > self.close_at:
                self.hide('time is up')
            elif cfg.get('wake', 0) > self.seen_wake:   # a note was saved from the screensaver
                self.seen_wake = cfg['wake']
                self.hide('a note was saved')
            else:
                if now * 1000 < cfg.get('compose', 0):   # a note is being typed: don't wake up yet
                    self.hide_due = 0.0
                elif self.hide_due:
                    if now >= self.hide_due:             # the page never said it was composing: wake up
                        self.hide("you're back")
                elif now - self.shown_at > GRACE and idle < self.prev_idle:
                    # wait a moment, in case the page is just about to say it is composing
                    self.hide_due = now + HIDE_DELAY
                if self.showing() and now - self.last_lock_check > 2:
                    self.last_lock_check = now
                    if locked():
                        self.hide('the lock screen came up')
            self.prev_idle = idle
            return
        if self.close_at:   # --now: done
            return
        self.prev_idle = idle
        self.hide_due = 0.0
        self.seen_wake = cfg.get('wake', 0)
        if cfg.get('preview', 0) > self.seen_preview:   # "Try it now"
            self.seen_preview = cfg['preview']
            if server_up():
                self.show('try it now')
            return
        minutes = self.minutes_override if self.minutes_override is not None else cfg.get('minutes', 5)
        if not cfg.get('enabled', True) or idle < minutes * 60000 or now < self.blocked_until:
            return
        why = ('a full-screen window is in front' if fullscreen_in_front()
               else 'the lock screen is up' if locked()
               else 'the Sushi Rain server is not running' if not server_up() else None)
        if why:
            if why != self.last_why:   # say it once, not every 10 seconds of a two-hour film
                log('idle %ds, not starting: %s' % (idle // 1000, why))
            self.last_why = why
            self.blocked_until = now + RECHECK
            return
        self.last_why = None
        self.show('idle %d min' % (idle // 60000))

    def show(self, why):
        self.shown_at = time.time()
        self.last_lock_check = self.shown_at
        log('rain on (%s)' % why)
        if not self.dry:
            keep_awake(True)
            self.rain.start()

    def hide(self, why):
        log('rain off (%s)' % why)
        self.shown_at = 0.0
        self.hide_due = 0.0
        if not self.dry:
            keep_awake(False)
            self.rain.stop()
        if self.close_at:
            self.done = True


def already_running():
    """(a watcher is already running, handle to keep alive for this process)."""
    if os.name != 'nt':
        return False, None
    k = ctypes.windll.kernel32
    k.CreateMutexW.restype = ctypes.c_void_p
    k.CreateMutexW.argtypes = [ctypes.c_void_p, wt.BOOL, ctypes.c_wchar_p]
    handle = k.CreateMutexW(None, False, 'SushiRainScreensaver')
    return bool(handle) and k.GetLastError() == ERROR_ALREADY_EXISTS, handle


def install():
    if os.name != 'nt':
        print('--install only works on Windows.', file=sys.stderr)
        return 2
    pythonw = os.path.join(os.path.dirname(sys.executable), 'pythonw.exe')
    if not os.path.exists(pythonw):
        pythonw = sys.executable
    script = os.path.abspath(__file__)
    q = lambda s: s.replace("'", "''")   # for PowerShell single-quoted strings
    os.makedirs(os.path.dirname(STARTUP), exist_ok=True)
    ps = ("$ws = New-Object -ComObject WScript.Shell; "
          "$s = $ws.CreateShortcut('%s'); "
          "$s.TargetPath = '%s'; $s.Arguments = '\"%s\"'; $s.WorkingDirectory = '%s'; $s.Save()"
          % (q(STARTUP), q(pythonw), q(script), q(os.path.dirname(script))))
    if not run_powershell(ps):
        print('Could not write the Startup shortcut.', file=sys.stderr)
        return 1
    print('Sushi Rain screensaver will start with Windows (hidden).')
    print('Shortcut:', STARTUP)
    print()
    print('Before the first run:')
    print('  - turn Windows\' own screen saver off (Settings > Personalization > Lock screen > Screen saver > None)')
    print('  - set "Turn off my screen after" longer than the Sushi Rain delay')
    print()
    print('Try it now:  py -3 screensaver_windows.py --now --for 20')
    print('Or in the app: Esc menu > Screensaver > Try it now.')
    return 0


def uninstall():
    if os.name != 'nt':
        print('--uninstall only works on Windows.', file=sys.stderr)
        return 2
    try:
        os.remove(STARTUP)
        print('Sushi Rain screensaver will no longer start with Windows.')
    except FileNotFoundError:
        print('Nothing to remove (it was not set to start with Windows).')
    except OSError as e:
        print('Could not remove %s: %s' % (STARTUP, e), file=sys.stderr)
        return 1
    return 0


def stop():
    if os.name != 'nt':
        print('--stop only works on Windows.', file=sys.stderr)
        return 2
    ps = ("Get-CimInstance Win32_Process | Where-Object { $_.Name -match '^(pythonw|python)\\.exe$' "
          "-and $_.CommandLine -and $_.CommandLine.Contains('screensaver_windows.py') } | "
          "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
    run_powershell(ps)
    _kill_by_marker(PROFILE)
    print('Sushi Rain screensaver stopped.')
    return 0


def main():
    ap = argparse.ArgumentParser(description='Sushi Rain screensaver for Windows')
    ap.add_argument('--install', action='store_true', help='start it with Windows (Startup folder shortcut)')
    ap.add_argument('--uninstall', action='store_true', help='stop starting it with Windows')
    ap.add_argument('--stop', action='store_true', help='stop a running watcher and close the rain')
    ap.add_argument('--dry-run', action='store_true', help='only log what would happen')
    ap.add_argument('--minutes', type=float, help='idle minutes before starting (overrides screensaver.json)')
    ap.add_argument('--now', action='store_true', help='show it right away (for testing)')
    ap.add_argument('--for', dest='secs', type=float, default=8, help='with --now: close after this many seconds')
    ap.add_argument('--browser', choices=['auto', 'edge', 'chrome', 'firefox'],
                    default=os.environ.get('SUSHI_RAIN_BROWSER', 'auto'),
                    help='which browser to fill the screens with (default: Edge, then Chrome, then Firefox)')
    a = ap.parse_args()

    if a.install:
        return install()
    if a.uninstall:
        return uninstall()
    if a.stop:
        return stop()
    if os.name != 'nt':
        print('This watcher is for Windows. On Linux use screensaver.py.', file=sys.stderr)
        return 2

    handle = None
    if not a.now:
        already, handle = already_running()
        if already:
            log('already running')
            return 0

    saver = Saver(dry=a.dry_run, minutes=a.minutes, now_for=a.secs if a.now else None, browser=a.browser)
    try:
        while not saver.done:
            try:
                saver.step()
            except Exception as e:   # never die over one bad tick
                log('tick failed:', repr(e))
            time.sleep(TICK)
    except KeyboardInterrupt:
        saver.hide('stopping')
    _ = handle   # keep the single-instance mutex alive until we exit
    return 0


if __name__ == '__main__':
    sys.exit(main())
