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
    page.dispatch_event("#game", "pointerdown", {"pointerId": 88, "clientX": x, "clientY": y})
    page.dispatch_event("#game", "pointermove", {"pointerId": 88, "clientX": x+dx*pull, "clientY": y+dy*pull})
    page.dispatch_event("#game", "pointerup", {"pointerId": 88, "clientX": x+dx*pull, "clientY": y+dy*pull})
    return state

def take_velocity_shot(page, velocity, pointer_id=89):
    box = page.locator("#game").bounding_box()
    state = page.evaluate("window.__TRI_ECHO__.state()")
    cue = state["ballState"][0]
    speed = (velocity["vx"]**2 + velocity["vy"]**2)**.5
    pull = velocity["fullPullCss"] + 4
    x = box["x"] + box["width"] * cue["x"] / velocity["tableWidth"]
    y = box["y"] + box["height"] * cue["y"] / velocity["tableHeight"]
    raw_dx = -velocity["vx"] / speed / velocity["tableWidth"] * box["width"]
    raw_dy = -velocity["vy"] / speed / velocity["tableHeight"] * box["height"]
    screen_length = (raw_dx**2 + raw_dy**2)**.5
    dx = raw_dx / screen_length * pull
    dy = raw_dy / screen_length * pull
    page.dispatch_event("#game", "pointerdown", {"pointerId": pointer_id, "clientX": x, "clientY": y})
    page.dispatch_event("#game", "pointermove", {"pointerId": pointer_id, "clientX": x+dx, "clientY": y+dy})
    page.dispatch_event("#game", "pointerup", {"pointerId": pointer_id, "clientX": x+dx, "clientY": y+dy})

