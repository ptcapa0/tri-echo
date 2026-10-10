#!/usr/bin/env python3
"""PR10 browser acceptance tests, always in a fresh Chromium profile.

The app is served below /client/ so relative URLs and the service-worker scope
match production Pages.  Faults replace native Web Storage boundaries before
the application module runs; they do not use an app-only test switch.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import sync_playwright


HERE = Path(__file__).resolve().parents[1]
APP_ROOT = Path(os.environ.get("PR10_APP_ROOT", HERE / "dist" / "client")).resolve()
OUT = Path(os.environ.get("PLAYTEST_ARTIFACTS", HERE / "tests" / "artifacts"))
OUT.mkdir(parents=True, exist_ok=True)


class ClientHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=str(APP_ROOT), **kwargs)

    def translate_path(self, path):
        path = urlparse(path).path
        if not (path == "/client" or path.startswith("/client/")):
            return str(APP_ROOT / "__missing__")
        relative = unquote(path.removeprefix("/client/") or "index.html")
        candidate = (APP_ROOT / relative).resolve()
        return str(candidate if candidate.is_relative_to(APP_ROOT) else APP_ROOT / "__missing__")

    def log_message(self, *_):
        pass


def serve():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), ClientHandler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, f"http://127.0.0.1:{httpd.server_port}/client/"


def faults_init(kind, raw=None):
    raw_setup = "" if raw is None else f"localStorage.setItem('triEchoSaveV1', {json.dumps(raw)});"
    if kind == "getter":
        fault = "Object.defineProperty(window, 'localStorage', {configurable:true,get(){throw new DOMException('denied','SecurityError')}});"
    elif kind == "get":
        fault = "Storage.prototype.getItem=function(key){if(key==='triEchoSaveV1')throw new DOMException('denied','SecurityError');return window.__pr10Get.call(this,key)};"
    elif kind in {"setter", "quota"}:
        name = "QuotaExceededError" if kind == "quota" else "SecurityError"
        fault = f"Storage.prototype.setItem=function(key,value){{if(key==='triEchoSaveV1'&&window.__pr10FailWrites)throw new DOMException('denied','{name}');return window.__pr10Set.call(this,key,value)}};"
    else:
        raise ValueError(kind)
    return f"""(() => {{
      window.__pr10Get=Storage.prototype.getItem; window.__pr10Set=Storage.prototype.setItem;
      window.__pr10FailWrites=true; {raw_setup} {fault}
    }})()"""


def errors(page):
    found = []
    page.on("pageerror", lambda error: found.append(str(error)))
    page.on("console", lambda msg: found.append(msg.text) if msg.type == "error" else None)
    return found


def check_notice(page, mode):
    notices = page.locator(".storage-status")
    assert notices.count() >= 4
    assert all(notices.nth(i).get_attribute("data-storage-mode") == mode for i in range(notices.count()))
    assert any(notices.nth(i).is_visible() for i in range(notices.count())) == (mode != "persistent")


def dialog_notice_in_viewport(page, dialog):
    notice = page.locator(f"{dialog} .storage-status")
    assert notice.is_visible()
    box = notice.bounding_box()
    viewport = page.viewport_size
    assert box and box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= viewport["width"] and box["y"] + box["height"] <= viewport["height"], box


def shot(page, settle=True):
    canvas = page.locator("#game")
    box = canvas.bounding_box()
    state = page.evaluate("window.__TRI_ECHO__.state()")
    x = box["x"] + box["width"] * state["cue"]["x"]
    y = box["y"] + box["height"] * state["cue"]["y"]
    spaces = [(x - box["x"] - 20, -1, 0), (box["x"] + box["width"] - x - 20, 1, 0),
              (y - box["y"] - 20, 0, -1), (box["y"] + box["height"] - y - 20, 0, 1)]
    _, dx, dy = max(spaces, key=lambda item: item[0])
    page.dispatch_event("#game", "pointerdown", {"pointerId": 901, "clientX": x, "clientY": y})
    page.dispatch_event("#game", "pointermove", {"pointerId": 901, "clientX": x + dx * 48, "clientY": y + dy * 48})
    page.dispatch_event("#game", "pointerup", {"pointerId": 901, "clientX": x + dx * 48, "clientY": y + dy * 48})
    page.wait_for_function("window.__TRI_ECHO__.state().totalStrokes >= 1")
    if settle:
        page.wait_for_function("!window.__TRI_ECHO__.state().active && window.__TRI_ECHO__.state().canAcceptGameplayInput", timeout=30000)


def exported(page):
    with page.expect_download() as event:
        page.locator("#exportBtn").click()
    return json.loads(Path(event.value.path()).read_text())


def import_file(page, value, name="progress.json"):
    page.locator("#importFile").set_input_files({"name": name, "mimeType": "application/json", "buffer": json.dumps(value).encode()})


def baseline(root):
    """Document the unmodified 4.7.2 throw from an actual start write."""
    build_info = json.loads((APP_ROOT / 'build-info.json').read_text())
    assert build_info['version'] == '4.7.2' and build_info['commit'] == '11319baa848625b8a2feb52d1f356b5497c4c089', build_info
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        cases = []
        for kind in ("setter", "quota"):
            context = browser.new_context(viewport={"width": 412, "height": 915}, accept_downloads=True)
            page = context.new_page()
            found = errors(page)
            page.add_init_script(faults_init(kind))
            page.goto(root, wait_until="networkidle")
            page.locator("#playBtn").click()
            page.wait_for_timeout(160)
            page.screenshot(path=str(OUT / f"baseline-denied-{kind}-start.png"), full_page=True)
            cases.append({
                "fault": f"native Storage.prototype.setItem triEchoSaveV1 -> {'QuotaExceededError' if kind == 'quota' else 'SecurityError'} before start",
                "page_errors": found,
                "menu_open": page.locator("#menu").evaluate("e=>e.open"),
                "game_started": page.evaluate("window.__TRI_ECHO__?.state?.() !== null"),
                "verdict": "FAIL" if found else "UNEXPECTED_PASS",
            })
            context.close()
        result = {
            "base_sha": "11319baa848625b8a2feb52d1f356b5497c4c089",
            "version": "4.7.2",
            "build_info": build_info,
            "root": root,
            "artifact_sha256": {name: hashlib.sha256((APP_ROOT / name).read_bytes()).hexdigest() for name in ("js/app.js", "sw.js")},
            "cases": cases,
            "verdict": "FAIL_REPRODUCED" if all(case["verdict"] == "FAIL" for case in cases) else "UNEXPECTED_PASS",
        }
        (OUT / "cold-storage-denied-4.7.2.json").write_text(json.dumps(result, indent=2) + "\n")
        browser.close()
        assert result["verdict"] == "FAIL_REPRODUCED", result


def suite(root):
    assert (APP_ROOT / "index.html").is_file(), f"production artifact missing: {APP_ROOT}"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)

        # A03: denied getter and getItem from boot remain playable and exportable.
        for kind in ("getter", "get"):
            context = browser.new_context(viewport={"width": 412, "height": 915}, accept_downloads=True)
            page = context.new_page(); found = errors(page)
            page.add_init_script(faults_init(kind))
            page.goto(root, wait_until="networkidle")
            check_notice(page, "temporary")
            page.locator("#playBtn").click(); shot(page)
            page.locator("#settingsBtn").click(); latest = exported(page)
            assert latest["stats"]["shots"] >= 1
            page.locator("#settings .close").click(); page.locator("#homeBtn").click(); page.locator("#progressBtn").click()
            # getItem denial is only a read failure; a subsequent durable
            # write truthfully recovers persistence. A denied getter cannot.
            check_notice(page, "temporary" if kind == "getter" else "persistent")
            assert "Tacadas:" in page.locator("#stats").inner_text()
            assert found == [], found
            page.screenshot(path=str(OUT / f"a03-{kind}.png"), full_page=True)
            context.close()

        # A04: setter denial preserves raw durable bytes and retains live data.
        original = json.dumps({"stats": {"shots": 7, "successes": 2, "recent": []}, "settings": {"sound": True, "haptics": True, "reducedMotion": False}})
        for kind in ("setter", "quota"):
          for label, durable in (("fresh", None), ("existing", original)):
            context = browser.new_context(viewport={"width": 412, "height": 915}, accept_downloads=True)
            page = context.new_page(); found = errors(page)
            page.add_init_script(faults_init(kind, durable))
            page.goto(root, wait_until="networkidle")
            page.locator("#playBtn").click(); shot(page)
            # Settings, movable contact control and tutorial all take ordinary
            # write paths while the durable store is unavailable.
            page.wait_for_function("window.__TRI_ECHO__.state().canAcceptGameplayInput", timeout=5000)
            move = page.locator("#moveContact").bounding_box()
            page.mouse.move(move["x"] + 8, move["y"] + 8); page.mouse.down()
            page.mouse.move(move["x"] - 45, move["y"] + 50); page.mouse.up()
            page.locator("#settingsBtn").click(); page.locator("#sound").uncheck(); page.locator("#tutorialBtn").click()
            page.locator("#settingsBtn").click(); latest = exported(page)
            assert latest["stats"]["shots"] >= (8 if durable else 1) and latest["settings"]["sound"] is False
            assert "contactPos" in latest["settings"], latest
            check_notice(page, "temporary")
            page.evaluate("window.__pr10FailWrites=false")
            assert page.evaluate("localStorage.getItem('triEchoSaveV1')") == durable
            assert found == [], found
            page.screenshot(path=str(OUT / f"a04-{kind}-{label}.png"), full_page=True)
            context.close()

        # A05: fail after a healthy start and while a real shot is resolving.
        context = browser.new_context(viewport={"width": 412, "height": 915})
        page = context.new_page(); found = errors(page)
        page.add_init_script("""(() => {
          localStorage.setItem('triEchoSaveV1', JSON.stringify({tutorial:true}));
          window.__pr10Set=Storage.prototype.setItem; window.__pr10ArmFailure=false; window.__pr10FailWrites=false;
          Storage.prototype.setItem=function(k,v){
            if(k==='triEchoSaveV1'&&window.__pr10FailWrites)throw new DOMException('denied','SecurityError');
            const result=window.__pr10Set.call(this,k,v);
            if(k==='triEchoSaveV1'&&window.__pr10ArmFailure){window.__pr10ArmFailure=false;window.__pr10FailWrites=true}
            return result;
          }
        })()""")
        page.goto(root + "?triEchoTest=1", wait_until="networkidle")
        page.locator("#playBtn").click(); page.evaluate("window.__pr10ArmFailure=true"); shot(page, settle=False)
        # The accepted shot was durably written and synchronously armed the
        # native failure; the following resolution/record write is first fail.
        assert page.evaluate("JSON.parse(localStorage.getItem('triEchoSaveV1')).stats.shots") == 1
        page.wait_for_function("!window.__TRI_ECHO__.state().active && window.__TRI_ECHO__.state().canAcceptGameplayInput", timeout=7000)
        page.wait_for_timeout(320); check_notice(page, "temporary")
        # Exercise the delayed daily finish/end transition while persistence is
        # denied. Wait for each scheduled new-hole epoch before resolving the
        # next fixture shot, exactly as ordinary gameplay does.
        page.evaluate("window.__TRI_ECHO_TEST__.startFixture({mode:'daily'})")
        for index in range(5):
            before_epoch = page.evaluate("window.__TRI_ECHO__.state().roundEpoch")
            page.evaluate("window.__TRI_ECHO_TEST__.resolveShot({pocketedIds:[1]})")
            page.wait_for_function(f"window.__TRI_ECHO__.state().holeIndex === {index + 1} && window.__TRI_ECHO__.state().roundEpoch > {before_epoch} && !window.__TRI_ECHO__.state().interactionLocked", timeout=4000)
        page.evaluate("window.__TRI_ECHO_TEST__.resolveShot({pocketedIds:[1]})")
        page.wait_for_function("window.__TRI_ECHO__.state().finished && document.querySelector('#menu').open", timeout=5000)
        assert page.locator("#menu").evaluate("e=>e.open")
        assert found == [], found
        context.close()

        # A06: corrupt data is protected after ordinary save/retry and is exportable.
        for raw in ("{bad", "x" * 1048577, json.dumps({"stats": {"shots": "not-a-number"}})):
            context = browser.new_context(viewport={"width": 412, "height": 915}, accept_downloads=True)
            page = context.new_page(); found = errors(page)
            page.add_init_script(f"localStorage.setItem('triEchoSaveV1', {json.dumps(raw)})")
            page.goto(root, wait_until="networkidle")
            check_notice(page, "corrupt")
            page.locator("#playBtn").click(); shot(page); page.locator("#settingsBtn").click()
            assert page.locator("#retryStorage").is_hidden()
            assert exported(page)["stats"]["shots"] >= 1
            assert page.evaluate("localStorage.getItem('triEchoSaveV1')") == raw
            assert "preservado" in page.locator(".storage-status").filter(has_text="preservado").first.inner_text()
            assert found == [], found
            context.close()

        # A07/A08: retry failure keeps snapshot; recovery writes only the save key,
        # next isolated reload sees the recovered state.
        context = browser.new_context(viewport={"width": 412, "height": 915}, accept_downloads=True)
        page = context.new_page(); found = errors(page)
        page.add_init_script("""(() => { window.__pr10Writes=[]; window.__pr10Set=Storage.prototype.setItem; Storage.prototype.setItem=function(k,v){window.__pr10Writes.push(k);if(k==='triEchoSaveV1'&&window.__pr10FailWrites)throw new DOMException('quota','QuotaExceededError');return window.__pr10Set.call(this,k,v)} })()""")
        page.goto(root, wait_until="networkidle"); page.locator("#playBtn").click()
        page.evaluate("window.__pr10FailWrites=true"); shot(page); page.locator("#settingsBtn").click()
        page.locator("#retryStorage").click(); check_notice(page, "temporary")
        before = exported(page); page.evaluate("window.__pr10FailWrites=false"); page.locator("#retryStorage").click()
        page.wait_for_function("document.querySelector('.storage-status').dataset.storageMode === 'persistent'")
        writes = page.evaluate("window.__pr10Writes")
        assert set(writes) == {"triEchoSaveV1"}, writes
        persisted = page.evaluate("JSON.parse(localStorage.getItem('triEchoSaveV1'))")
        assert persisted == before
        # A reload is a new app session in the same otherwise isolated
        # browser profile; it must observe the recovered durable value.
        page.reload(wait_until="networkidle")
        page.locator("#progressBtn").click(); assert str(before["stats"]["shots"]) in page.locator("#stats").inner_text()
        assert found == [], found
        context.close()

        # A09: failed strict import retains the live round and original bytes;
        # valid import after recovery works. A valid import is the only repair
        # permitted for corrupt bytes.
        candidate = {"stats": {"shots": 99, "successes": 4, "recent": []}, "settings": {"sound": False, "haptics": False, "reducedMotion": True}}
        for kind in ("setter", "quota"):
            context = browser.new_context(viewport={"width": 412, "height": 915})
            page = context.new_page(); found = errors(page)
            page.add_init_script(faults_init(kind, original))
            page.goto(root, wait_until="networkidle"); page.locator("#playBtn").click()
            before_round = page.evaluate("window.__TRI_ECHO__.state()")
            page.locator("#settingsBtn").click()
            before_export = exported(page)
            import_file(page, candidate, f"{kind}.json"); page.wait_for_function("document.querySelector('#toast').textContent.includes('NÃO FOI POSSÍVEL')")
            page.evaluate("window.__pr10FailWrites=false")
            assert page.evaluate("localStorage.getItem('triEchoSaveV1')") == original
            assert page.evaluate("window.__TRI_ECHO__.state().roundEpoch") == before_round["roundEpoch"]
            assert exported(page) == before_export
            import_file(page, candidate, f"{kind}-recovered.json"); page.wait_for_function("document.querySelector('#toast').textContent === 'PROGRESSO IMPORTADO'")
            assert page.evaluate("JSON.parse(localStorage.getItem('triEchoSaveV1')).stats.shots") == 99
            assert found == [], found
            context.close()

        # A getter failure at the actual strict-import boundary is also a
        # transaction failure: retain the captured native store to verify raw
        # bytes without bypassing the application's failing getter.
        context = browser.new_context(viewport={"width": 412, "height": 915}, accept_downloads=True)
        page = context.new_page(); found = errors(page)
        page.add_init_script(f"localStorage.setItem('triEchoSaveV1', {json.dumps(original)})")
        page.goto(root, wait_until="networkidle"); page.locator("#playBtn").click()
        before_round = page.evaluate("window.__TRI_ECHO__.state()")
        page.locator("#settingsBtn").click()
        before_export = exported(page)
        before_bytes = page.evaluate("localStorage.getItem('triEchoSaveV1')")
        page.evaluate("""() => { window.__pr10NativeStore=localStorage; window.__pr10StorageDescriptor=Object.getOwnPropertyDescriptor(window, 'localStorage'); Object.defineProperty(window, 'localStorage', {configurable:true,get(){throw new DOMException('denied','SecurityError')}}) }""")
        import_file(page, candidate, "getter.json"); page.wait_for_function("document.querySelector('#toast').textContent.includes('NÃO FOI POSSÍVEL')")
        assert page.evaluate("window.__pr10NativeStore.getItem('triEchoSaveV1')") == before_bytes
        assert page.evaluate("window.__TRI_ECHO__.state().roundEpoch") == before_round["roundEpoch"]
        assert exported(page) == before_export
        page.evaluate("window.__pr10StorageDescriptor ? Object.defineProperty(window, 'localStorage', window.__pr10StorageDescriptor) : delete window.localStorage")
        assert page.evaluate("localStorage.getItem('triEchoSaveV1')") == before_bytes
        import_file(page, candidate, "getter-recovered.json"); page.wait_for_function("document.querySelector('#toast').textContent === 'PROGRESSO IMPORTADO'")
        assert page.evaluate("JSON.parse(localStorage.getItem('triEchoSaveV1')).stats.shots") == 99
        assert found == [], found
        context.close()

        context = browser.new_context(viewport={"width": 412, "height": 915})
        page = context.new_page(); found = errors(page); raw = "{bad"; page.add_init_script(f"localStorage.setItem('triEchoSaveV1', {json.dumps(raw)})")
        page.goto(root, wait_until="networkidle"); check_notice(page, "corrupt"); page.locator("#openSettings").click()
        import_file(page, candidate, "repair.json"); page.wait_for_function("document.querySelector('#toast').textContent === 'PROGRESSO IMPORTADO'")
        assert page.evaluate("JSON.parse(localStorage.getItem('triEchoSaveV1')).stats.shots") == 99
        assert page.locator(".storage-status").first.get_attribute("data-storage-mode") == "persistent"
        assert found == [], found
        context.close()

        # A10: the notices exist in gameplay and each modal with usable focus.
        for label, viewport in (("phone", {"width": 390, "height": 844}), ("compact", {"width": 320, "height": 568})):
            context = browser.new_context(viewport=viewport)
            page = context.new_page(); found = errors(page); page.add_init_script(faults_init("setter")); page.goto(root, wait_until="networkidle")
            page.locator("#playBtn").click(); check_notice(page, "temporary")
            header = page.locator("header .storage-status").bounding_box()
            assert header and header["y"] >= 0 and header["y"] + header["height"] <= viewport["height"]
            page.locator("#settingsBtn").click(); check_notice(page, "temporary"); dialog_notice_in_viewport(page, "#settings"); assert page.locator("#retryStorage").is_visible()
            page.locator("#settings .close").click(); page.locator("#homeBtn").click(); dialog_notice_in_viewport(page, "#menu")
            page.locator("#progressBtn").click(); check_notice(page, "temporary"); dialog_notice_in_viewport(page, "#progress")
            page.screenshot(path=str(OUT / f"a10-{label}-modal-notices.png"), full_page=True)
            assert found == [], found
            context.close()
        browser.close()
    (OUT / "storage-resilience-results.json").write_text(json.dumps({
        "app_root": str(APP_ROOT),
        "build_info": json.loads((APP_ROOT / 'build-info.json').read_text()),
        "release_id": json.loads((APP_ROOT / 'precache-manifest.json').read_text())['releaseId'],
        "artifact_sha256": {name: hashlib.sha256((APP_ROOT / name).read_bytes()).hexdigest() for name in ("js/app.js", "js/storage.js", "sw.js")},
        "criteria": {key: "PASS" for key in ("A03", "A04", "A05", "A06", "A07", "A08", "A09", "A10")},
        "faults": ["localStorage getter", "Storage.prototype.getItem", "SecurityError setItem", "QuotaExceededError setItem"],
        "served_subpath": "/client/",
    }, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", action="store_true")
    args = parser.parse_args()
    server, root = serve()
    try:
        (baseline if args.baseline else suite)(root)
        print("PR10 storage resilience: PASS")
    finally:
        server.shutdown(); server.server_close()
