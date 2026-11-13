#!/usr/bin/env python3
"""Sushi Rain local server.

Serves the app at http://127.0.0.1:8777/ (this computer only) and keeps the
notes in a plain text file next to it, notes.txt, which you can also open and
edit yourself. The app notices outside edits within a few seconds.

notes.txt, one note per line:
    [ ] 2026-11-13 17:42:05  buy milk
    [x] 2026-11-13 17:45:31  call mum at 6  (done 2026-11-13 18:02:10)
A line with no "[ ]" in front becomes a new note. "\\n" inside a note is a line break.
Which column ("line" in the rain) each note uses is kept in .notes-lines.json.

Settings by environment: SUSHI_RAIN_PORT (8777), SUSHI_RAIN_HOST (127.0.0.1),
SUSHI_RAIN_NOTES (path of the notes file).
"""
import datetime
import http.server
import json
import os
import re
import sys
import threading
import time

ROOT = os.path.dirname(os.path.abspath(__file__))
NOTES = os.path.abspath(os.environ.get('SUSHI_RAIN_NOTES', os.path.join(ROOT, 'notes.txt')))
META = os.path.join(os.path.dirname(NOTES), '.' + os.path.splitext(os.path.basename(NOTES))[0] + '-lines.json')
SAVER = os.path.join(ROOT, 'screensaver.json')   # read by screensaver.py
SAVER_DEFAULTS = {'enabled': True, 'minutes': 5, 'preview': 0, 'compose': 0, 'wake': 0}
PORT = int(os.environ.get('SUSHI_RAIN_PORT', '8777'))
HOST = os.environ.get('SUSHI_RAIN_HOST', '127.0.0.1')
MAX_NOTE = 2000
MAX_BODY = 4 * 1024 * 1024

HEADER = """# Sushi Rain notes: one note per line.
#   [ ] = still raining   [x] = ticked off
#   then the date and time it was added, then the note.
# You can edit this file while the app is open; it picks up changes in a few seconds.
# A line without "[ ]" in front becomes a new note. "\\n" inside a note is a line break.
"""
TS = r'(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?)'
LINE = re.compile(r'^\[([ xX])\]\s+' + TS + r'\s+(.*?)(?:\s+\(done ' + TS + r'\))?\s*$')
lock = threading.Lock()


def fmt(ms):
    return datetime.datetime.fromtimestamp(ms / 1000).strftime('%Y-%m-%d %H:%M:%S')


def parse_ts(s):
    s = s.replace('T', ' ')
    for f in ('%Y-%m-%d %H:%M:%S', '%Y-%m-%d %H:%M'):
        try:
            return int(datetime.datetime.strptime(s, f).timestamp() * 1000)
        except ValueError:
            pass
    return None


def esc(text):
    return text.replace('\\', '\\\\').replace('\r', '').replace('\n', '\\n')


def unesc(text):
    out, i = [], 0
    while i < len(text):
        c = text[i]
        if c == '\\' and i + 1 < len(text):
            n = text[i + 1]
            out.append('\n' if n == 'n' else n)
            i += 2
            continue
        out.append(c)
        i += 1
    return ''.join(out)


def version():
    try:
        st = os.stat(NOTES)
        return '%d-%d' % (st.st_mtime_ns, st.st_size)
    except FileNotFoundError:
        return '0'


def read_meta():
    try:
        with open(META, encoding='utf-8') as f:
            m = json.load(f)
        return m if isinstance(m, dict) else {}
    except (OSError, ValueError):
        return {}


