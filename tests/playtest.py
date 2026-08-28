from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT = os.environ.get("PLAYTEST_ROOT", "http://127.0.0.1:8080").rstrip("/")
OUT = Path(os.environ.get("PLAYTEST_ARTIFACTS", "tests/artifacts"))
OUT.mkdir(exist_ok=True)

def take_short_shot(page, pull=48):
    canvas = page.locator("#game")
    box = canvas.bounding_box()
    state = page.evaluate("window.__TRI_ECHO__.state()")
    x = box["x"] + box["width"] * state["cue"]["x"]
    y = box["y"] + box["height"] * state["cue"]["y"]
    spaces = [
        (x-box["x"]-20, -1, 0),
        (box["x"]+box["width"]-x-20, 1, 0),
        (y-box["y"]-20, 0, -1),
        (box["y"]+box["height"]-y-20, 0, 1),
    ]
    _, dx, dy = max(spaces, key=lambda item: item[0])
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x+dx*pull, y+dy*pull, steps=4)
    page.mouse.up()
    return state

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for name, viewport in [("iphone", {"width": 390, "height": 844}), ("android", {"width": 412, "height": 915}), ("desktop", {"width": 1024, "height": 800})]:
        page = browser.new_page(viewport=viewport, device_scale_factor=1)
        errors = []
        page.on("console", lambda msg: errors.append(f"{msg.text} @ {msg.location}") if msg.type == "error" else None)
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.goto(ROOT, wait_until="networkidle")
        assert page.locator("#menu").get_attribute("open") is not None
        assert page.locator("#continueBtn").is_hidden()
        if name == "android":
            page.locator("#mode").select_option("tour")
        page.locator("#playBtn").click()
        canvas = page.locator("#game")
        box = canvas.bounding_box()
        assert box and box["width"] > 300 and box["height"] > 500
        page.screenshot(path=str(OUT / f"{name}-table.png"), full_page=True)
        state = page.evaluate("window.__TRI_ECHO__.state()")
        assert state["hole"]["r"] >= 30
        assert state["strokes"] == 0
        assert state["par"] >= 2
        if name == "android":
            assert page.locator(".power").count() == 5
            page.locator('[data-power="trace"]').click()
            assert page.evaluate("window.__TRI_ECHO__.state().activePower") == "trace"
        control = page.locator("#cueFace")
        assert control.is_visible()
        before_move = page.evaluate("window.__TRI_ECHO__.state().controlPos")
        handle = page.locator("#moveContact")
        handle_box = handle.bounding_box()
        page.mouse.move(handle_box["x"] + handle_box["width"] / 2, handle_box["y"] + handle_box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + 65, box["y"] + box["height"] * .42, steps=5)
        page.mouse.up()
        after_move = page.evaluate("window.__TRI_ECHO__.state().controlPos")
        assert abs(after_move["x"] - before_move["x"]) > .2
        control_box = control.bounding_box()
        page.mouse.move(control_box["x"] + control_box["width"] / 2, control_box["y"] + control_box["height"] / 2)
        page.mouse.down()
        page.mouse.move(control_box["x"] + control_box["width"] * .78, control_box["y"] + control_box["height"] * .25, steps=4)
        page.mouse.up()
        contact_state = page.evaluate("window.__TRI_ECHO__.state()")
        assert contact_state["contact"]["x"] > .35
        assert contact_state["contact"]["y"] < -.25
        x = box["x"] + box["width"] * state["cue"]["x"]
        y = box["y"] + box["height"] * state["cue"]["y"]
        spaces = [
            (x-box["x"]-20, -1, 0),
            (box["x"]+box["width"]-x-20, 1, 0),
            (y-box["y"]-20, 0, -1),
            (box["y"]+box["height"]-y-20, 0, 1),
        ]
        available, dx, dy = max(spaces, key=lambda item: item[0])
        pull = min(180, available)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x+dx*pull, y+dy*pull, steps=5)
        page.screenshot(path=str(OUT / f"{name}-aim.png"), full_page=True)
        page.mouse.up()
        page.wait_for_function("window.__TRI_ECHO__.state().strokes === 1")
        shot_state = page.evaluate("window.__TRI_ECHO__.state()")
        assert shot_state["active"] is True
        assert shot_state["maxSpeed"] >= 2400
        assert shot_state["cueSpeed"] >= 500, shot_state
        assert shot_state["contact"]["x"] > .35
        assert shot_state["strokes"] == 1
        page.wait_for_timeout(200)
        page.screenshot(path=str(OUT / f"{name}-shot.png"), full_page=True)
        assert errors == [], errors
        if name == "desktop":
            page.locator("#homeBtn").click()
            assert page.locator("#continueBtn").is_visible()
            resumable = page.evaluate("window.__TRI_ECHO__.state()")
            page.locator("#continueBtn").click()
            resumed = page.evaluate("window.__TRI_ECHO__.state()")
            for key in ("seed", "score", "strokes", "totalStrokes", "ballState"):
                assert resumed[key] == resumable[key]
            page.locator("#homeBtn").click()
            page.locator("#mode").select_option("classic")
            page.locator("#playBtn").click()
            classic = page.evaluate("window.__TRI_ECHO__.state()")
            assert classic["mode"] == "classic"
            assert classic["balls"] == 3
            assert classic["hole"] is None
            assert classic["pockets"] == 0
            assert classic["obstacles"] == 0
            assert classic["frictionZone"] is False
            assert classic["rails"] == 0
            assert page.locator(".power").count() == 0
        if name == "iphone":
            assert page.evaluate("navigator.serviceWorker.ready.then(() => true)")
            assert "tri-echo-v4.2.0" in page.request.get(f"{ROOT}/sw.js").text()
            assert "tri-echo-v4.2.0" in page.evaluate("caches.keys()")
            page.context.set_offline(True)
            page.reload(wait_until="domcontentloaded")
            assert page.locator("#playBtn").is_visible()
            page.context.set_offline(False)
        page.close()
    # New v4 modes and table variants
    page = browser.new_page(viewport={"width": 412, "height": 915})
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.goto(ROOT, wait_until="networkidle")
    assert page.locator("#mode option").count() == 9
    page.locator("#mode").select_option("golf")
    page.locator("#tableStyle").select_option("snooker")
    page.locator("#playBtn").click()
    state = page.evaluate("window.__TRI_ECHO__.state()")
    assert state["hole"] is None
    assert state["pockets"] == 6
    page.locator("#homeBtn").click()
    page.locator("#mode").select_option("classic")
    page.locator("#tableStyle").select_option("snooker")
    page.locator("#playBtn").click()
    classic_snooker = page.evaluate("window.__TRI_ECHO__.state()")
    assert classic_snooker["balls"] == 3
    assert classic_snooker["hole"] is None
    assert classic_snooker["pockets"] == 6
    page.locator("#homeBtn").click()
    page.locator("#mode").select_option("hybrid")
    page.locator("#tableStyle").select_option("echo")
    page.locator("#playBtn").click()
    fusion = page.evaluate("window.__TRI_ECHO__.state()")
    assert fusion["hybridPhase"] == "carom"
    assert fusion["hole"] is not None and fusion["hole"]["disabled"] is True
    page.locator("#homeBtn").click()
    for mode, count in [("american", 16), ("british", 22), ("trick", 3)]:
        page.locator("#mode").select_option(mode)
        page.locator("#playBtn").click()
        state = page.evaluate("window.__TRI_ECHO__.state()")
        assert state["mode"] == mode
        assert state["balls"] == count
        assert state["pockets"] == 6
        if mode in ("american", "british"):
            assert state["obstacles"] == 0
            assert state["frictionZone"] is False
        page.locator("#homeBtn").click()
    page.locator("#mode").select_option("trick")
    assert page.locator("#trickRow").is_visible()
    page.locator("#trickDiscipline").select_option("american")
    page.locator("#playBtn").click()
    assert page.evaluate("window.__TRI_ECHO__.state().balls") == 16
    page.locator("#homeBtn").click()
    page.locator("#mode").select_option("training")
    assert page.locator("#trainingRow").is_visible()
    page.locator("#trainingDiscipline").select_option("american")
    page.locator("#playBtn").click()
    american_training = page.evaluate("window.__TRI_ECHO__.state()")
    assert american_training["balls"] == 16
    assert american_training["ballSet"] == "american"
    assert american_training["obstacles"] == 0
    assert american_training["roles"].count("solid") == 7
    assert american_training["roles"].count("stripe") == 7
    page.screenshot(path=str(OUT / "android-v41-pool-training.png"), full_page=True)
    page.locator("#homeBtn").click()
    page.locator("#mode").select_option("training")
    page.locator("#trainingDiscipline").select_option("snooker")
    page.locator("#playBtn").click()
    assert page.evaluate("window.__TRI_ECHO__.state().balls") == 22
    page.screenshot(path=str(OUT / "android-v4-snooker.png"), full_page=True)
    assert errors == [], errors
    page.close()

    # Daily configuration is canonical and does not overwrite normal preferences.
    page = browser.new_page(viewport={"width": 412, "height": 915})
    page.goto(ROOT, wait_until="networkidle")
    page.locator("#mode").select_option("golf")
    page.locator("#difficulty").select_option("relaxed")
    page.locator("#tableStyle").select_option("snooker")
    page.locator("#playBtn").click()
    page.locator("#homeBtn").click()
    page.locator("#mode").select_option("daily")
    assert page.locator("#difficultyRow").is_hidden()
    assert page.locator("#tableStyleRow").is_hidden()
    page.locator("#playBtn").click()
    daily_a = page.evaluate("window.__TRI_ECHO__.state()")
    assert daily_a["difficulty"] == "normal"
    assert daily_a["tableStyle"] == "echo"
    page.locator("#homeBtn").click()
    page.locator("#mode").select_option("golf")
    page.locator("#difficulty").select_option("hard")
    page.locator("#tableStyle").select_option("echo")
    page.locator("#playBtn").click()
    page.locator("#homeBtn").click()
    page.locator("#mode").select_option("daily")
    page.locator("#playBtn").click()
    daily_b = page.evaluate("window.__TRI_ECHO__.state()")
    for key in ("seed", "difficulty", "tableStyle", "ballState"):
        assert daily_b[key] == daily_a[key]
    page.close()

    # Pointer cancellation cannot fire a phantom shot and the next drag still works.
    page = browser.new_page(viewport={"width": 412, "height": 915})
    page.goto(ROOT, wait_until="networkidle")
    page.locator("#playBtn").click()
    box = page.locator("#game").bounding_box()
    state = page.evaluate("window.__TRI_ECHO__.state()")
    x = box["x"] + box["width"] * state["cue"]["x"]
    y = box["y"] + box["height"] * state["cue"]["y"]
    page.dispatch_event("#game", "pointerdown", {"pointerId": 77, "clientX": x, "clientY": y})
    page.dispatch_event("#game", "pointermove", {"pointerId": 77, "clientX": x + 120, "clientY": y})
    page.dispatch_event("#game", "pointercancel", {"pointerId": 77, "clientX": x + 120, "clientY": y})
    assert page.evaluate("window.__TRI_ECHO__.state().strokes") == 0
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 150, y, steps=5)
    page.mouse.up()
    page.wait_for_function("window.__TRI_ECHO__.state().strokes === 1")
    assert page.evaluate("window.__TRI_ECHO__.state().strokes") == 1
    page.close()

    # UI restart restores the observable hole-start state after a real shot.
    page = browser.new_page(viewport={"width": 1024, "height": 800})
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.goto(ROOT, wait_until="networkidle")
    page.locator("#mode").select_option("classic")
    page.locator("#tableStyle").select_option("echo")
    page.locator("#playBtn").click()
    initial = page.evaluate("window.__TRI_ECHO__.state()")
    take_short_shot(page)
    page.wait_for_function("window.__TRI_ECHO__.state().strokes === 1")
    page.wait_for_function("window.__TRI_ECHO__.state().canAcceptGameplayInput === true", timeout=25000)
    changed = page.evaluate("window.__TRI_ECHO__.state()")
    assert changed["strokes"] == 1 and changed["totalStrokes"] == 1
    page.locator("#retryBtn").click()
    restored = page.evaluate("window.__TRI_ECHO__.state()")
    for key in ("mode", "seed", "score", "ballState"):
        assert restored[key] == initial[key]
    assert restored["strokes"] == 0
    assert restored["totalStrokes"] == 0
    assert restored["canAcceptGameplayInput"] is True
    page.screenshot(path=str(OUT / "desktop-restart-restored.png"), full_page=True)
    assert errors == [], errors
    page.close()

    # Delayed reset locks aim, powers and retry, then restores normal input.
    page = browser.new_page(viewport={"width": 412, "height": 915})
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.goto(ROOT, wait_until="networkidle")
    page.locator("#mode").select_option("tour")
    page.locator("#playBtn").click()
    take_short_shot(page)
    page.wait_for_function("window.__TRI_ECHO__.state().interactionLocked && !window.__TRI_ECHO__.state().active", timeout=25000)
    locked = page.evaluate("window.__TRI_ECHO__.state()")
    assert locked["interactionLockReason"] == "shot-resolution"
    assert locked["retryDisabled"] is True
    assert page.locator(".power:enabled").count() == 0
    epoch = locked["roundEpoch"]
    strokes = locked["strokes"]
    cue = locked["cue"]
    box = page.locator("#game").bounding_box()
    x = box["x"] + box["width"] * cue["x"]
    y = box["y"] + box["height"] * cue["y"]
    page.dispatch_event("#game", "pointerdown", {"pointerId": 91, "clientX": x, "clientY": y})
    page.dispatch_event("#game", "pointermove", {"pointerId": 91, "clientX": x+120, "clientY": y})
    page.dispatch_event("#game", "pointerup", {"pointerId": 91, "clientX": x+120, "clientY": y})
    page.locator("#retryBtn").evaluate("button => button.click()")
    still_locked = page.evaluate("window.__TRI_ECHO__.state()")
    assert still_locked["strokes"] == strokes
    assert still_locked["totalStrokes"] == locked["totalStrokes"]
    assert still_locked["roundEpoch"] == epoch
    assert still_locked["dragActive"] is False
    page.screenshot(path=str(OUT / "android-transition-locked.png"), full_page=True)
    page.wait_for_function("window.__TRI_ECHO__.state().canAcceptGameplayInput === true", timeout=5000)
    ready = page.evaluate("window.__TRI_ECHO__.state()")
    assert ready["interactionLocked"] is False
    assert ready["retryDisabled"] is False
    assert page.locator(".power:enabled").count() == 5
    take_short_shot(page)
    page.wait_for_function(f"window.__TRI_ECHO__.state().strokes === {strokes + 1}")
    assert errors == [], errors
    page.close()

    # Persisted sound=false is effective immediately after reload.
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.goto(ROOT, wait_until="networkidle")
    page.evaluate("localStorage.setItem('triEchoSaveV1', JSON.stringify({settings:{sound:false}}))")
    page.reload(wait_until="networkidle")
    page.locator("#playBtn").click()
    assert page.evaluate("window.__TRI_ECHO__.state().soundEnabled") is False
    page.close()
    browser.close()
