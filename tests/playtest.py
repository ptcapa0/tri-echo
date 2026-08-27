from pathlib import Path
import os
from playwright.sync_api import sync_playwright

ROOT = "http://127.0.0.1:8080"
OUT = Path(os.environ.get("PLAYTEST_ARTIFACTS", "tests/artifacts"))
OUT.mkdir(exist_ok=True)

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for name, viewport in [("iphone", {"width": 390, "height": 844}), ("android", {"width": 412, "height": 915}), ("desktop", {"width": 1024, "height": 800})]:
        page = browser.new_page(viewport=viewport, device_scale_factor=1)
        errors = []
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.goto(ROOT, wait_until="networkidle")
        assert page.locator("#menu").get_attribute("open") is not None
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
            page.locator("#mode").select_option("classic")
            page.locator("#playBtn").click()
            classic = page.evaluate("window.__TRI_ECHO__.state()")
            assert classic["mode"] == "classic"
            assert classic["hole"] is None
            assert classic["obstacles"] == 0
            assert classic["frictionZone"] is False
            assert classic["rails"] == 0
            assert page.locator(".power").count() == 0
        if name == "iphone":
            assert page.evaluate("navigator.serviceWorker.ready.then(() => true)")
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
    browser.close()