def read_notes():
    """Parse notes.txt into [{id, text, t, done, doneT, x}] (x may be None)."""
    try:
        with open(NOTES, encoding='utf-8') as f:
            lines = f.read().splitlines()
        mtime = int(os.stat(NOTES).st_mtime * 1000)
    except FileNotFoundError:
        return []
    meta, seen, notes = read_meta(), {}, []
    for raw in lines:
        line = raw.strip()
        if not line or line.startswith('#'):
            continue
        m = LINE.match(line)
        if m:
            t = parse_ts(m.group(2)) or mtime
            text, done = unesc(m.group(3)).strip(), m.group(1) in 'xX'
            done_t = parse_ts(m.group(4)) if m.group(4) else (t if done else None)
        else:   # typed straight into the file: a new note
            t, text, done, done_t = mtime, unesc(line).strip(), False, None
        if not text:
            continue
        base = 'n%d' % (t // 1000 * 1000)
        seen[base] = seen.get(base, 0) + 1
        nid = base if seen[base] == 1 else '%s-%d' % (base, seen[base])
        x = meta.get(nid)
        notes.append({'id': nid, 'text': text[:MAX_NOTE], 't': t, 'done': done, 'doneT': done_t,
                      'x': x if isinstance(x, (int, float)) and 0 <= x < 1 else None})
    return notes


def write_notes(notes):
    out, meta = [HEADER], {}
    for n in notes:
        text = str(n.get('text', '')).strip()[:MAX_NOTE]
        if not text:
            continue
        t = n.get('t') if isinstance(n.get('t'), (int, float)) else time.time() * 1000
        line = '[%s] %s  %s' % ('x' if n.get('done') else ' ', fmt(t), esc(text))
        if n.get('done'):
            dt = n.get('doneT') if isinstance(n.get('doneT'), (int, float)) else time.time() * 1000
            line += '  (done %s)' % fmt(dt)
        out.append(line)
        if isinstance(n.get('id'), str) and isinstance(n.get('x'), (int, float)):
            meta[n['id']] = round(float(n['x']), 6)
    for path, body in ((NOTES, '\n'.join(out) + '\n'), (META, json.dumps(meta, indent=0) + '\n')):
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as f:
            f.write(body)
        os.replace(tmp, path)   # never leaves a half-written file


def read_saver():
    cfg = dict(SAVER_DEFAULTS)
    try:
        with open(SAVER, encoding='utf-8') as f:
            got = json.load(f)
        if isinstance(got, dict):
            cfg.update({k: got[k] for k in SAVER_DEFAULTS if k in got})
    except (OSError, ValueError):
        pass
    cfg['enabled'] = bool(cfg['enabled'])
    try:
        cfg['minutes'] = max(1, min(120, int(round(float(cfg['minutes'])))))
    except (TypeError, ValueError):
        cfg['minutes'] = SAVER_DEFAULTS['minutes']
    for k in ('preview', 'compose', 'wake'):   # timestamps in ms; compose = when the hold ends
        try:
            cfg[k] = max(0, int(cfg[k]))
        except (TypeError, ValueError):
            cfg[k] = 0
    return cfg


def write_saver(cfg):
    tmp = SAVER + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(cfg, f, indent=1)
        f.write('\n')
    os.replace(tmp, SAVER)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, fmt_, *args):   # quiet: only errors
        pass

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        super().end_headers()

    # Only answer to this computer's own names (stops "DNS rebinding" tricks from websites).
    def host_ok(self):
        host = (self.headers.get('Host') or '').lower()
        return host in ('127.0.0.1:%d' % PORT, 'localhost:%d' % PORT, '[::1]:%d' % PORT)

    def origin_ok(self):
        origin = self.headers.get('Origin')
        return origin is None or origin in ('http://127.0.0.1:%d' % PORT, 'http://localhost:%d' % PORT)

    def send_json(self, code, obj):
        body = json.dumps(obj).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if not self.host_ok():
            return self.send_error(403)
        path = self.path.split('?', 1)[0]
        if path == '/api/notes':
            with lock:
                ver = version()
                if ('ver=' + ver) in self.path:   # unchanged since the app last looked
                    return self.send_json(200, {'same': True, 'ver': ver})
                return self.send_json(200, {'notes': read_notes(), 'ver': ver, 'file': NOTES})
        if path == '/api/ping':
            return self.send_json(200, {'ok': True, 'file': NOTES})
        if path == '/api/screensaver':
            with lock:
                return self.send_json(200, read_saver())
        if any(part.startswith('.') for part in path.split('/')) or path.endswith(('.py', '.tmp', '.service')):
            return self.send_error(404)
        return super().do_GET()

    def do_HEAD(self):
        if not self.host_ok():
            return self.send_error(403)
        return super().do_HEAD()

    def do_PUT(self):
        if not self.host_ok() or not self.origin_ok():
            return self.send_error(403)
        path = self.path.split('?', 1)[0]
        if path not in ('/api/notes', '/api/screensaver'):
            return self.send_error(404)
        if 'application/json' not in (self.headers.get('Content-Type') or ''):
            return self.send_error(415)
        size = int(self.headers.get('Content-Length') or 0)
        if size <= 0 or size > MAX_BODY:
            return self.send_error(413)
        if path == '/api/screensaver':   # {enabled, minutes} and/or {preview: true} ("try it now")
            try:
                data = json.loads(self.rfile.read(size).decode('utf-8'))
                assert isinstance(data, dict)
            except (ValueError, AssertionError, UnicodeDecodeError):
                return self.send_error(400)
            with lock:
                cfg = read_saver()
                if 'enabled' in data:
                    cfg['enabled'] = bool(data['enabled'])
                if 'minutes' in data:
                    cfg['minutes'] = data['minutes']
                if data.get('preview'):
                    cfg['preview'] = int(time.time() * 1000)
                if 'compose' in data:   # the screensaver stays up while a note is being typed
                    try:
                        secs = max(0.0, min(600.0, float(data.get('seconds') or 0)))
                    except (TypeError, ValueError):
                        secs = 0.0
                    cfg['compose'] = int(time.time() * 1000 + secs * 1000) if data['compose'] else 0
                if data.get('wake'):    # a note was saved: show the desktop again
                    cfg['wake'] = int(time.time() * 1000)
                write_saver(cfg)
                return self.send_json(200, read_saver())
        try:
            data = json.loads(self.rfile.read(size).decode('utf-8'))
            notes = data['notes']
            assert isinstance(notes, list)
        except (ValueError, KeyError, AssertionError, UnicodeDecodeError):
            return self.send_error(400)
        with lock:
            write_notes([n for n in notes if isinstance(n, dict)])
            return self.send_json(200, {'ok': True, 'ver': version(), 'notes': read_notes()})


def main():
    http.server.ThreadingHTTPServer.allow_reuse_address = True
    srv = http.server.ThreadingHTTPServer((HOST, PORT), Handler)
    print('Sushi Rain on http://%s:%d/  notes: %s' % (HOST, PORT, NOTES), flush=True)
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    sys.exit(main())