def begin_floating_pull(page, pointer_id, pull_fraction=.75):
    box = page.locator("#game").bounding_box()
    state = page.evaluate("window.__TRI_ECHO__.state()")
    origin = (box["x"] + box["width"] * .42, box["y"] + box["height"] * .58)
    current = (origin[0] + state["fullPullCss"] * pull_fraction, origin[1])
    page.dispatch_event("#game", "pointerdown", {
        "pointerId": pointer_id, "clientX": origin[0], "clientY": origin[1]
    })
    page.dispatch_event("#game", "pointermove", {
        "pointerId": pointer_id, "clientX": current[0], "clientY": current[1]
    })
    return origin, current, page.evaluate("window.__TRI_ECHO__.state()")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for name, viewport in [("iphone", {"width": 390, "height": 844}), ("android", {"width": 412, "height": 915}), ("wide-android", {"width": 430, "height": 932}), ("desktop", {"width": 1024, "height": 800})]:
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
        page.dispatch_event("#game", "pointerdown", {"pointerId": 55, "clientX": x, "clientY": y})
        page.dispatch_event("#game", "pointermove", {"pointerId": 55, "clientX": x+dx*pull, "clientY": y+dy*pull})
        page.screenshot(path=str(OUT / f"{name}-aim.png"), full_page=True)
        page.dispatch_event("#game", "pointerup", {"pointerId": 55, "clientX": x+dx*pull, "clientY": y+dy*pull})
        page.wait_for_function("window.__TRI_ECHO__.state().strokes === 1")
        shot_state = page.evaluate("window.__TRI_ECHO__.state()")
        assert shot_state["active"] is True
        assert shot_state["measuredReach"] >= shot_state["requiredReach"]
        assert shot_state["stepRatio"] <= .65
        assert shot_state["lastShotSpeed"] > 0
        assert shot_state["lastNormalizedPower"] > .5
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
            assert "tri-echo-v4.3.2" in page.request.get(f"{ROOT}/sw.js").text()
            assert "tri-echo-v4.3.2" in page.evaluate("caches.keys()")
            page.evaluate("caches.open('playtest-unrelated-cache')")
            page.evaluate("navigator.serviceWorker.getRegistration().then(registration => registration.unregister())")
            page.reload(wait_until="networkidle")
            assert page.evaluate("navigator.serviceWorker.ready.then(() => true)")
            assert "playtest-unrelated-cache" in page.evaluate("caches.keys()")
            page.evaluate("caches.delete('playtest-unrelated-cache')")
            page.context.set_offline(True)
            page.reload(wait_until="domcontentloaded")
            assert page.locator("#playBtn").is_visible()
            page.context.set_offline(False)
        page.close()

    # Floating Pull is translation-invariant across comfortable mobile origins.
    gesture_results = {}
    for name, viewport in [("iphone", {"width": 390, "height": 844}), ("android", {"width": 412, "height": 915}), ("wide-android", {"width": 430, "height": 932})]:
        page = browser.new_page(viewport=viewport, device_scale_factor=1)
        errors = []
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.goto(ROOT, wait_until="networkidle")
        page.locator("#playBtn").click()
        box = page.locator("#game").bounding_box()
        state = page.evaluate("window.__TRI_ECHO__.state()")
        origins = {
            "center": (.50, .50, 1),
            "bottom-left": (.24, .78, 1),
            "bottom-right": (.76, .78, -1),
        }
        viewport_results = {}
        for origin_index, (origin_name, (rx, ry, dx)) in enumerate(origins.items()):
            x = box["x"] + box["width"] * rx
            y = box["y"] + box["height"] * ry
            samples = []
            for index, fraction in enumerate((.25, .5, .75, 1)):
                pull = state["fullPullCss"] * fraction
                pointer_id = 120 + origin_index * 10 + index
                page.dispatch_event("#game", "pointerdown", {"pointerId": pointer_id, "clientX": x, "clientY": y})
                started = page.evaluate("window.__TRI_ECHO__.state()")
                assert started["dragActive"] is True
                assert abs(started["pullOriginScreen"]["x"] - x) < 1e-6
                assert abs(started["pullOriginScreen"]["y"] - y) < 1e-6
                page.dispatch_event("#game", "pointermove", {"pointerId": pointer_id, "clientX": x+dx*pull, "clientY": y})
                aim = page.evaluate("window.__TRI_ECHO__.state()")
                samples.append((aim["normalizedPower"], aim["shotSpeed"]))
                assert abs(aim["shotSpeed"] - aim["normalizedPower"] * aim["maxSpeed"]) < 1e-6
                if name == "android" and origin_name == "bottom-left" and fraction == .75:
                    page.screenshot(path=str(OUT / "android-floating-pull.png"), full_page=True)
                page.dispatch_event("#game", "pointercancel", {"pointerId": pointer_id, "clientX": x+dx*pull, "clientY": y})
            assert all(samples[i][0] < samples[i+1][0] for i in range(3))
            assert samples[-1][0] > .999
            viewport_results[origin_name] = samples
        for index in range(4):
            translated = [samples[index][0] for samples in viewport_results.values()]
            assert max(translated) - min(translated) < 1e-9, translated
        cue_x = box["x"] + box["width"] * state["cue"]["x"]
        cue_y = box["y"] + box["height"] * state["cue"]["y"]
        page.dispatch_event("#game", "pointerdown", {"pointerId": 160, "clientX": cue_x, "clientY": cue_y})
        assert page.evaluate("window.__TRI_ECHO__.state().dragActive") is True
        page.dispatch_event("#game", "pointercancel", {"pointerId": 160, "clientX": cue_x, "clientY": cue_y})
        object_ball = state["ballState"][1]
        object_x = box["x"] + box["width"] * object_ball["x"] / state["tableWidth"]
        object_y = box["y"] + box["height"] * object_ball["y"] / state["tableHeight"]
        page.dispatch_event("#game", "pointerdown", {"pointerId": 161, "clientX": object_x, "clientY": object_y})
        assert page.evaluate("window.__TRI_ECHO__.state().dragActive") is True
        page.dispatch_event("#game", "pointercancel", {"pointerId": 161, "clientX": object_x, "clientY": object_y})
        x = box["x"] + box["width"] * .5
        y = box["y"] + box["height"] * .5
        dead_pull = state["deadZoneCss"] * .8
        page.dispatch_event("#game", "pointerdown", {"pointerId": 130, "clientX": x, "clientY": y})
        page.dispatch_event("#game", "pointermove", {"pointerId": 130, "clientX": x+dead_pull, "clientY": y})
        page.dispatch_event("#game", "pointerup", {"pointerId": 130, "clientX": x+dead_pull, "clientY": y})
        assert page.evaluate("window.__TRI_ECHO__.state().strokes") == 0
        gesture_results[name] = viewport_results["center"]
        assert errors == [], errors
        page.close()
    for index in range(4):
        powers = [samples[index][0] for samples in gesture_results.values()]
        assert max(powers) - min(powers) < .02, powers

    # A deterministic edge cue no longer constrains full power: the control
    # origin can be moved to a comfortable part of the table.
    for edge in ("left", "right", "top", "bottom"):
        finder = browser.new_page(viewport={"width": 412, "height": 915})
        finder.goto(ROOT, wait_until="networkidle")
        finder.locator("#playBtn").click()
        dimensions = finder.evaluate("window.__TRI_ECHO__.state()")
        seed_base = finder.evaluate("""async ({edge, width, height}) => {
            const {generateTable} = await import('./js/generator.js');
            for (let base = 1; base < 20000; base++) {
                const seed = (base + Math.imul(1, 2654435761)) >>> 0;
                const table = generateTable(seed, 'normal', 0, width, height, {
                    tableStyle: 'echo', ballSet: 'three', traditional: false
                });
                const cue = table.balls[0];
                if (edge === 'left' && cue.x / width < .14) return base;
                if (edge === 'right' && cue.x / width > .86) return base;
                if (edge === 'top' && cue.y / height < .10) return base;
                if (edge === 'bottom' && cue.y / height > .90) return base;
            }
            return null;
        }""", {"edge": edge, "width": dimensions["tableWidth"], "height": dimensions["tableHeight"]})
        finder.close()
        assert seed_base is not None, f"no deterministic {edge} edge seed found"

        page = browser.new_page(viewport={"width": 412, "height": 915})
        errors = []
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.add_init_script(f"Date.now=()=>{seed_base}")
        page.goto(ROOT, wait_until="networkidle")
        page.locator("#playBtn").click()
        box = page.locator("#game").bounding_box()
        state = page.evaluate("window.__TRI_ECHO__.state()")
        if edge == "left":
            assert box["width"] * state["cue"]["x"] < state["fullPullCss"]
            origin = (box["x"] + box["width"] * .72, box["y"] + box["height"] * .55)
            delta = (-state["fullPullCss"] - 2, 0)
            direction_key, direction_sign = "x", 1
        elif edge == "right":
            assert box["width"] * (1 - state["cue"]["x"]) < state["fullPullCss"]
            origin = (box["x"] + box["width"] * .28, box["y"] + box["height"] * .55)
            delta = (state["fullPullCss"] + 2, 0)
            direction_key, direction_sign = "x", -1
        elif edge == "top":
            assert box["height"] * state["cue"]["y"] < state["fullPullCss"]
            origin = (box["x"] + box["width"] * .52, box["y"] + box["height"] * .48)
            delta = (0, -state["fullPullCss"] - 2)
            direction_key, direction_sign = "y", 1
        else:
            assert box["height"] * (1 - state["cue"]["y"]) < state["fullPullCss"]
            origin = (box["x"] + box["width"] * .52, box["y"] + box["height"] * .42)
            delta = (0, state["fullPullCss"] + 2)
            direction_key, direction_sign = "y", -1
        current = (origin[0] + delta[0], origin[1] + delta[1])
        cue_screen = (box["x"] + box["width"] * state["cue"]["x"], box["y"] + box["height"] * state["cue"]["y"])
        assert ((origin[0]-cue_screen[0])**2 + (origin[1]-cue_screen[1])**2)**.5 > 60
        page.dispatch_event("#game", "pointerdown", {"pointerId": 170, "clientX": origin[0], "clientY": origin[1]})
        page.dispatch_event("#game", "pointermove", {"pointerId": 170, "clientX": current[0], "clientY": current[1]})
        aimed = page.evaluate("window.__TRI_ECHO__.state()")
        assert aimed["normalizedPower"] == 1
        assert aimed["shotDirection"][direction_key] * direction_sign > .999
        if edge in ("left", "right", "bottom"):
            page.screenshot(path=str(OUT / f"android-{edge}-edge-full-power.png"), full_page=True)
        page.dispatch_event("#game", "pointerup", {"pointerId": 170, "clientX": current[0], "clientY": current[1]})
        page.wait_for_function("window.__TRI_ECHO__.state().strokes === 1")
        released = page.evaluate("window.__TRI_ECHO__.state()")
        assert abs(released["lastShotSpeed"] - released["maxSpeed"]) < 1e-6
        assert released["lastShotDirection"][direction_key] * direction_sign > .999
        assert errors == [], errors
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
    cancelled = page.evaluate("window.__TRI_ECHO__.state()")
    assert cancelled["strokes"] == 0
    assert cancelled["activeGameplayPointerId"] is None
    _, current, reacquired = begin_floating_pull(page, 78, .6)
    assert reacquired["activeGameplayPointerId"] == 78
    page.dispatch_event("#game", "pointerup", {"pointerId": 78, "clientX": current[0], "clientY": current[1]})
    page.wait_for_function("window.__TRI_ECHO__.state().strokes === 1")
    assert page.evaluate("window.__TRI_ECHO__.state().strokes") == 1
    page.close()

    # Floating Pull has one pointer owner. A second touch cannot replace,
    # mutate, fire, or cancel the first touch's gesture.
    page = browser.new_page(viewport={"width": 412, "height": 915})
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.add_init_script("""
        Object.defineProperty(navigator, 'vibrate', {
            configurable: true,
            value: pattern => { (window.__playtestVibrations ||= []).push(pattern); return true; }
        });
    """)
    page.goto(ROOT, wait_until="networkidle")
    page.locator("#playBtn").click()
    owner_origin, owner_current, owner_state = begin_floating_pull(page, 201)
    assert owner_state["dragActive"] is True
    assert owner_state["normalizedPower"] > .55
    vibration_count = page.evaluate("(window.__playtestVibrations || []).length")
    strokes = owner_state["strokes"]
    last_speed = owner_state["lastShotSpeed"]

    page.dispatch_event("#game", "pointerdown", {
        "pointerId": 202, "clientX": owner_origin[0] - 80, "clientY": owner_origin[1] - 100
    })
    after_secondary_down = page.evaluate("window.__TRI_ECHO__.state()")
    assert after_secondary_down["pullOriginScreen"] == owner_state["pullOriginScreen"]
    assert after_secondary_down["pullCurrentScreen"] == owner_state["pullCurrentScreen"]
    assert after_secondary_down["normalizedPower"] == owner_state["normalizedPower"]
    assert after_secondary_down["shotDirection"] == owner_state["shotDirection"]
    assert after_secondary_down["activeGameplayPointerId"] == 201
    assert after_secondary_down["dragPointerId"] == 201

    page.dispatch_event("#game", "pointermove", {
        "pointerId": 202, "clientX": owner_origin[0] - 160, "clientY": owner_origin[1] + 130
    })
    after_secondary_move = page.evaluate("window.__TRI_ECHO__.state()")
    for key in ("pullOriginScreen", "pullCurrentScreen", "normalizedPower", "shotDirection"):
        assert after_secondary_move[key] == owner_state[key]
    assert page.evaluate("(window.__playtestVibrations || []).length") == vibration_count

    page.dispatch_event("#game", "pointerup", {
        "pointerId": 202, "clientX": owner_origin[0] - 160, "clientY": owner_origin[1] + 130
    })
    after_secondary_up = page.evaluate("window.__TRI_ECHO__.state()")
    assert after_secondary_up["activeGameplayPointerId"] == 201
    assert after_secondary_up["dragActive"] is True
    assert after_secondary_up["active"] is False
    assert after_secondary_up["strokes"] == strokes
    assert after_secondary_up["lastShotSpeed"] == last_speed
    page.screenshot(path=str(OUT / "android-secondary-pointer-ignored.png"), full_page=True)

    page.dispatch_event("#game", "pointerup", {
        "pointerId": 201, "clientX": owner_current[0], "clientY": owner_current[1]
    })
    page.wait_for_function(f"window.__TRI_ECHO__.state().strokes === {strokes + 1}")
    released = page.evaluate("window.__TRI_ECHO__.state()")
    assert released["activeGameplayPointerId"] is None
    assert abs(released["lastNormalizedPower"] - owner_state["normalizedPower"]) < 1e-9
    assert abs(released["lastShotSpeed"] - owner_state["shotSpeed"]) < 1e-6
    assert errors == [], errors
    page.close()

    # Secondary cancellation/lost-capture events leave the owner intact.
    page = browser.new_page(viewport={"width": 412, "height": 915})
    page.goto(ROOT, wait_until="networkidle")
    page.locator("#playBtn").click()
    owner_origin, owner_current, owner_state = begin_floating_pull(page, 211)
    page.dispatch_event("#game", "pointerdown", {
        "pointerId": 212, "clientX": owner_origin[0] - 70, "clientY": owner_origin[1] - 70
    })
    page.dispatch_event("#game", "pointercancel", {"pointerId": 212})
    after_secondary_cancel = page.evaluate("window.__TRI_ECHO__.state()")
    assert after_secondary_cancel["activeGameplayPointerId"] == 211
    assert after_secondary_cancel["normalizedPower"] == owner_state["normalizedPower"]
    page.dispatch_event("#game", "lostpointercapture", {"pointerId": 212})
    after_secondary_lost = page.evaluate("window.__TRI_ECHO__.state()")
    assert after_secondary_lost["activeGameplayPointerId"] == 211
    assert after_secondary_lost["normalizedPower"] == owner_state["normalizedPower"]
    page.dispatch_event("#game", "pointerup", {
        "pointerId": 211, "clientX": owner_current[0], "clientY": owner_current[1]
    })
    page.wait_for_function("window.__TRI_ECHO__.state().strokes === 1")
    page.close()

    # Cancelling the owner never shoots and releases ownership for a new pointer.
    page = browser.new_page(viewport={"width": 412, "height": 915})
    page.goto(ROOT, wait_until="networkidle")
    page.locator("#playBtn").click()
    _, owner_current, _ = begin_floating_pull(page, 221)
    page.dispatch_event("#game", "pointercancel", {
        "pointerId": 221, "clientX": owner_current[0], "clientY": owner_current[1]
    })
    cancelled = page.evaluate("window.__TRI_ECHO__.state()")
    assert cancelled["activeGameplayPointerId"] is None
    assert cancelled["dragActive"] is False
    assert cancelled["strokes"] == 0
    assert cancelled["active"] is False
    _, next_current, next_state = begin_floating_pull(page, 222, .6)
    assert next_state["activeGameplayPointerId"] == 222
    page.dispatch_event("#game", "pointerup", {
        "pointerId": 222, "clientX": next_current[0], "clientY": next_current[1]
    })
    page.wait_for_function("window.__TRI_ECHO__.state().strokes === 1")
    page.close()

    # Lost capture from the owner also cancels without a shot and permits reacquire.
    page = browser.new_page(viewport={"width": 412, "height": 915})
    page.goto(ROOT, wait_until="networkidle")
    page.locator("#playBtn").click()
    begin_floating_pull(page, 231)
    page.dispatch_event("#game", "lostpointercapture", {"pointerId": 231})
    lost = page.evaluate("window.__TRI_ECHO__.state()")
    assert lost["activeGameplayPointerId"] is None
    assert lost["dragActive"] is False
    assert lost["strokes"] == 0
    assert lost["active"] is False
    begin_floating_pull(page, 232, .5)
    reacquired = page.evaluate("window.__TRI_ECHO__.state()")
    assert reacquired["activeGameplayPointerId"] == 232
    page.dispatch_event("#game", "pointercancel", {"pointerId": 232})
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
    page.wait_for_function("window.__TRI_ECHO__.state().interactionLocked && !window.__TRI_ECHO__.state().active", timeout=25000)
    assert page.locator("#retryBtn").is_disabled()
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

    # A simulated read-only search finds a real winning Daily shot; UI input
    # remains locked until completeHole advances to the next generated hole.
    page = browser.new_page(viewport={"width": 412, "height": 915})
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.goto(ROOT, wait_until="networkidle")
    page.locator("#mode").select_option("daily")
    page.locator("#playBtn").click()
    winning_velocity = page.evaluate("""async () => {
        const state = window.__TRI_ECHO__.state();
        const {generateTable} = await import('./js/generator.js');
        const {Physics, STEP} = await import('./js/physics.js');
        const {calibrateShot} = await import('./js/physics-calibration.js');
        const seed = (state.seed + Math.imul(state.holeIndex + 1, 2654435761)) >>> 0;
        const table = generateTable(seed, 'normal', 0, 720, 1120, {
            tableStyle: 'echo', ballSet: 'three', traditional: false
        });
        table.rails = [];
        const metrics = calibrateShot(table);
        for (let degrees = 0; degrees < 360; degrees += 1) {
            const angle = degrees * Math.PI / 180;
            const candidate = structuredClone(table);
            const physics = new Physics(candidate);
            const vx = Math.cos(angle) * metrics.maxSpeed;
            const vy = Math.sin(angle) * metrics.maxSpeed;
            physics.shoot(vx, vy, {x: 0, y: 0}, 1, {});
            for (let step = 0; step < 3241 && physics.active; step++) physics.step(STEP);
            if (physics.pocketed.some(id => id > 0) && !physics.pocketed.includes(0)) {
                return {vx, vy, fullPullCss: state.fullPullCss, tableWidth: table.w, tableHeight: table.h};
            }
        }
        return null;
    }""")
    assert winning_velocity is not None, "no deterministic winning Daily shot found"
    take_velocity_shot(page, winning_velocity)
    page.wait_for_function("window.__TRI_ECHO__.state().interactionLocked && window.__TRI_ECHO__.state().holeIndex === 1", timeout=25000)
    locked = page.evaluate("window.__TRI_ECHO__.state()")
    assert locked["strokes"] == 1 and locked["totalStrokes"] == 1
    assert locked["retryDisabled"] is True
    take_short_shot(page)
    page.locator("#retryBtn").evaluate("button => button.click()")
    blocked = page.evaluate("window.__TRI_ECHO__.state()")
    assert blocked["strokes"] == locked["strokes"]
    assert blocked["totalStrokes"] == locked["totalStrokes"]
    assert blocked["holeIndex"] == 1
    assert blocked["dragActive"] is False
    assert blocked["activeGameplayPointerId"] is None
    page.screenshot(path=str(OUT / "android-success-transition-locked.png"), full_page=True)
    page.wait_for_function("window.__TRI_ECHO__.state().holeIndex === 1 && window.__TRI_ECHO__.state().strokes === 0 && window.__TRI_ECHO__.state().canAcceptGameplayInput", timeout=5000)
    assert page.evaluate("window.__TRI_ECHO__.state().interactionLocked") is False
    take_short_shot(page)
    page.wait_for_function("window.__TRI_ECHO__.state().strokes === 1")
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
    assert still_locked["activeGameplayPointerId"] is None
    page.screenshot(path=str(OUT / "android-transition-locked.png"), full_page=True)
    page.wait_for_function("window.__TRI_ECHO__.state().canAcceptGameplayInput === true", timeout=5000)
    ready = page.evaluate("window.__TRI_ECHO__.state()")
    assert ready["interactionLocked"] is False
    assert ready["retryDisabled"] is False
    assert page.locator(".power:enabled").count() == 5
    ready_strokes = ready["strokes"]
    take_short_shot(page)
    page.wait_for_function(f"window.__TRI_ECHO__.state().strokes === {ready_strokes + 1}")
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
