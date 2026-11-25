#!/usr/bin/env python3
import http.server
import pathlib
import threading
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "assets" / "motion-webp"
DONE = threading.Event()

PAGE = b"""<!doctype html><meta charset=utf-8><title>motion encoder</title><pre id=log>encoding...</pre><script>
(async()=>{
  const log=document.querySelector('#log');
  for(const actor of ['girl','boy']){
    for(let index=0;index<52;index++){
      const file=`frame-${String(index).padStart(3,'0')}`;
      const image=new Image();
      image.src=`/assets/motion-cutout/${actor}/${file}.png`;
      await image.decode();
      const canvas=document.createElement('canvas');
      canvas.width=image.naturalWidth; canvas.height=image.naturalHeight;
      canvas.getContext('2d').drawImage(image,0,0);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.92));
      if(!blob||blob.type!=='image/webp') throw new Error('WebP encoding unavailable');
      const response=await fetch(`/write?actor=${actor}&file=${file}.webp`,{method:'POST',body:blob});
      if(!response.ok) throw new Error(await response.text());
      log.textContent=`${actor} ${index+1}/52`;
    }
  }
  await fetch('/done',{method:'POST'});
  log.textContent='done';
})().catch(error=>{document.querySelector('#log').textContent=error.stack;});
</script>"""


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, format, *args):
        pass

    def do_GET(self):
        if self.path == "/convert":
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(PAGE)))
            self.end_headers()
            self.wfile.write(PAGE)
            return
        super().do_GET()

    def do_POST(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/done":
            DONE.set()
            self.send_response(204)
            self.end_headers()
            return
        if parsed.path != "/write":
            self.send_error(404)
            return
        query = urllib.parse.parse_qs(parsed.query)
        actor = query.get("actor", [""])[0]
        filename = query.get("file", [""])[0]
        if actor not in {"girl", "boy"} or not filename.startswith("frame-") or not filename.endswith(".webp"):
            self.send_error(400, "invalid output path")
            return
        length = int(self.headers.get("Content-Length", "0"))
        target = OUTPUT / actor / filename
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(self.rfile.read(length))
        self.send_response(204)
        self.end_headers()


if __name__ == "__main__":
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 8765), Handler)
    print("http://127.0.0.1:8765/convert", flush=True)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    if not DONE.wait(180):
        raise SystemExit("encoding timed out")
    server.shutdown()
