#!/bin/zsh
cd "${0:A:h}" || exit 1
python3 - <<'PY'
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Timer
import webbrowser

try:
    server = ThreadingHTTPServer(("127.0.0.1", 4173), SimpleHTTPRequestHandler)
except OSError:
    server = ThreadingHTTPServer(("127.0.0.1", 0), SimpleHTTPRequestHandler)

url = f"http://127.0.0.1:{server.server_port}/index.html"
print(f"本地网页已启动：{url}")
print("请保持这个终端窗口打开。关闭窗口后，本地链接会停止工作。")
Timer(0.3, lambda: webbrowser.open(url)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
PY
