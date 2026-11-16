"""티스토리·카카오 화면을 흉내 내는 로컬 서버 (실제 사이트에 접속하지 않고 로그인·발행 흐름 점검용)

Chrome 을 --host-resolver-rules 로 이 서버에 연결해 *.tistory.com / *.kakao.com 요청을 받는다.
쿠키 값이 'good' 이면 유효한 세션으로 취급한다.
"""
import http.server
import json
import ssl
import subprocess
import threading
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.parse import urlparse

BLOG = "testblog"

NEWPOST = """<!doctype html><meta charset=utf-8><title>글쓰기</title>
<button id="category-btn">카테고리</button><div id="category-list"></div>
<input id="post-title-inp">
<div id="ed"></div>
<input id="tagText"><div id="tags"></div>
%(file_input)s
<button id="publish-layer-btn" onclick="document.getElementById('layer').style.display='block'">완료</button>
<div id="layer" style="display:none">
 %(radios)s
 <button id="publish-btn" onclick="pub()">공개 발행</button>
</div>
<script>
var content = '', tags = [];
window.tinymce = {activeEditor: {
  setContent: function (h) { content = h; }, getContent: function () { return content; },
  fire: function () {}, save: function () {} }};
document.getElementById('tagText').addEventListener('keydown', function (e) {
  if (e.key === 'Enter') { tags.push(this.value); this.value = ''; } });
var fi = document.querySelector('input[type=file]');
if (fi) fi.addEventListener('change', function () {
  setTimeout(function () { content += '<p><img src="https://img.example/' + fi.files[0].name + '"></p>'; }, 300); });
function pub() {
  var c = document.querySelector('input[name=v]:checked'), v = c ? c.id : 'default-public';
  fetch('/manage/publish', {method: 'POST', body: JSON.stringify({
    title: document.getElementById('post-title-inp').value, content: content, tags: tags, visibility: v})})
    .then(function () { location.href = '/manage/posts/'; });
}
</script>"""


class State:
    def __init__(self):
        self.published = []
        self.file_input = True     # 새 글 화면에 파일 입력란을 둘지
        self.radios = "ok"         # ok: 정상 / missing: 공개범위 선택란 없음 / stuck: 눌러도 선택 안 됨
        self.sso_hits = 0
        self.requests = []


def make_handler(state: State):
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def _cookies(self):
            c = SimpleCookie(self.headers.get("Cookie", ""))
            return {k: v.value for k, v in c.items()}

        def _send(self, body="", code=200, headers=()):
            data = body.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            for k, v in headers:
                self.send_header(k, v)
            self.end_headers()
            self.wfile.write(data)

        def _redirect(self, to, headers=()):
            self._send("", 302, [("Location", to), *headers])

        def do_POST(self):
            n = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(n)
            if urlparse(self.path).path == "/manage/publish" and self._cookies().get("TSSESSION") == "good":
                state.published.append(json.loads(body))
                return self._send("ok")
            self._send("no", 403)

        def do_GET(self):
            host = (self.headers.get("Host") or "").split(":")[0]
            path = urlparse(self.path).path
            ck = self._cookies()
            state.requests.append((host, path))
            if host.endswith("kakao.com"):
                if path == "/sso":
                    state.sso_hits += 1
                    if ck.get("_kawlt") == "good":
                        return self._redirect("https://www.tistory.com/auth/callback")
                    return self._send("<meta charset=utf-8><form><input name='loginId'><input type='password' name='password'>"
                                      "<button type='submit'>로그인</button></form>")
                return self._send("kakao")
            if host == "www.tistory.com":
                if path == "/auth/login":
                    return self._send("<meta charset=utf-8><a class='link_kakao_id' href='https://accounts.kakao.com/sso'>카카오계정으로 로그인</a>")
                if path == "/auth/callback":
                    return self._redirect("https://www.tistory.com/", [("Set-Cookie", "TSSESSION=good; Domain=.tistory.com; Path=/; Secure; HttpOnly")])
                return self._send("tistory home")
            if host == f"{BLOG}.tistory.com" and path.startswith("/manage"):
                if ck.get("TSSESSION") != "good":
                    return self._redirect("https://www.tistory.com/auth/login")
                if path.rstrip("/") == "/manage/newpost":
                    fi = "<input type='file' accept='image/*' style='display:none'>" if state.file_input else ""
                    radios = {"ok": "<input type='radio' name='v' id='open20' checked><input type='radio' name='v' id='open15'>"
                                    "<label for='open0'>비공개</label><input type='radio' name='v' id='open0'>",
                              "missing": "",
                              "stuck": "<input type='radio' name='v' id='open20' checked><input type='radio' name='v' id='open0' "
                                       "onclick='return false'>"}[state.radios]
                    return self._send(NEWPOST % {"file_input": fi, "radios": radios})
                return self._send("<meta charset=utf-8><a href='/manage/posts/'>글 관리</a>")
            self._send("not found", 404)
    return H


def start(tmp: Path):
    """(state, port, stop) 반환"""
    crt, key = tmp / "c.pem", tmp / "k.pem"
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=mock",
                    "-keyout", str(key), "-out", str(crt)], check=True, capture_output=True)
    state = State()
    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), make_handler(state))
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(str(crt), str(key))
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return state, srv.server_address[1], srv.shutdown
