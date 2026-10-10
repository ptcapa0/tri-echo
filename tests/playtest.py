from pathlib import Path
import os
import json
import sys
import shutil
import subprocess
import tempfile
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import quote
from playwright.sync_api import sync_playwright

ROOT = os.environ.get("PLAYTEST_ROOT", "http://127.0.0.1:8080").rstrip("/")
OUT = Path(os.environ.get("PLAYTEST_ARTIFACTS", "tests/artifacts"))
OUT.mkdir(exist_ok=True)


class _PR9Fixture:
    """Small same-origin production fixture; faults are seen by the worker."""
    def __init__(self, root):
        self.root = Path(root)
        self.fault = None
        self.inject_cache_put = False
        self.inject_cleanup = False
        self.requests = []
        fixture = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_): pass
            def do_GET(self):
                from urllib.parse import urlsplit, unquote
                path = unquote(urlsplit(self.path).path)
                prefix = '/other/' if path.startswith('/other/') else '/client/'
                if not path.startswith(prefix):
                    self.send_error(404); return
                relative = path[len(prefix):].lstrip('/') or 'index.html'
                fixture.requests.append({'path':relative,'fault':fixture.fault and fixture.fault.get('kind'),'destination':self.headers.get('Sec-Fetch-Dest')})
                if '..' in Path(relative).parts:
                    self.send_error(403); return
                fault = fixture.fault
                if fault and (fault['path'] == relative or fault['path'] == '*'):
                    kind = fault['kind']
                    if kind == '404': self.send_error(404); return
                    if kind == '500': self.send_error(500); return
                    if kind == 'redirect':
                        self.send_response(302); self.send_header('Location', '/client/index.html'); self.end_headers(); return
                    if kind == 'disconnect': self.connection.close(); return
                file = fixture.root / relative
                if not file.is_file():
                    # The deployment host's navigation fallback is deliberate;
                    # module/CSS/image requests remain ordinary 404s.
                    if self.headers.get('Accept', '').find('text/html') >= 0:
                        file = fixture.root / 'index.html'
                    else:
                        self.send_response(404); self.send_header('Content-Type', 'text/plain; charset=utf-8'); self.end_headers(); self.wfile.write(b'Not found'); return
                body = file.read_bytes()
                if fault and fault['path'] == relative and fault['kind'] == 'stale':
                    body = fault.get('body', (fixture.root / 'index.html').read_bytes())
                if relative == 'sw.js' and fixture.inject_cache_put:
                    body += b"\nCache.prototype.put=async()=>{throw new Error('PR9 injected cache.put failure')};\n"
                if relative == 'sw.js' and fixture.inject_cleanup:
                    body += b"\nconst nativeDelete=CacheStorage.prototype.delete;CacheStorage.prototype.delete=function(key){if(key.endsWith('-orphan'))throw new Error('test cleanup');return nativeDelete.call(this,key)};\n"
                types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'}
                media = 'text/plain; charset=utf-8' if fault and fault['path'] == relative and fault['kind'] == 'mime' else types.get(file.suffix, 'application/octet-stream')
                self.send_response(200); self.send_header('Content-Type', media); self.send_header('Cache-Control', 'no-cache'); self.end_headers(); self.wfile.write(body)
        self.http = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.url = f'http://127.0.0.1:{self.http.server_port}/client/'
    def close(self):
        self.http.shutdown(); self.thread.join(timeout=5); self.http.server_close()


def _pr9_build_fixture(repo, destination, legacy=False, variant=False):
    """Build exact git-main legacy and two PR9 releases in disposable trees."""
    destination = Path(destination)
    baseline = '897a45ca0ba1a9174c46baaf45c2d65c6f875233'
    if legacy:
        destination.mkdir()
        present = subprocess.run(['git', 'cat-file', '-e', f'{baseline}^{{commit}}'], cwd=repo).returncode == 0
        if not present:
            # CI shallow clones need the contract's immutable 4.7.1 object;
            # failing is safer than silently using whichever main is present.
            subprocess.run(['git', 'fetch', '--depth=1', 'origin', baseline], cwd=repo, check=True)
        archive = subprocess.run(['git', 'archive', baseline], cwd=repo, check=True, stdout=subprocess.PIPE).stdout
        subprocess.run(['tar', '-x', '-C', str(destination)], input=archive, check=True)
    else:
        shutil.copytree(repo, destination, ignore=shutil.ignore_patterns('.git', 'dist', 'node_modules', 'tests/artifacts', '__pycache__'))
    if variant:
        package = destination / 'package.json'
        data = json.loads(package.read_text()); data['version'] = '4.7.3-test'; package.write_text(json.dumps(data, indent=2) + '\n')
        with (destination / 'js' / 'app.js').open('a') as output: output.write('\n// PR9 fixture B release identity\n')
    environment = os.environ.copy()
    environment['GITHUB_SHA'] = baseline if legacy else subprocess.run(
        ['git', 'rev-parse', 'HEAD'], cwd=repo, check=True, stdout=subprocess.PIPE, text=True
    ).stdout.strip()
    subprocess.run(['npm', 'run', 'build'], cwd=destination, check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, env=environment)
    return destination / 'dist' / 'client'

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

def find_real_daily_win(page):
    return page.evaluate("""async () => {
        const state = window.__TRI_ECHO__.state();
        const {generateTable} = await import('./js/generator.js');
        const {Physics, STEP} = await import('./js/physics.js');
        const {calibrateShot} = await import('./js/physics-calibration.js');
        const seed = (state.seed + Math.imul(state.holeIndex + 1, 2654435761)) >>> 0;
        const table = generateTable(seed, 'normal', 0, 720, 1120, {
            tableStyle: 'echo', ballSet: 'three', traditional: false
        });
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


def _pr9_snapshot(page, label, errors):
    """Persist the service-worker facts which make an offline result auditable."""
    data = page.evaluate("""async () => {
        const registration = await navigator.serviceWorker.ready;
        const cachesForScope = (await caches.keys()).filter(key => key.startsWith('tri-echo-pr9-'));
        return {
            href: location.href,
            scope: registration.scope,
            controller: navigator.serviceWorker.controller?.scriptURL || null,
            worker: registration.active?.state || null,
            caches: cachesForScope,
        };
    }""")
    data["errors"] = errors
    (OUT / f"pr9-{label}.json").write_text(json.dumps(data, indent=2) + "\n")
    return data


def run_pr9_only(root=ROOT):
    """Focused PR9 acceptance against a built production server (including /client/).

    This intentionally uses a fresh browser context: it clears Chromium's HTTP
    cache through CDP while retaining Cache Storage, which is the regression
    protocol that exposed 4.7.1's missing-module fallback.
    """
    root = root.rstrip("/") + "/"
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(viewport={"width": 390, "height": 844}, service_workers="allow")
        page = context.new_page()
        errors = []
        responses=[]
        page.on("response",lambda r:responses.append({"url":r.url,"status":r.status,"media":r.headers.get("content-type"),"from_service_worker":r.from_service_worker}))
        page.on("console", lambda msg: errors.append(f"console: {msg.text}") if msg.type == "error" else None)
        page.on("pageerror", lambda error: errors.append(f"page: {error}"))
        page.goto(root, wait_until="networkidle")

        # A01: the initial network document is deliberately not claimed.  The
        # active worker becomes authoritative only on the controlled reload.
        assert page.evaluate("navigator.serviceWorker.controller === null")
        manifest = page.evaluate("async () => await (await fetch('./precache-manifest.json', {cache:'no-store'})).json()")
        assert manifest["schema"] == 1
        assert manifest["resources"] and manifest["releaseId"]
        ready = page.evaluate("""async () => {
            const registration = await navigator.serviceWorker.ready;
            return {scope: registration.scope, state: registration.active?.state};
        }""")
        assert ready["state"] == "activated"
        expected_cache = "tri-echo-pr9-" + quote(ready["scope"], safe="") + "-" + manifest["releaseId"]
        page.reload(wait_until="networkidle")
        page.wait_for_function("navigator.serviceWorker.controller !== null")

        # Verify that every descriptor byte and media category is present in
        # the release-local cache.  This is intentionally not caches.match(),
        # which could hide a cross-release cache selection defect.
        verified = page.evaluate("""async ({resources, scope, expectedCache}) => {
            const cache = await caches.open(expectedCache);
            const category = {
                html: /^text\\/html/i, css: /^text\\/css/i, javascript: /javascript/i,
                json: /json/i, svg: /image\\/svg\\+xml/i, png: /^image\\/png/i
            };
            const digest = async bytes => {
                const value = await crypto.subtle.digest('SHA-256', bytes);
                return [...new Uint8Array(value)].map(x => x.toString(16).padStart(2, '0')).join('');
            };
            const results = [];
            for (const resource of resources) {
                const response = await cache.match(new URL(resource.path, scope).href);
                results.push({path: resource.path, present: !!response,
                    media: response?.headers.get('content-type') || '',
                    digest: response && await digest(await response.arrayBuffer()),
                    expected: resource.sha256, category: resource.category,
                    mediaOK: response && category[resource.category]?.test(response.headers.get('content-type') || '')});
            }
            const marker = await cache.match(new URL('__tri_echo_complete__', scope).href);
            return {results, marker: !!marker, keys: await caches.keys()};
        }""", {"resources": manifest["resources"], "scope": ready["scope"], "expectedCache": expected_cache})
        assert verified["marker"], "complete marker missing"
        assert expected_cache in verified["keys"]
        assert all(item["present"] and item["digest"] == item["expected"] and item["mediaOK"] for item in verified["results"]), verified["results"]
        assert errors == [], errors
        _pr9_snapshot(page, "online", errors)

        # A05: unknown resources remain resource failures; navigation stays
        # app-shell fallback.  Query canonicalization is only allowed for a
        # known immutable descriptor resource.
        missing = page.evaluate("""async () => {
            const response = await fetch('./missing-pr9-module.js');
            return {status: response.status, media: response.headers.get('content-type')};
        }""")
        assert missing['status'] == 404 and 'html' not in (missing['media'] or '').lower()
        probe = context.new_page()
        navigation = probe.goto(f"{root}offline-route?from=pr9", wait_until='domcontentloaded')
        assert navigation.status == 200 and 'TRI//ECHO' in probe.content()
        probe.close()
        # Expected 404 diagnostics belong to this explicit policy probe.
        assert all("404" in message for message in errors), errors
        errors.clear()

        cdp = context.new_cdp_session(page)
        cdp.send("Network.enable")
        keys_before_clear=page.evaluate("caches.keys()")
        cdp.send("Network.clearBrowserCache")
        assert page.evaluate("caches.keys()") == keys_before_clear
        responses.clear()
        context.set_offline(True)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("typeof window.__TRI_ECHO__ === 'object' && document.querySelector('#menu').open")

        # A02/A03: prove application boot and real input execution offline,
        # including the traditional and Daily mode families.
        offline_modes = ("golf", "classic", "american", "british", "daily")
        results = []
        for mode in offline_modes:
            if mode != "golf":
                page.locator("#mode").select_option(mode)
            page.locator("#playBtn").click()
            before = page.evaluate("window.__TRI_ECHO__.state().strokes")
            take_short_shot(page)
            page.wait_for_function("before => window.__TRI_ECHO__.state().strokes > before", arg=before)
            page.wait_for_function("window.__TRI_ECHO__.state().active === false", timeout=25000)
            results.append({"mode": mode, "strokes": page.evaluate("window.__TRI_ECHO__.state().strokes")})
            page.locator("#homeBtn").click()
        assert all(result["strokes"] > 0 for result in results)
        _pr9_snapshot(page, "cold-offline", errors)
        page.screenshot(path=str(OUT / "pr9-cold-offline.png"), full_page=True)
        (OUT / "pr9-cold-offline-results.json").write_text(json.dumps({
            "root": root, "scope": ready["scope"], "releaseId": manifest["releaseId"],
            "version":manifest["version"], "commit":manifest["commit"], "browser_version":browser.version, "verified_resources":verified["results"], "http_cache_cleared":True, "cache_storage_retained":True,
            "cache": expected_cache, "modes": results, "errors": errors, "offline_responses":responses
        }, indent=2) + "\n")
        assert errors == [], errors
        context.set_offline(False)
        context.close()
        browser.close()


def run_pr9_fixture_matrix():
    """Production worker network/update tests, with immutable legacy and skew fixtures."""
    repo = Path(__file__).resolve().parents[1]
    with tempfile.TemporaryDirectory(prefix='tri-echo-pr9-') as temp:
        temp = Path(temp)
        legacy = _pr9_build_fixture(repo, temp / 'legacy', legacy=True)
        release_a = _pr9_build_fixture(repo, temp / 'release-a')
        release_b = _pr9_build_fixture(repo, temp / 'release-b', variant=True)
        fixture = _PR9Fixture(release_a)
        ma=json.loads((release_a/'precache-manifest.json').read_text())
        mb=json.loads((release_b/'precache-manifest.json').read_text())
        prefix='tri-echo-pr9-'+quote(fixture.url,safe='')+'-'
        ca,cb=prefix+ma['releaseId'],prefix+mb['releaseId']
        evidence={'server':fixture.url,'release_a':ma,'release_b':mb,'faults':[],'updates':[]}
        try:
            run_pr9_only(fixture.url)
            with sync_playwright() as p:
                browser=p.chromium.launch(headless=True)
                evidence['browser_version']=browser.version
                def controlled(context,url=None):
                    page=context.new_page();page.goto(url or fixture.url,wait_until='networkidle')
                    page.evaluate('navigator.serviceWorker.ready.then(()=>true)')
                    page.reload(wait_until='networkidle')
                    page.wait_for_function('navigator.serviceWorker.controller !== null')
                    return page
                def update(page):
                    # Attach before update(): fast failed installs must not
                    # disappear between the check and the assertion.
                    return page.evaluate("""async () => {
                        const r=await navigator.serviceWorker.getRegistration();
                        let timer;
                        const done=new Promise((resolve,reject)=>{
                            timer=setTimeout(()=>reject(Error('update transition timeout')),15000);
                            r.addEventListener('updatefound',()=>{
                                const w=r.installing;
                                const changed=()=>{if(['installed','redundant'].includes(w.state))resolve(w.state)};
                                w.addEventListener('statechange',changed);changed();
                            },{once:true});
                        });
                        try{await r.update();return await done}finally{clearTimeout(timer)}
                    }""")
                def identity(page):
                    return page.evaluate("async () => (await (await fetch('./precache-manifest.json')).json()).releaseId")
                def snapshot(page):
                    return page.evaluate("""() => {
                        const x=window.__TRI_ECHO__.state();return Object.fromEntries(
                        ['mode','seed','roundEpoch','ballState','ruleState','rails','inventory','score','strokes'].map(k=>[k,x[k]]));
                    }""")
                def activate(context,pages,expected):
                    # An origin page outside the scope can observe activation
                    # without keeping the old application worker in use.
                    observer=context.new_page();observer.goto(fixture.url.replace('/client/','/observer'),wait_until='domcontentloaded')
                    for page in pages:page.close()
                    observer.wait_for_function("""async scope => {
                        const r=await navigator.serviceWorker.getRegistration(scope);
                        return r?.active?.state==='activated' && !r.waiting && !r.installing;
                    }""",arg=fixture.url)
                    fresh=controlled(context);assert identity(fresh)==expected;observer.close();return fresh
                for kind in ['404','500','redirect','mime','stale','disconnect','put']:
                    fixture.root=release_a
                    context=browser.new_context(service_workers='allow');page=controlled(context)
                    before=page.evaluate('caches.keys()');assert ca in before
                    fixture.root=release_b;fixture.requests.clear()
                    fixture.inject_cache_put=kind=='put'
                    if kind!='put':fixture.fault={'path':'js/app.js','kind':kind,'body':(release_a/'js/app.js').read_bytes()}
                    state=update(page);assert state=='redundant',kind
                    assert identity(page)==ma['releaseId']
                    after=page.evaluate('caches.keys()');assert after==before and cb not in after,(kind,after)
                    if kind!='put':assert any(r['path']=='js/app.js' and r['fault']==kind for r in fixture.requests)
                    evidence['faults'].append({'kind':kind,'worker_state':state,'cache_unchanged':True,'requests':list(fixture.requests)})
                    fixture.fault=None;fixture.inject_cache_put=False;context.close()

                fixture.root=legacy
                context=browser.new_context(service_workers='allow');old=controlled(context)
                old.locator('#openSettings').click()
                old.locator('#importFile').set_input_files({'name':'legacy.json','mimeType':'application/json','buffer':b'{"stats":{"shots":42},"settings":{"sound":false}}'})
                old.wait_for_function("document.querySelector('#toast').textContent==='PROGRESSO IMPORTADO'")
                old.locator('#settings .close').click()
                old.locator('#playBtn').click();raw=old.evaluate("localStorage.getItem('triEchoSaveV1')");before=snapshot(old)
                peer=controlled(context);fixture.root=release_a
                assert update(old)=='installed'
                old.wait_for_function("async () => !!(await navigator.serviceWorker.getRegistration()).waiting")
                assert snapshot(old)==before and old.evaluate("localStorage.getItem('triEchoSaveV1')")==raw
                peer.reload(wait_until='networkidle')
                assert old.evaluate("async () => !!(await navigator.serviceWorker.getRegistration()).waiting")
                fresh=activate(context,[old,peer],ma['releaseId'])
                assert fresh.evaluate("localStorage.getItem('triEchoSaveV1')")==raw
                evidence['updates'].append({'legacy_to_a':ma['releaseId'],'raw_save_preserved':True})

                # PR8 still imports/exports through the updated controlled app.
                fresh.locator('#openSettings').click()
                fresh.locator('#importFile').set_input_files({'name':'pr9.json','mimeType':'application/json','buffer':b'{"stats":{"shots":9},"settings":{"sound":false}}'})
                fresh.wait_for_function("document.querySelector('#toast').textContent==='PROGRESSO IMPORTADO'")
                with fresh.expect_download() as dl:fresh.locator('#exportBtn').click()
                assert json.loads(Path(dl.value.path()).read_bytes())['stats']['shots']==9
                fresh.locator('#settings .close').click()

                # Browser policy probes complement the routing unit tests.
                policy=fresh.evaluate("""async () => {
                    const statuses=[];for(const path of ['missing.js','missing.css','missing.png','/outside.css'])statuses.push((await fetch(path)).status);
                    statuses.push((await fetch('./js/app.js',{method:'POST'})).status);return statuses;
                }""")
                assert policy==[404,404,404,404,501],policy
                fixture.root=release_b;fixture.fault={'path':'js/app.js','kind':'stale','body':(release_a/'js/app.js').read_bytes()}
                assert update(fresh)=='redundant';assert identity(fresh)==ma['releaseId']
                pinned=fresh.evaluate("""async()=>{const r=await fetch('./js/app.js?candidate=B');return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await r.arrayBuffer()))].map(x=>x.toString(16).padStart(2,'0')).join('')}""")
                assert pinned==next(r['sha256'] for r in ma['resources'] if r['path']=='js/app.js')
                caches_a=fresh.evaluate('caches.keys()')
                context.new_cdp_session(fresh).send('Network.clearBrowserCache');context.set_offline(True)
                survivor=context.new_page();survivor.goto(fixture.url,wait_until='networkidle')
                survivor.locator('#playBtn').click();take_short_shot(survivor)
                survivor.wait_for_function('window.__TRI_ECHO__.state().strokes>0 && !window.__TRI_ECHO__.state().active',timeout=25000)
                assert survivor.evaluate('caches.keys()')==caches_a
                survivor.close();context.set_offline(False);fixture.fault=None
                evidence['updates'].append({'failed_b_kept_a_offline':True})

                fresh.locator('#playBtn').click();before=snapshot(fresh)
                peer=controlled(context);peer.locator('#playBtn').click();peer.locator('#homeBtn').click()
                other=controlled(context,fixture.url.replace('/client/','/other/'))
                other_id=identity(other)
                unrelated='pr9-unrelated-origin-cache';orphan=prefix+'orphan'
                fresh.evaluate('async keys=>{for(const key of keys)await caches.open(key)}',[unrelated,orphan])
                fixture.inject_cleanup=True
                assert update(fresh)=='installed'
                assert snapshot(fresh)==before and identity(fresh)==ma['releaseId']
                peer.reload(wait_until='networkidle');assert identity(peer)==ma['releaseId']
                assert ca in peer.evaluate('caches.keys()')
                fresh.locator('#homeBtn').click();fresh.locator('#continueBtn').click();assert snapshot(fresh)==before
                bpage=activate(context,[fresh,peer],mb['releaseId'])
                keys=bpage.evaluate('caches.keys()');assert cb in keys and ca not in keys and unrelated in keys and orphan in keys
                assert identity(other)==other_id
                evidence['updates'].append({'a_to_b':mb['releaseId'],'active_round_preserved':True,'other_scope_survived':True,'cleanup_failure_contained':True})
                # Same-ID updated worker reuses complete bytes and retries cleanup.
                fixture.inject_cleanup=False
                assert update(bpage)=='installed'
                bpage=activate(context,[bpage],mb['releaseId'])
                assert orphan not in bpage.evaluate('caches.keys()') and unrelated in bpage.evaluate('caches.keys()')

                victim='js/app.js';expected=next(r['sha256'] for r in mb['resources'] if r['path']==victim)
                def corrupt():
                    bpage.evaluate("""async ({cache,path})=>{await (await caches.open(cache)).put(new URL(path,location.href),new Response('corrupt',{headers:{'content-type':'text/javascript'}}))}""",{'cache':cb,'path':victim})
                def probe():
                    return bpage.evaluate("""async path=>{try{const r=await fetch(path);const b=await r.arrayBuffer();return {hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join(''),status:r.status}}catch{return {failed:true}}}""",victim)
                corrupt();context.set_offline(True);assert probe()=={'failed':True};context.set_offline(False)
                fixture.fault={'path':victim,'kind':'stale','body':(release_a/victim).read_bytes()};assert probe()=={'failed':True};fixture.fault=None
                assert probe()['hash']==expected
                bpage.evaluate("async ({cache,path})=>await (await caches.open(cache)).delete(new URL(path,location.href))",{'cache':cb,'path':victim})
                assert probe()['hash']==expected
                evidence['repair']={'corrupt_offline_rejected':True,'stale_online_rejected':True,'matching_online_repaired':True,'missing_online_repaired':True}
                bpage.close();other.close();context.close();browser.close()
            evidence['verdict']='PASS A01-A11';print(evidence['verdict'],flush=True)
        finally:
            (OUT/'pr9-fixture-matrix.json').write_text(json.dumps(evidence,indent=2)+'\n');fixture.close()


if os.environ.get("PR9_ONLY") == "1":
    run_pr9_fixture_matrix()
    sys.exit(0)



with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    # PR7: the first session names TRI//ECHO's persistent-table premise before
    # play, then teaches it only in a Rail-capable mode.
    product_context = browser.new_context(viewport={"width": 390, "height": 844})
    product_page = product_context.new_page()
    product_page.goto(ROOT, wait_until="networkidle")
    assert "EMBOCA. RECONFIGURA. A MESA LEMBRA-SE." in " ".join(product_page.locator("#menu").inner_text().split())
    assert "Rails temporários" in product_page.locator(".product-premise").inner_text()
    product_page.locator("#playBtn").click()
    take_short_shot(product_page)
    product_page.wait_for_function("document.querySelector('#coachTitle').textContent === 'A MESA LEMBRA-SE'")
    assert "Echo Rails" in product_page.locator("#coachText").inner_text()
    product_page.screenshot(path=str(OUT / "pr7-first-session-memory-coach.png"), full_page=True)
    product_page.close()
    product_context.close()

    # Creation and inheritance are distinct UI moments, both driven by a real
    # Daily physics shot followed by the production completeHole/newHole path.
    memory_context = browser.new_context(viewport={"width": 412, "height": 915})
    memory_page = memory_context.new_page()
    memory_page.goto(ROOT, wait_until="networkidle")
    memory_page.locator("#mode").select_option("daily")
    memory_page.locator("#playBtn").click()
    memory_page.evaluate("""() => {
        window.__pr7EchoTitles = [];
        new MutationObserver(() => {
            const title = document.querySelector('#echoMemoryTitle').textContent;
            if (title) window.__pr7EchoTitles.push(title);
        }).observe(document.querySelector('#echoMemoryTitle'), {childList: true, characterData: true, subtree: true});
    }""")
    winning_velocity = find_real_daily_win(memory_page)
    assert winning_velocity is not None, "no deterministic winning Daily shot found"
    take_velocity_shot(memory_page, winning_velocity, 301)
    memory_page.wait_for_function("window.__TRI_ECHO__.state().echoMemory.kind === 'created'", timeout=25000)
    assert memory_page.evaluate("window.__TRI_ECHO__.state().echoMemory.highlightedRails") == 1
    memory_page.wait_for_timeout(210)
    memory_page.screenshot(path=str(OUT / "pr71-created-rail.png"), full_page=True)
    memory_page.wait_for_function("window.__TRI_ECHO__.state().holeIndex === 1 && window.__TRI_ECHO__.state().rails > 0 && document.querySelector('#echoMemoryTitle').textContent === 'ECHO DA MESA ANTERIOR'", timeout=25000)
    memory_titles = memory_page.evaluate("window.__pr7EchoTitles")
    assert "A TUA TACADA CRIOU UM ECHO RAIL" in memory_titles
    assert "ECHO DA MESA ANTERIOR" in memory_titles
    assert "A tua linha passou para esta mesa" in memory_page.locator("#echoMemoryText").inner_text()
    memory_page.screenshot(path=str(OUT / "pr7-inherited-rail.png"), full_page=True)
    inherited = memory_page.evaluate("window.__TRI_ECHO__.state()")
    assert inherited["echoMemory"]["kind"] == "inherited"
    assert inherited["echoMemory"]["highlightedRails"] == inherited["rails"]
    assert inherited["canAcceptGameplayInput"] is True
    assert memory_page.locator("#echoMemory").evaluate("e => getComputedStyle(e).pointerEvents") == "none"
    begin_floating_pull(memory_page, 303)
    assert memory_page.evaluate("window.__TRI_ECHO__.state().dragActive") is True
    memory_page.dispatch_event("#game", "pointercancel", {"pointerId": 303})
    memory_page.locator("#retryBtn").click()
    assert memory_page.evaluate("window.__TRI_ECHO__.state().echoMemory.kind") is None
    memory_page.wait_for_timeout(2300)
    assert memory_page.evaluate("window.__TRI_ECHO__.state().echoMemory.highlightedRails") == 0
    memory_page.close()
    memory_context.close()

    # Negative product states stay truthful: neither an unqualified Echo shot
    # nor a traditional carom can claim a persistent Rail.
    negative_context = browser.new_context(viewport={"width": 1024, "height": 800})
    negative_page = negative_context.new_page()
    negative_page.goto(f"{ROOT}?triEchoTest=1", wait_until="networkidle")
    negatives = negative_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__;
        api.startFixture({mode: 'golf'});
        const noRail = api.resolveShot({});
        const failedCreation = api.resolveShot({pocketedIds: [1]});
        const failedCreationCue = document.querySelector('#echoMemory').classList.contains('show');
        const noRailCue = document.querySelector('#echoMemory').classList.contains('show');
        const classic = api.startFixture({mode: 'classic'});
        api.resolveShot({contacts: classic.ballState.slice(1).map(ball => ball.id)});
        return {noRail, noRailCue, failedCreation, failedCreationCue, traditionalCue: document.querySelector('#echoMemory').classList.contains('show')};
    }""")
    assert negatives["noRail"]["rails"] == 0 and negatives["noRailCue"] is False
    assert negatives["traditionalCue"] is False
    assert negatives["failedCreation"]["rails"] == 0 and negatives["failedCreationCue"] is False
    negative_page.close()
    negative_context.close()

    # Reduced motion keeps the inherited-Rail state textual and visible without
    # relying on the cue transition.
    reduced_context = browser.new_context(viewport={"width": 430, "height": 932})
    reduced_page = reduced_context.new_page()
    reduced_page.goto(ROOT, wait_until="networkidle")
    reduced_page.locator("#openSettings").click()
    reduced_page.locator("#reduced").check()
    reduced_page.locator("#settings .close").click()
    reduced_page.locator("#mode").select_option("daily")
    reduced_page.locator("#playBtn").click()
    reduced_velocity = find_real_daily_win(reduced_page)
    assert reduced_velocity is not None, "no deterministic reduced-motion Daily shot found"
    take_velocity_shot(reduced_page, reduced_velocity, 302)
    reduced_page.wait_for_function("window.__TRI_ECHO__.state().holeIndex === 1 && document.querySelector('#echoMemoryTitle').textContent === 'ECHO DA MESA ANTERIOR'", timeout=25000)
    assert "A tua linha passou para esta mesa" in reduced_page.locator("#echoMemoryText").inner_text()
    assert reduced_page.locator("#echoMemory").evaluate("element => element.classList.contains('reduced')") is True
    assert reduced_page.locator("#echoMemory").evaluate("element => getComputedStyle(element).transitionDuration") == "0s"
    reduced_page.screenshot(path=str(OUT / "pr7-reduced-motion-inherited-rail.png"), full_page=True)
    reduced_page.close()
    reduced_context.close()

    # The deterministic seam is absent from an ordinary local launch, and is
    # available only after the explicit local test opt-in.  Its resolution
    # path below uses the live Game instance rather than a copied rules model.
    seam_page = browser.new_page(viewport={"width": 1024, "height": 800})
    seam_page.goto(ROOT, wait_until="networkidle")
    assert seam_page.evaluate("window.__TRI_ECHO_TEST__ === undefined")
    seam_page.goto(f"{ROOT}?triEchoTest=1", wait_until="networkidle")
    assert seam_page.evaluate("typeof window.__TRI_ECHO_TEST__ === 'object'")
    seam_state = seam_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__;
        const started = api.startFixture({mode: 'american'});
        const solid = started.ballState.find((ball, index) => started.roles[index] === 'solid');
        return api.resolveShot({pocketedIds: [solid.id], contacts: [solid.id], firstCollision: solid.id});
    }""")
    assert seam_state["ruleState"]["group"] == "solid"
    assert seam_state["score"] == 1
    rewind_state = seam_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__;
        const started = api.startFixture({mode: 'classic'});
        api.configureFixture({activePower: 'rewind', inventory: {...started.inventory, rewind: 1}, strokes: 1, totalStrokes: 1});
        api.captureFixturePreShot();
        return api.resolveShot({pocketedIds: [1], contacts: [1], firstCollision: 1});
    }""")
    assert rewind_state["strokes"] == 0 and rewind_state["totalStrokes"] == 0
    assert rewind_state["inventory"]["rewind"] == 0 and rewind_state["activePower"] is None
    assert all(not ball["pocketed"] for ball in rewind_state["ballState"])
    persistent = seam_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__, started = api.startFixture({mode: 'american'});
        const solids = started.ballState.filter((ball, index) => started.roles[index] === 'solid');
        const eight = started.ballState.find((ball, index) => started.roles[index] === 'eight');
        api.configureFixture({ruleState: {group: 'solid', phase: 'open'}});
        api.seedPocketedObjectBalls(solids.map(ball => ball.id));
        return {state: api.resolveShot({pocketedIds: [eight.id], contacts: [eight.id], firstCollision: eight.id}), eightId: eight.id, solidIds: solids.map(ball => ball.id)};
    }""")
    persistent_state = persistent["state"]
    assert persistent_state["pocketed"] == [persistent["eightId"]]
    assert all(next(ball["pocketed"] for ball in persistent_state["ballState"] if ball["id"] == ball_id) for ball_id in persistent["solidIds"] + [persistent["eightId"]])
    errors = seam_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__, failures = [];
        for (const value of [0, [999], 'bad']) try { api.seedPocketedObjectBalls(value); } catch { failures.push(true); }
        return failures.length;
    }""")
    assert errors == 3
    seam_page.close()

    # PR6.0 Checkpoint A: freeze the observable American branch of the live
    # cue-sport resolver.  Each fixture is a fresh real Game; roles are read
    # from the generated table rather than recreated in this test.
    american_page = browser.new_page(viewport={"width": 1024, "height": 800})
    american_page.goto(f"{ROOT}?triEchoTest=1", wait_until="networkidle")
    american = american_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__;
        const role = (state, name) => state.ballState.find((ball, index) => state.roles[index] === name);
        const scenarios = {};

        let state = api.startFixture({mode: 'american'});
        let solid = role(state, 'solid');
        scenarios.openSolid = api.resolveShot({pocketedIds: [solid.id], contacts: [solid.id], firstCollision: solid.id});

        state = api.startFixture({mode: 'american'});
        let openStripe = role(state, 'stripe');
        scenarios.openStripe = api.resolveShot({pocketedIds: [openStripe.id], contacts: [openStripe.id], firstCollision: openStripe.id});

        state = api.startFixture({mode: 'american'});
        const stripe = role(state, 'stripe');
        scenarios.openNoPot = api.resolveShot({contacts: [stripe.id], firstCollision: stripe.id});

        state = api.startFixture({mode: 'american'});
        solid = role(state, 'solid');
        api.configureFixture({ruleState: {group: 'solid', phase: 'open'}});
        scenarios.legalOwn = api.resolveShot({pocketedIds: [solid.id], contacts: [solid.id], firstCollision: solid.id});

        state = api.startFixture({mode: 'american'});
        solid = role(state, 'solid');
        const mixedStripe = role(state, 'stripe');
        api.configureFixture({ruleState: {group: 'solid', phase: 'open'}});
        scenarios.mixedPot = api.resolveShot({pocketedIds: [solid.id, mixedStripe.id], contacts: [solid.id], firstCollision: solid.id});
        scenarios.mixedSolidId = solid.id;
        scenarios.mixedStripeId = mixedStripe.id;

        state = api.startFixture({mode: 'american'});
        solid = role(state, 'solid');
        const wrongFirst = role(state, 'stripe');
        api.configureFixture({ruleState: {group: 'solid', phase: 'open'}});
        scenarios.illegalFirstOwnPot = api.resolveShot({pocketedIds: [solid.id], contacts: [wrongFirst.id], firstCollision: wrongFirst.id});

        state = api.startFixture({mode: 'american'});
        const opponent = role(state, 'stripe');
        api.configureFixture({ruleState: {group: 'solid', phase: 'open'}});
        scenarios.opponentPot = api.resolveShot({pocketedIds: [opponent.id], contacts: [opponent.id], firstCollision: opponent.id});
        scenarios.opponentId = opponent.id;

        state = api.startFixture({mode: 'american'});
        scenarios.scratch = api.resolveShot({pocketedIds: [state.ballState[0].id], contacts: [], firstCollision: null});

        state = api.startFixture({mode: 'american'});
        api.configureFixture({ruleState: {group: 'solid', phase: 'open'}});
        scenarios.noFirstContact = api.resolveShot({});

        state = api.startFixture({mode: 'american'});
        const eight = role(state, 'eight');
        api.configureFixture({ruleState: {group: 'solid', phase: 'open'}});
        scenarios.prematureEight = api.resolveShot({pocketedIds: [eight.id], contacts: [eight.id], firstCollision: eight.id});
        scenarios.eightId = eight.id;

        state = api.startFixture({mode: 'american'});
        const solids = state.ballState.filter((ball, index) => state.roles[index] === 'solid');
        const clearedEight = role(state, 'eight');
        api.configureFixture({ruleState: {group: 'solid', phase: 'open'}});
        api.seedPocketedObjectBalls(solids.map(ball => ball.id));
        scenarios.clearedEight = api.resolveShot({pocketedIds: [clearedEight.id], contacts: [clearedEight.id], firstCollision: clearedEight.id});
        scenarios.clearedSolidIds = solids.map(ball => ball.id);
        scenarios.clearedEightId = clearedEight.id;
        return scenarios;
    }""")
    assert american["openSolid"]["ruleState"]["group"] == "solid"
    assert american["openSolid"]["score"] == 1
    assert american["openStripe"]["ruleState"]["group"] == "stripe"
    assert american["openStripe"]["score"] == 1
    assert american["openNoPot"]["ruleState"]["group"] is None
    assert american["openNoPot"]["score"] == 0
    assert american["legalOwn"]["score"] == 1
    assert american["mixedPot"]["score"] == 1
    assert next(ball["pocketed"] for ball in american["mixedPot"]["ballState"] if ball["id"] == american["mixedSolidId"])
    assert not next(ball["pocketed"] for ball in american["mixedPot"]["ballState"] if ball["id"] == american["mixedStripeId"])
    # Current behavior deliberately retains the own-ball point even when the
    # first contact was illegal.  This is a characterization, not a fix.
    assert american["illegalFirstOwnPot"]["score"] == 1
    assert american["opponentPot"]["score"] == 0
    assert not next(ball["pocketed"] for ball in american["opponentPot"]["ballState"] if ball["id"] == american["opponentId"])
    assert american["scratch"]["score"] == 0
    assert not american["scratch"]["ballState"][0]["pocketed"]
    assert american["noFirstContact"]["score"] == 0
    assert american["prematureEight"]["score"] == 0
    assert not next(ball["pocketed"] for ball in american["prematureEight"]["ballState"] if ball["id"] == american["eightId"])
    assert american["clearedEight"]["score"] == 8
    assert american["clearedEight"]["pocketed"] == [american["clearedEightId"]]
    assert american["clearedEight"]["interactionLocked"] is True
    assert all(next(ball["pocketed"] for ball in american["clearedEight"]["ballState"] if ball["id"] == ball_id) for ball_id in american["clearedSolidIds"] + [american["clearedEightId"]])
    american_page.close()

    # PR6.0 Checkpoint A: characterize the live British/Snooker state
    # machine, including its persistent late-frame fixture preconditions.
    snooker_page = browser.new_page(viewport={"width": 1024, "height": 800})
    snooker_page.goto(f"{ROOT}?triEchoTest=1", wait_until="networkidle")
    snooker = snooker_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__;
        const role = (state, name) => state.ballState.find((ball, index) => state.roles[index] === name);
        const scenarios = {};

        let state = api.startFixture({mode: 'british'});
        let red = role(state, 'red');
        scenarios.redPot = api.resolveShot({pocketedIds: [red.id], contacts: [red.id], firstCollision: red.id});

        state = api.startFixture({mode: 'british'});
        const twoReds = state.ballState.filter((ball, index) => state.roles[index] === 'red').slice(0, 2);
        scenarios.multipleReds = api.resolveShot({pocketedIds: twoReds.map(ball => ball.id), contacts: [twoReds[0].id], firstCollision: twoReds[0].id});

        state = api.startFixture({mode: 'british'});
        let black = role(state, 'black');
        scenarios.redWrongContact = api.resolveShot({contacts: [black.id], firstCollision: black.id});

        state = api.startFixture({mode: 'british'});
        scenarios.redScratch = api.resolveShot({pocketedIds: [state.ballState[0].id]});

        state = api.startFixture({mode: 'british'});
        black = role(state, 'black');
        scenarios.redColourPot = api.resolveShot({pocketedIds: [black.id], contacts: [black.id], firstCollision: black.id});
        scenarios.blackId = black.id;

        state = api.startFixture({mode: 'british'});
        black = role(state, 'black');
        api.configureFixture({ruleState: {phase: 'color', colourIndex: 0}});
        scenarios.colourPot = api.resolveShot({pocketedIds: [black.id], contacts: [black.id], firstCollision: black.id});
        scenarios.colourBlackId = black.id;

        state = api.startFixture({mode: 'british'});
        red = role(state, 'red');
        api.configureFixture({ruleState: {phase: 'color', colourIndex: 0}});
        scenarios.colourRedPot = api.resolveShot({pocketedIds: [red.id], contacts: [red.id], firstCollision: red.id});
        scenarios.colourRedId = red.id;

        state = api.startFixture({mode: 'british'});
        const reds = state.ballState.filter((ball, index) => state.roles[index] === 'red');
        const finalRed = reds.at(-1);
        black = role(state, 'black');
        api.seedPocketedObjectBalls(reds.slice(0, -1).map(ball => ball.id));
        scenarios.finalRed = api.resolveShot({pocketedIds: [finalRed.id], contacts: [finalRed.id], firstCollision: finalRed.id});
        scenarios.finalRedState = api.resolveShot({pocketedIds: [black.id], contacts: [black.id], firstCollision: black.id});
        scenarios.finalRedId = finalRed.id;
        scenarios.finalBlackId = black.id;

        state = api.startFixture({mode: 'british'});
        const allReds = state.ballState.filter((ball, index) => state.roles[index] === 'red');
        black = role(state, 'black');
        api.seedPocketedObjectBalls(allReds.map(ball => ball.id));
        api.configureFixture({ruleState: {phase: 'color', colourIndex: 0}});
        scenarios.noRedsTransition = api.resolveShot({pocketedIds: [black.id], contacts: [black.id], firstCollision: black.id});

        state = api.startFixture({mode: 'british'});
        const orderedReds = state.ballState.filter((ball, index) => state.roles[index] === 'red');
        const yellow = role(state, 'yellow');
        api.seedPocketedObjectBalls(orderedReds.map(ball => ball.id));
        api.configureFixture({ruleState: {phase: 'colours', colourIndex: 0}});
        scenarios.orderedYellow = api.resolveShot({pocketedIds: [yellow.id], contacts: [yellow.id], firstCollision: yellow.id});
        scenarios.yellowId = yellow.id;

        state = api.startFixture({mode: 'british'});
        const sequenceReds = state.ballState.filter((ball, index) => state.roles[index] === 'red');
        const sequenceRoles = ['yellow', 'green', 'brown', 'blue', 'pink', 'black'];
        const sequenceBalls = sequenceRoles.map(name => role(state, name));
        api.seedPocketedObjectBalls(sequenceReds.map(ball => ball.id));
        api.configureFixture({ruleState: {phase: 'colours', colourIndex: 0}});
        scenarios.orderedSequence = sequenceBalls.map(ball => api.resolveShot({pocketedIds: [ball.id], contacts: [ball.id], firstCollision: ball.id}));

        state = api.startFixture({mode: 'british'});
        const wrongReds = state.ballState.filter((ball, index) => state.roles[index] === 'red');
        const green = role(state, 'green');
        api.seedPocketedObjectBalls(wrongReds.map(ball => ball.id));
        api.configureFixture({ruleState: {phase: 'colours', colourIndex: 0}});
        scenarios.orderedWrongContact = api.resolveShot({contacts: [green.id], firstCollision: green.id});
        scenarios.orderedWrongPot = api.resolveShot({pocketedIds: [green.id], contacts: [yellow.id], firstCollision: yellow.id});
        scenarios.greenId = green.id;

        state = api.startFixture({mode: 'british'});
        const finalBlack = role(state, 'black');
        api.seedPocketedObjectBalls(state.ballState.slice(1).filter(ball => ball.id !== finalBlack.id).map(ball => ball.id));
        api.configureFixture({ruleState: {phase: 'colours', colourIndex: 5}});
        scenarios.frame = api.resolveShot({pocketedIds: [finalBlack.id], contacts: [finalBlack.id], firstCollision: finalBlack.id});
        scenarios.finalFrameBlackId = finalBlack.id;
        return scenarios;
    }""")
    assert snooker["redPot"]["score"] == 1
    assert snooker["redPot"]["ruleState"]["phase"] == "color"
    assert snooker["multipleReds"]["score"] == 2
    assert snooker["multipleReds"]["ruleState"]["phase"] == "color"
    assert snooker["redWrongContact"]["score"] == 0
    assert snooker["redWrongContact"]["ruleState"]["phase"] == "red"
    assert snooker["redScratch"]["score"] == 0
    assert snooker["redScratch"]["ruleState"]["phase"] == "red"
    assert not snooker["redScratch"]["ballState"][0]["pocketed"]
    assert snooker["redColourPot"]["score"] == 0
    assert not next(ball["pocketed"] for ball in snooker["redColourPot"]["ballState"] if ball["id"] == snooker["blackId"])
    assert snooker["colourPot"]["score"] == 7
    assert snooker["colourPot"]["ruleState"] == {"phase": "red", "colourIndex": 0}
    assert not next(ball["pocketed"] for ball in snooker["colourPot"]["ballState"] if ball["id"] == snooker["colourBlackId"])
    assert snooker["colourRedPot"]["score"] == 0
    assert next(ball["pocketed"] for ball in snooker["colourRedPot"]["ballState"] if ball["id"] == snooker["colourRedId"])
    assert snooker["finalRed"]["ruleState"]["phase"] == "color"
    assert snooker["finalRedState"]["ruleState"] == {"phase": "colours", "colourIndex": 0}
    assert snooker["finalRedState"]["pocketed"] == [snooker["finalBlackId"]]
    assert next(ball["pocketed"] for ball in snooker["finalRedState"]["ballState"] if ball["id"] == snooker["finalRedId"])
    assert not next(ball["pocketed"] for ball in snooker["finalRedState"]["ballState"] if ball["id"] == snooker["finalBlackId"])
    assert snooker["noRedsTransition"]["ruleState"] == {"phase": "colours", "colourIndex": 0}
    assert snooker["orderedYellow"]["score"] == 2
    assert snooker["orderedYellow"]["ruleState"] == {"phase": "colours", "colourIndex": 1}
    assert snooker["orderedYellow"]["pocketed"] == [snooker["yellowId"]]
    assert [state["score"] for state in snooker["orderedSequence"]] == [2, 5, 9, 14, 20, 27]
    assert [state["ruleState"]["colourIndex"] for state in snooker["orderedSequence"]] == [1, 2, 3, 4, 5, 6]
    assert next(ball["pocketed"] for ball in snooker["orderedYellow"]["ballState"] if ball["id"] == snooker["yellowId"])
    assert snooker["orderedWrongContact"]["score"] == 0
    assert snooker["orderedWrongContact"]["ruleState"] == {"phase": "colours", "colourIndex": 0}
    assert snooker["orderedWrongPot"]["score"] == 0
    assert not next(ball["pocketed"] for ball in snooker["orderedWrongPot"]["ballState"] if ball["id"] == snooker["greenId"])
    assert snooker["frame"]["score"] == 7
    assert snooker["frame"]["interactionLocked"] is True
    assert next(ball["pocketed"] for ball in snooker["frame"]["ballState"] if ball["id"] == snooker["finalFrameBlackId"])
    snooker_page.wait_for_function("""() => {
        const state = window.__TRI_ECHO_TEST__.state();
        return !state.interactionLocked && state.ruleState.phase === 'red' && state.ballState.slice(1).every(ball => !ball.pocketed);
    }""", timeout=5000)
    assert snooker_page.evaluate("window.__TRI_ECHO_TEST__.state().score") == 7
    snooker_page.close()

    # PR6.0 Checkpoint B: classic outcomes reach finishClassic through the
    # live resolver.  Contact facts are production shot facts, not a second
    # carom implementation.
    classic_page = browser.new_page(viewport={"width": 1024, "height": 800})
    classic_page.goto(f"{ROOT}?triEchoTest=1", wait_until="networkidle")
    classic = classic_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__, cases = {};
        let state = api.startFixture({mode: 'classic'});
        cases.success = api.resolveShot({contacts: state.ballState.slice(1).map(ball => ball.id)});
        return cases;
    }""")
    assert classic["success"]["score"] == 1
    assert classic["success"]["holeIndex"] == 1 and classic["success"]["interactionLocked"] is True
    classic_page.wait_for_function("window.__TRI_ECHO_TEST__.state().holeIndex === 1 && !window.__TRI_ECHO_TEST__.state().interactionLocked", timeout=5000)
    assert classic_page.locator("#streak").text_content() == "1"
    classic_repeat = classic_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__, state = api.state();
        return api.resolveShot({contacts: state.ballState.slice(1).map(ball => ball.id)});
    }""")
    assert classic_repeat["score"] == 2 and classic_repeat["holeIndex"] == 2
    classic_page.wait_for_function("window.__TRI_ECHO_TEST__.state().holeIndex === 2 && !window.__TRI_ECHO_TEST__.state().interactionLocked", timeout=5000)
    assert classic_page.locator("#streak").text_content() == "2"
    classic_page.close()

    classic_failures_page = browser.new_page(viewport={"width": 1024, "height": 800})
    classic_failures_page.goto(f"{ROOT}?triEchoTest=1", wait_until="networkidle")
    classic_failures = classic_failures_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__, cases = {};
        let state = api.startFixture({mode: 'classic'});
        cases.miss = api.resolveShot({contacts: [state.ballState[1].id]});
        state = api.startFixture({mode: 'classic'});
        cases.scratch = api.resolveShot({pocketedIds: [state.ballState[0].id], contacts: state.ballState.slice(1).map(ball => ball.id)});
        return cases;
    }""")
    assert classic_failures["miss"]["score"] == 0
    assert classic_failures["scratch"]["score"] == 0
    classic_failures_page.close()

    # Hybrid uses its real carom-to-pocket transition before the phase-two
    # completion case.  Direct phase fixtures cover resolver-only failures.
    hybrid_page = browser.new_page(viewport={"width": 1024, "height": 800})
    hybrid_page.goto(f"{ROOT}?triEchoTest=1", wait_until="networkidle")
    hybrid = hybrid_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__, cases = {};
        let state = api.startFixture({mode: 'hybrid'});
        cases.initial = state;
        cases.caromSuccess = api.resolveShot({contacts: state.ballState.slice(1).map(ball => ball.id)});

        state = api.startFixture({mode: 'hybrid'});
        cases.caromMiss = api.resolveShot({contacts: [state.ballState[1].id]});
        state = api.startFixture({mode: 'hybrid'});
        cases.caromScratch = api.resolveShot({pocketedIds: [state.ballState[0].id], contacts: state.ballState.slice(1).map(ball => ball.id)});

        state = api.startFixture({mode: 'hybrid'});
        const transitioned = api.resolveShot({contacts: state.ballState.slice(1).map(ball => ball.id)});
        api.configureFixture({totalStrokes: 5});
        cases.pocketSuccess = api.resolveShot({pocketedIds: [transitioned.ballState[1].id], contacts: [transitioned.ballState[1].id], firstCollision: transitioned.ballState[1].id});

        state = api.startFixture({mode: 'hybrid'});
        api.configureFixture({hybridPhase: 'pocket'});
        cases.pocketMiss = api.resolveShot({});
        state = api.startFixture({mode: 'hybrid'});
        api.configureFixture({hybridPhase: 'pocket'});
        cases.pocketScratch = api.resolveShot({pocketedIds: [state.ballState[0].id]});

        state = api.startFixture({mode: 'hybrid'});
        api.configureFixture({score: 7, streak: 2, ruleState: {phase: 'open', marker: 'fixture'}});
        cases.preserved = api.resolveShot({contacts: state.ballState.slice(1).map(ball => ball.id)});
        return cases;
    }""")
    assert hybrid["initial"]["hybridPhase"] == "carom" and hybrid["initial"]["hole"]["disabled"] is True
    assert hybrid["caromSuccess"]["hybridPhase"] == "pocket"
    assert hybrid["caromSuccess"]["hole"]["disabled"] is False
    assert hybrid["caromMiss"]["hybridPhase"] == "carom" and hybrid["caromMiss"]["score"] == 0
    assert hybrid["caromScratch"]["hybridPhase"] == "carom" and hybrid["caromScratch"]["score"] == 0
    assert hybrid["pocketSuccess"]["holeIndex"] == 1
    assert hybrid["pocketSuccess"]["score"] == 5 - hybrid["pocketSuccess"]["par"]
    assert hybrid["pocketMiss"]["hybridPhase"] == "pocket" and hybrid["pocketMiss"]["score"] == 0
    assert hybrid["pocketScratch"]["hybridPhase"] == "pocket" and hybrid["pocketScratch"]["score"] == 0
    assert hybrid["preserved"]["hybridPhase"] == "pocket" and hybrid["preserved"]["score"] == 7
    assert hybrid["preserved"]["ruleState"] == {"phase": "open", "marker": "fixture"}
    hybrid_page.close()

    # Training uses finishTraining only for Golf and Classic; the cue-sport
    # disciplines deliberately dispatch to the American/British resolvers.
    training_page = browser.new_page(viewport={"width": 1024, "height": 800})
    training_page.goto(f"{ROOT}?triEchoTest=1", wait_until="networkidle")
    training = training_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__, cases = {};
        let state = api.startFixture({mode: 'training', trainingDiscipline: 'golf'});
        const golfObject = state.ballState[1];
        cases.golfSuccess = api.resolveShot({pocketedIds: [golfObject.id], contacts: [golfObject.id], firstCollision: golfObject.id});
        state = api.startFixture({mode: 'training', trainingDiscipline: 'golf'});
        cases.golfMiss = api.resolveShot({});
        state = api.startFixture({mode: 'training', trainingDiscipline: 'golf'});
        cases.golfScratch = api.resolveShot({pocketedIds: [state.ballState[0].id]});

        state = api.startFixture({mode: 'training', trainingDiscipline: 'classic'});
        cases.classicSuccess = api.resolveShot({contacts: state.ballState.slice(1).map(ball => ball.id)});
        state = api.startFixture({mode: 'training', trainingDiscipline: 'classic'});
        cases.classicMiss = api.resolveShot({contacts: [state.ballState[1].id]});
        state = api.startFixture({mode: 'training', trainingDiscipline: 'classic'});
        cases.classicScratch = api.resolveShot({pocketedIds: [state.ballState[0].id], contacts: state.ballState.slice(1).map(ball => ball.id)});

        state = api.startFixture({mode: 'training', trainingDiscipline: 'american'});
        const solid = state.ballState.find((ball, index) => state.roles[index] === 'solid');
        cases.american = api.resolveShot({pocketedIds: [solid.id], contacts: [solid.id], firstCollision: solid.id});
        state = api.startFixture({mode: 'training', trainingDiscipline: 'snooker'});
        const red = state.ballState.find((ball, index) => state.roles[index] === 'red');
        cases.snooker = api.resolveShot({pocketedIds: [red.id], contacts: [red.id], firstCollision: red.id});
        return cases;
    }""")
    assert training["golfSuccess"]["mode"] == "training" and training["golfSuccess"]["score"] == 1
    assert not training["golfSuccess"]["ballState"][1]["pocketed"]
    assert training["golfMiss"]["score"] == 0 and training["golfScratch"]["score"] == 0
    assert not training["golfScratch"]["ballState"][0]["pocketed"]
    assert training["classicSuccess"]["score"] == 1
    assert training["classicMiss"]["score"] == 0 and training["classicScratch"]["score"] == 0
    assert training["american"]["mode"] == "training" and training["american"]["ruleState"]["group"] == "solid" and training["american"]["score"] == 1
    assert training["snooker"]["mode"] == "training" and training["snooker"]["ruleState"]["phase"] == "color" and training["snooker"]["score"] == 1
    training_page.close()

    training_continuation_page = browser.new_page(viewport={"width": 1024, "height": 800})
    training_continuation_page.goto(f"{ROOT}?triEchoTest=1", wait_until="networkidle")
    training_continuation = training_continuation_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__, state = api.startFixture({mode: 'training', trainingDiscipline: 'golf'}), object = state.ballState[1];
        return api.resolveShot({pocketedIds: [object.id], contacts: [object.id], firstCollision: object.id});
    }""")
    assert training_continuation["interactionLocked"] is True and training_continuation["score"] == 1
    training_continuation_page.wait_for_function("window.__TRI_ECHO_TEST__.state().canAcceptGameplayInput", timeout=5000)
    resumed_training = training_continuation_page.evaluate("window.__TRI_ECHO_TEST__.state()")
    assert resumed_training["mode"] == "training" and resumed_training["score"] == 1
    assert not resumed_training["ballState"][1]["pocketed"]
    training_continuation_page.close()

    # The pure requirement boundaries live in core.test.js; these two cases
    # freeze the distinct real Game.finishTrick lifecycle.
    trick_page = browser.new_page(viewport={"width": 1024, "height": 800})
    trick_page.goto(f"{ROOT}?triEchoTest=1", wait_until="networkidle")
    trick = trick_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__, cases = {};
        let state = api.startFixture({mode: 'trick'});
        api.configureFixture({strokes: 3, score: 7});
        cases.success = api.resolveShot({pocketedIds: [state.ballState[1].id], contacts: state.ballState.slice(1).map(ball => ball.id), firstCollision: state.ballState[1].id, objectCushions: 1, cueCushionsBeforeContact: 1, objectContacts: 1});
        return cases;
    }""")
    assert trick["success"]["score"] == 927 and trick["success"]["holeIndex"] == 1
    assert trick["success"]["interactionLocked"] is True
    trick_page.wait_for_function("window.__TRI_ECHO_TEST__.state().holeIndex === 1 && !window.__TRI_ECHO_TEST__.state().interactionLocked", timeout=5000)
    assert trick_page.evaluate("window.__TRI_ECHO_TEST__.state().score") == 927
    trick_page.close()

    trick_failure_page = browser.new_page(viewport={"width": 1024, "height": 800})
    trick_failure_page.goto(f"{ROOT}?triEchoTest=1", wait_until="networkidle")
    trick_failure = trick_failure_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__, state = api.startFixture({mode: 'trick'}), initialBalls = structuredClone(state.ballState);
        api.configureFixture({score: 7});
        return {state: api.resolveShot({}), initialBalls};
    }""")
    assert trick_failure["state"]["score"] == 7 and trick_failure["state"]["ballState"] == trick_failure["initialBalls"]
    assert trick_failure["state"]["interactionLocked"] is False
    trick_failure_page.close()

    # PR6.0 Checkpoint C: capture a real production pre-shot table containing
    # historical pocket state, then let the real classic miss select rewind.
    rewind_page = browser.new_page(viewport={"width": 1024, "height": 800})
    rewind_page.goto(f"{ROOT}?triEchoTest=1", wait_until="networkidle")
    rewind = rewind_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__, started = api.startFixture({mode: 'classic'}), [prior, current] = started.ballState.slice(1);
        const ruleState = {phase: 'fixture', marker: 'rewind'};
        api.seedPocketedObjectBalls([prior.id]);
        api.configureFixture({ruleState, hybridPhase: 'fixture-phase', activePower: 'rewind', inventory: {...started.inventory, rewind: 1}, strokes: 3, totalStrokes: 9});
        api.captureFixturePreShot();
        return {state: api.resolveShot({pocketedIds: [current.id], contacts: [prior.id], firstCollision: prior.id}), priorId: prior.id, currentId: current.id, ruleState};
    }""")
    assert rewind["state"]["strokes"] == 2 and rewind["state"]["totalStrokes"] == 8
    assert rewind["state"]["inventory"]["rewind"] == 0 and rewind["state"]["activePower"] is None
    assert next(ball["pocketed"] for ball in rewind["state"]["ballState"] if ball["id"] == rewind["priorId"])
    assert not next(ball["pocketed"] for ball in rewind["state"]["ballState"] if ball["id"] == rewind["currentId"])
    assert rewind["state"]["pocketed"] == []
    # Classic miss does not itself mutate these fields; the production rewind
    # leaves them intact while restoring only the captured table snapshot.
    assert rewind["state"]["ruleState"] == rewind["ruleState"] and rewind["state"]["hybridPhase"] == "fixture-phase"
    rewind_page.close()

    # safeReset receives current-shot IDs only.  It must respawn that ball
    # without reviving an object pocketed before the shot.
    reset_page = browser.new_page(viewport={"width": 1024, "height": 800})
    reset_page.goto(f"{ROOT}?triEchoTest=1", wait_until="networkidle")
    reset = reset_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__, started = api.startFixture({mode: 'classic'}), [prior, current] = started.ballState.slice(1);
        api.seedPocketedObjectBalls([prior.id]);
        return {state: api.resolveShot({pocketedIds: [current.id], contacts: [prior.id], firstCollision: prior.id}), priorId: prior.id, currentId: current.id};
    }""")
    assert reset["state"]["interactionLocked"] is True
    reset_page.wait_for_function("window.__TRI_ECHO_TEST__.state().canAcceptGameplayInput", timeout=5000)
    reset_after = reset_page.evaluate("window.__TRI_ECHO_TEST__.state()")
    assert next(ball["pocketed"] for ball in reset_after["ballState"] if ball["id"] == reset["priorId"])
    assert not next(ball["pocketed"] for ball in reset_after["ballState"] if ball["id"] == reset["currentId"])
    reset_page.close()

    reset_scratch_page = browser.new_page(viewport={"width": 1024, "height": 800})
    reset_scratch_page.goto(f"{ROOT}?triEchoTest=1", wait_until="networkidle")
    reset_scratch = reset_scratch_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__, state = api.startFixture({mode: 'classic'});
        return api.resolveShot({pocketedIds: [state.ballState[0].id], contacts: [state.ballState[1].id], firstCollision: state.ballState[1].id});
    }""")
    assert reset_scratch["interactionLocked"] is True
    reset_scratch_page.wait_for_function("window.__TRI_ECHO_TEST__.state().canAcceptGameplayInput", timeout=5000)
    assert not reset_scratch_page.evaluate("window.__TRI_ECHO_TEST__.state().ballState[0].pocketed")
    reset_scratch_page.close()

    # restartHole invokes the production hole-start snapshot/restore path.
    restart_page = browser.new_page(viewport={"width": 1024, "height": 800})
    restart_page.goto(f"{ROOT}?triEchoTest=1", wait_until="networkidle")
    restarted = restart_page.evaluate("""() => {
        const api = window.__TRI_ECHO_TEST__, started = api.startFixture({mode: 'hybrid'}), object = started.ballState[1];
        api.configureFixture({score: 12, streak: 4, strokes: 3, totalStrokes: 8, activePower: 'trace', inventory: {...started.inventory, trace: 0}, ruleState: {phase: 'changed'}, hybridPhase: 'pocket'});
        api.seedPocketedObjectBalls([object.id]);
        const accepted = api.restartHole();
        return {accepted, state: api.state()};
    }""")
    assert restarted["accepted"] is True
    assert restarted["state"]["score"] == 0 and restarted["state"]["strokes"] == 0 and restarted["state"]["totalStrokes"] == 0
    assert restarted["state"]["activePower"] is None and restarted["state"]["inventory"]["trace"] == 1
    assert restarted["state"]["ruleState"] == {"phase": "open", "reds": 15, "colourIndex": 0}
    assert restarted["state"]["hybridPhase"] == "carom"
    assert all(not ball["pocketed"] for ball in restarted["state"]["ballState"])
    assert restarted["state"]["canAcceptGameplayInput"] is True
    restart_page.close()
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
            registration = page.evaluate("""async () => {
                const registration = await navigator.serviceWorker.ready;
                return {scope: registration.scope, active: registration.active?.state};
            }""")
            assert registration["active"] == "activated"
            descriptor = page.evaluate("async () => await (await fetch('./precache-manifest.json', {cache:'no-store'})).json()")
            expected_cache = "tri-echo-pr9-" + quote(registration["scope"], safe="") + "-" + descriptor["releaseId"]
            assert expected_cache in page.evaluate("caches.keys()")
            page.evaluate("caches.open('playtest-unrelated-cache')")
            assert "playtest-unrelated-cache" in page.evaluate("caches.keys()")
            page.evaluate("caches.delete('playtest-unrelated-cache')")
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
    assert classic_snooker["pocketModel"] == "physical"
    assert classic_snooker["pocketProfile"] == "classic"
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
        assert state["pocketModel"] == "physical"
        assert state["pocketProfile"] == {"american": "american", "british": "snooker", "trick": "classic"}[mode]
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
    assert american_training["pocketModel"] == "physical"
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

    # Production-bundle integration covers each solid collider family with
    # diagnostic events while preserving finite, playable state.
    page = browser.new_page(viewport={"width": 412, "height": 915})
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.goto(ROOT, wait_until="networkidle")
    collision_integration = page.evaluate("""async () => {
        const {Physics, STEP} = await import('./js/physics.js');
        const ball = (id, x, y, vx = 0, vy = 0, r = 18) => ({id, x, y, vx, vy, r, pocketed: false, spinX: 0, spinY: 0});
        const make = (balls, extra = {}) => ({w: 600, h: 400, bounds: {l: 0, r: 600, t: 0, b: 400}, traditional: false, balls, obstacles: [], rails: [], frictionZone: null, pockets: [], hole: null, ...extra});
        const scenarios = [
            make([ball(0, 160, 200, 2400, 0), ball(1, 220, 200)]),
            make([ball(0, 180, 200, 2400, 0)], {obstacles: [{x: 230, y: 200, r: 26}]}),
            make([ball(0, 260, 160, 0, 2400)], {rails: [{a: {x: 160, y: 200}, b: {x: 360, y: 200}}]}),
            make([ball(0, 20, 200, -2400, 0)])
        ];
        const expected = ['BALL_BALL', 'BUMPER', 'ECHO_RAIL', 'CUSHION'];
        return scenarios.map((table, index) => {
            const physics = new Physics(table, {diagnostics: true});
            physics.active = true;
            for (let step = 0; step < 8 && !physics.collisionEvents.some(event => event.type === expected[index]); step++) physics.step(STEP);
            return {
                expected: expected[index],
                observed: physics.collisionEvents.map(event => event.type),
                finite: table.balls.every(ball => [ball.x, ball.y, ball.vx, ball.vy].every(Number.isFinite)),
                bounded: physics.diagnostics.maxInternalSubsteps <= 16
            };
        });
    }""")
    assert all(row["expected"] in row["observed"] and row["finite"] and row["bounded"] for row in collision_integration), collision_integration
    page.locator("#playBtn").click()
    page.screenshot(path=str(OUT / "android-collision-integrity.png"), full_page=True)
    assert errors == [], errors
    page.close()

    # Physical pocket surfaces render in every supported viewport; exercise the
    # shipped modules as well as the UI mode mapping, without runtime setters.
    for label, viewport in [("iphone", {"width": 390, "height": 844}), ("android", {"width": 412, "height": 915}), ("wide", {"width": 430, "height": 932}), ("desktop", {"width": 1024, "height": 800})]:
        page = browser.new_page(viewport=viewport)
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.goto(ROOT, wait_until="networkidle")
        for mode, profile in [("american", "american"), ("british", "snooker"), ("classic", "classic")]:
            page.locator("#mode").select_option(mode)
            if mode == "classic":
                page.locator("#tableStyle").select_option("snooker")
            page.locator("#playBtn").click()
            state = page.evaluate("window.__TRI_ECHO__.state()")
            assert state["pocketModel"] == "physical" and state["pocketProfile"] == profile, state
            page.screenshot(path=str(OUT / f"{label}-physical-{profile}.png"), full_page=True)
            page.locator("#homeBtn").click()
        results = page.evaluate("""async () => {
            const {generateTable} = await import('./js/generator.js');
            const {Physics, STEP} = await import('./js/physics.js');
            const results = [];
            for (const ballSet of ['american', 'british', 'three']) for (let i = 0; i < 6; i++) {
                const table = generateTable(1337, 'normal', 0, 720, 1120, {ballSet, traditional: true});
                const ball = table.balls[0], pocket = table.pockets[i];
                table.balls = [ball];
                ball.x = pocket.mouth.x - pocket.outward.x * ball.r * 4;
                ball.y = pocket.mouth.y - pocket.outward.y * ball.r * 4;
                const physics = new Physics(table, {diagnostics: true});
                physics.shoot(pocket.outward.x * 600, pocket.outward.y * 600);
                for (let n = 0; n < 500 && physics.active; n++) physics.step(STEP);
                results.push({pot: ball.pocketed, entered: physics.collisionEvents.some(e => e.type === 'POCKET_ENTRY'), bounded: physics.diagnostics.maxInternalSubsteps <= 16});
            }
            return results;
        }""")
        assert len(results) == 18 and all(row["pot"] and row["entered"] and row["bounded"] for row in results), results
        assert errors == [], errors
        page.close()

    # PR8: files go through the actual input handler.  These checks keep the
    # hostile payload inert in both import and startup-localStorage paths,
    # and observe browser diagnostics rather than relying on a toast alone.
    hostile_id = '<img src=x onerror="window.auditImportExecuted=true">'
    hostile_save = {
        "stats": {"shots": 7, "successes": 3, "recent": [True, False]},
        "bestStreak": 4,
        "achievements": [{"id": hostile_id, "desc": "literal text"}],
        "settings": {"sound": False, "haptics": False, "reducedMotion": True, "contactPos": {"x": .2, "y": .8}},
        "mode": "classic", "difficulty": "hard", "tableStyle": "snooker",
        "trainingDiscipline": "snooker", "trickDiscipline": "british"
    }
    import json
    hostile_json = json.dumps(hostile_save)
    for label, viewport in [("pr8-390", {"width": 390, "height": 844}), ("pr8-412", {"width": 412, "height": 915}), ("pr8-desktop", {"width": 1024, "height": 800})]:
        context = browser.new_context(viewport=viewport)
        page = context.new_page()
        errors, payload_requests = [], []
        page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.on("request", lambda request: payload_requests.append(request.url) if request.url.endswith("/x") else None)
        page.goto(ROOT, wait_until="networkidle")
        page.locator("#openSettings").click()
        page.locator("#importFile").set_input_files({"name": "hostile-progress.json", "mimeType": "application/json", "buffer": hostile_json.encode()})
        page.wait_for_function("document.querySelector('#toast').textContent === 'PROGRESSO IMPORTADO'")
        page.locator("#settings .close").click()
        page.locator("#progressBtn").click()
        page.wait_for_function("document.querySelector('#progress').open")
        assert hostile_id in page.locator("#stats").inner_text()
        assert page.locator("#stats img").count() == 0
        assert page.locator("#stats script, #stats [onerror], #stats [onclick]").count() == 0
        assert page.evaluate("window.auditImportExecuted === true") is False
        assert payload_requests == [], payload_requests
        assert errors == [], errors
        bounds = page.locator("#stats").bounding_box()
        assert bounds["x"] >= 0 and bounds["x"] + bounds["width"] <= viewport["width"] + 1
        assert page.locator("#stats").evaluate("e => e.scrollWidth <= e.clientWidth") is True
        page.screenshot(path=str(OUT / f"{label}-safe-progress.png"), full_page=True)
        page.close()
        context.close()

    # A poisoned local save is normalized on startup too, without executing
    # the marker once Progress renders it.
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    errors, payload_requests = [], []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.on("request", lambda request: payload_requests.append(request.url) if request.url.endswith("/x") else None)
    page.add_init_script(f"localStorage.setItem('triEchoSaveV1', {json.dumps(hostile_json)})")
    page.goto(ROOT, wait_until="networkidle")
    page.locator("#progressBtn").click()
    assert hostile_id in page.locator("#stats").inner_text()
    assert page.locator("#stats img").count() == 0
    assert page.locator("#stats script, #stats [onerror], #stats [onclick]").count() == 0
    assert page.evaluate("window.auditImportExecuted === true") is False
    assert payload_requests == [], payload_requests
    assert errors == [], errors
    page.close()
    context.close()

    # A denied localStorage getter also falls back safely at startup and does
    # not replace the inaccessible raw recovery bytes.
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    page.add_init_script("""(() => {
        localStorage.setItem('triEchoSaveV1', '{"stats":{"shots":5}}');
        const original = Storage.prototype.getItem;
        window.__pr8RestoreGetItem = () => { Storage.prototype.getItem = original; };
        Storage.prototype.getItem = function(key) { if (key === 'triEchoSaveV1') throw new DOMException('denied', 'SecurityError'); return original.call(this, key); };
    })()""")
    page.goto(ROOT, wait_until="networkidle")
    page.locator("#progressBtn").click()
    assert "Tacadas: 0" in page.locator("#stats").inner_text()
    page.evaluate("window.__pr8RestoreGetItem()")
    assert page.evaluate("localStorage.getItem('triEchoSaveV1')") == '{"stats":{"shots":5}}'
    page.close()
    context.close()

    # Startup rejects malformed local bytes without overwriting the recovery
    # source, and still presents a usable default Progress view.
    context = browser.new_context(viewport={"width": 390, "height": 844})
    page = context.new_page()
    corrupt = '{not valid json'
    page.add_init_script(f"localStorage.setItem('triEchoSaveV1', {json.dumps(corrupt)})")
    page.goto(ROOT, wait_until="networkidle")
    assert page.evaluate("localStorage.getItem('triEchoSaveV1')") == corrupt
    page.locator("#progressBtn").click()
    assert "Tacadas: 0" in page.locator("#stats").inner_text()
    page.close()
    context.close()

    # A denied persistence write is a transaction failure: the active round,
    # old bytes and live settings stay intact and success is never reported.
    context = browser.new_context(viewport={"width": 412, "height": 915})
    page = context.new_page()
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.goto(ROOT, wait_until="networkidle")
    page.locator("#playBtn").click()
    before_round = page.evaluate("window.__TRI_ECHO__.state()")
    before_bytes = page.evaluate("localStorage.getItem('triEchoSaveV1')")
    page.locator("#settingsBtn").click()
    page.locator("#importFile").set_input_files({"name": "invalid.json", "mimeType": "application/json", "buffer": b'{"stats":{"shots":"9"}}'})
    page.wait_for_function("document.querySelector('#toast').textContent === 'FICHEIRO INVÁLIDO'")
    assert page.evaluate("localStorage.getItem('triEchoSaveV1')") == before_bytes
    rejected_round = page.evaluate("window.__TRI_ECHO__.state()")
    for field in ("mode", "holeIndex", "seed", "tableStyle", "ballState", "ruleState", "inventory", "soundEnabled", "controlPos", "rails", "roundEpoch", "activePower"):
        assert rejected_round[field] == before_round[field], field
    page.evaluate("""() => {
        const original = Storage.prototype.setItem;
        window.__pr8RestoreSetItem = () => { Storage.prototype.setItem = original; };
        Storage.prototype.setItem = function(key, value) {
            if (key === 'triEchoSaveV1') throw new DOMException('quota', 'QuotaExceededError');
            return original.call(this, key, value);
        };
    }""")
    valid_json = json.dumps({"stats": {"shots": 99, "successes": 88, "recent": []}, "settings": {"sound": False, "haptics": False, "reducedMotion": True, "contactPos": {"x": .1, "y": .9}}})
    page.locator("#importFile").set_input_files({"name": "denied.json", "mimeType": "application/json", "buffer": valid_json.encode()})
    page.wait_for_function("document.querySelector('#toast').textContent.includes('NÃO FOI POSSÍVEL')")
    assert page.evaluate("localStorage.getItem('triEchoSaveV1')") == before_bytes
    after_round = page.evaluate("window.__TRI_ECHO__.state()")
    for field in ("mode", "holeIndex", "seed", "tableStyle", "ballState", "ruleState", "inventory", "soundEnabled", "controlPos", "rails", "roundEpoch", "activePower"):
        assert after_round[field] == before_round[field], field
    assert page.locator("#toast").inner_text() != "PROGRESSO IMPORTADO"
    page.evaluate("window.__pr8RestoreSetItem()")
    page.evaluate("""() => {
        const original = Storage.prototype.setItem;
        window.__pr8RestoreSecuritySetItem = () => { Storage.prototype.setItem = original; };
        Storage.prototype.setItem = function(key, value) {
            if (key === 'triEchoSaveV1') throw new DOMException('denied', 'SecurityError');
            return original.call(this, key, value);
        };
    }""")
    page.locator("#importFile").set_input_files({"name": "security-denied.json", "mimeType": "application/json", "buffer": valid_json.encode()})
    page.wait_for_function("document.querySelector('#toast').textContent.includes('NÃO FOI POSSÍVEL')")
    assert page.evaluate("localStorage.getItem('triEchoSaveV1')") == before_bytes
    assert page.evaluate("window.__TRI_ECHO__.state().roundEpoch") == before_round["roundEpoch"]
    page.evaluate("window.__pr8RestoreSecuritySetItem()")
    page.locator("#settings .close").click()
    page.locator("#homeBtn").click()
    page.locator("#progressBtn").click()
    assert "Tacadas: 0" in page.locator("#stats").inner_text()
    assert errors == [], errors
    page.close()
    context.close()

    # A committed import updates preferences and their controls while retaining
    # the already-generated round, including the live table and inventory.
    context = browser.new_context(viewport={"width": 412, "height": 915})
    page = context.new_page()
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.goto(ROOT, wait_until="networkidle")
    page.locator("#playBtn").click()
    before_round = page.evaluate("window.__TRI_ECHO__.state()")
    page.locator("#settingsBtn").click()
    reconciled_json = json.dumps({
        "stats": {"shots": 31, "successes": 9, "recent": [True]},
        "settings": {"sound": False, "haptics": False, "reducedMotion": True, "contactPos": {"x": .15, "y": .85}},
        "mode": "classic", "difficulty": "hard", "tableStyle": "snooker",
        "trainingDiscipline": "snooker", "trickDiscipline": "british"
    })
    page.locator("#importFile").set_input_files({"name": "reconciled.json", "mimeType": "application/json", "buffer": reconciled_json.encode()})
    page.wait_for_function("document.querySelector('#toast').textContent === 'PROGRESSO IMPORTADO'")
    after_round = page.evaluate("window.__TRI_ECHO__.state()")
    for field in ("mode", "holeIndex", "seed", "tableStyle", "ballState", "ruleState", "inventory", "rails", "roundEpoch", "activePower"):
        assert after_round[field] == before_round[field], field
    assert after_round["soundEnabled"] is False
    assert after_round["controlPos"] == {"x": .15, "y": .85}
    assert page.locator("#sound").is_checked() is False
    assert page.locator("#haptics").is_checked() is False
    assert page.locator("#reduced").is_checked() is True
    page.locator("#settings .close").click()
    page.locator("#homeBtn").click()
    assert page.locator("#mode").input_value() == "classic"
    assert page.locator("#difficulty").input_value() == "hard"
    assert page.locator("#tableStyle").input_value() == "snooker"
    assert page.locator("#trainingDiscipline").input_value() == "snooker"
    assert page.locator("#trickDiscipline").input_value() == "british"
    contact_box, stage_box = page.locator("#contactControl").bounding_box(), page.locator("#stage").bounding_box()
    assert stage_box["x"] <= contact_box["x"] and contact_box["x"] + contact_box["width"] <= stage_box["x"] + stage_box["width"]
    assert stage_box["y"] <= contact_box["y"] and contact_box["y"] + contact_box["height"] <= stage_box["y"] + stage_box["height"]
    page.locator("#continueBtn").click()
    assert page.evaluate("window.__TRI_ECHO__.state().roundEpoch") == before_round["roundEpoch"]
    assert errors == [], errors
    page.close()
    context.close()

    # Out-of-order File.text() completions use only the latest selection. This
    # is a browser-only interception; production has no test seam.
    context = browser.new_context(viewport={"width": 412, "height": 915})
    page = context.new_page()
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.goto(ROOT, wait_until="networkidle")
    page.locator("#openSettings").click()
    page.evaluate("""() => {
        const original = File.prototype.text;
        window.__pr8PendingReads = {};
        window.__pr8RestoreFileText = () => { File.prototype.text = original; };
        File.prototype.text = function() {
            return new Promise((resolve, reject) => { window.__pr8PendingReads[this.name] = {resolve, reject}; });
        };
    }""")
    older = json.dumps({"stats": {"shots": 11, "successes": 0, "recent": []}})
    latest = json.dumps({"stats": {"shots": 22, "successes": 2, "recent": []}})
    page.locator("#importFile").set_input_files({"name": "older.json", "mimeType": "application/json", "buffer": older.encode()})
    page.locator("#importFile").set_input_files({"name": "latest.json", "mimeType": "application/json", "buffer": latest.encode()})
    page.wait_for_function("window.__pr8PendingReads['older.json'] && window.__pr8PendingReads['latest.json']")
    page.evaluate("value => window.__pr8PendingReads['latest.json'].resolve(value)", latest)
    page.wait_for_function("document.querySelector('#toast').textContent === 'PROGRESSO IMPORTADO'")
    page.evaluate("() => window.__pr8PendingReads['older.json'].reject(new Error('stale failure'))")
    page.wait_for_timeout(80)
    committed = page.evaluate("JSON.parse(localStorage.getItem('triEchoSaveV1'))")
    assert committed["stats"]["shots"] == 22
    assert page.locator("#toast").inner_text() == "PROGRESSO IMPORTADO"
    assert page.locator("#importFile").input_value() == ""
    # An older *success* cannot overwrite the newer invalid selection either.
    page.locator("#importFile").set_input_files({"name": "older-success.json", "mimeType": "application/json", "buffer": older.encode()})
    page.locator("#importFile").set_input_files({"name": "latest-invalid.json", "mimeType": "application/json", "buffer": b"{bad"})
    page.wait_for_function("window.__pr8PendingReads['older-success.json'] && window.__pr8PendingReads['latest-invalid.json']")
    page.evaluate("value => window.__pr8PendingReads['latest-invalid.json'].resolve(value)", "{bad")
    page.wait_for_function("document.querySelector('#toast').textContent === 'FICHEIRO INVÁLIDO'")
    page.evaluate("value => window.__pr8PendingReads['older-success.json'].resolve(value)", older)
    page.wait_for_timeout(80)
    assert page.evaluate("JSON.parse(localStorage.getItem('triEchoSaveV1')).stats.shots") == 22
    assert page.locator("#toast").inner_text() == "FICHEIRO INVÁLIDO"
    page.evaluate("window.__pr8RestoreFileText()")
    assert errors == [], errors
    page.close()
    context.close()

    # Closing the importing dialog cancels the pending request; an eventual
    # read completion cannot overwrite a round that has resumed.
    context = browser.new_context(viewport={"width": 412, "height": 915})
    page = context.new_page()
    errors = []
    page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
    page.on("pageerror", lambda err: errors.append(str(err)))
    page.goto(ROOT, wait_until="networkidle")
    page.locator("#playBtn").click()
    before_round = page.evaluate("window.__TRI_ECHO__.state()")
    before_bytes = page.evaluate("localStorage.getItem('triEchoSaveV1')")
    page.locator("#settingsBtn").click()
    page.evaluate("""() => {
        const original = File.prototype.text;
        window.__pr8RestoreCancelledText = () => { File.prototype.text = original; };
        File.prototype.text = () => new Promise(resolve => window.__pr8ResolveCancelled = resolve);
    }""")
    page.locator("#importFile").set_input_files({"name": "cancelled.json", "mimeType": "application/json", "buffer": latest.encode()})
    page.wait_for_function("typeof window.__pr8ResolveCancelled === 'function'")
    page.locator("#settings .close").click()
    page.evaluate("value => window.__pr8ResolveCancelled(value)", latest)
    page.wait_for_timeout(80)
    assert page.evaluate("localStorage.getItem('triEchoSaveV1')") == before_bytes
    after_round = page.evaluate("window.__TRI_ECHO__.state()")
    for field in ("mode", "holeIndex", "seed", "tableStyle", "ballState", "ruleState", "inventory"):
        assert after_round[field] == before_round[field], field
    assert page.locator("#toast").inner_text() != "PROGRESSO IMPORTADO"
    # Escape also cancels before a newly started round can record a shot.
    page.locator("#settingsBtn").click()
    page.locator("#importFile").set_input_files({"name": "escape-new-round.json", "mimeType": "application/json", "buffer": latest.encode()})
    page.keyboard.press("Escape")
    page.wait_for_function("!document.querySelector('#settings').open")
    page.locator("#homeBtn").click()
    page.locator("#mode").select_option("tour")
    page.locator("#playBtn").click()
    take_short_shot(page)
    page.locator("#settingsBtn").click()
    shot_bytes = page.evaluate("localStorage.getItem('triEchoSaveV1')")
    new_round = page.evaluate("window.__TRI_ECHO__.state()")
    assert json.loads(shot_bytes)["stats"]["shots"] == 1
    page.evaluate("value => window.__pr8ResolveCancelled(value)", latest)
    page.wait_for_timeout(80)
    assert page.evaluate("localStorage.getItem('triEchoSaveV1')") == shot_bytes
    assert page.evaluate("window.__TRI_ECHO__.state().seed") == new_round["seed"]
    page.evaluate("window.__pr8RestoreCancelledText()")
    assert errors == [], errors
    page.close()
    context.close()

    # Exported canonical data reimports through the file input; clearing the
    # input allows selecting the same physical file again.
    context = browser.new_context(viewport={"width": 1024, "height": 800}, accept_downloads=True)
    page = context.new_page()
    page.goto(ROOT, wait_until="networkidle")
    page.locator("#openSettings").click()
    page.locator("#importFile").set_input_files({"name": "roundtrip.json", "mimeType": "application/json", "buffer": valid_json.encode()})
    page.wait_for_function("document.querySelector('#toast').textContent === 'PROGRESSO IMPORTADO'")
    with page.expect_download() as download_info:
        page.locator("#exportBtn").click()
    download = download_info.value
    assert download.suggested_filename == "tri-echo-progress.json"
    exported = Path(download.path()).read_bytes()
    # The input was cleared after the first selection, so this is the first
    # import of a physical file that will then be selected identically again.
    page.locator("#importFile").set_input_files({"name": "tri-echo-progress.json", "mimeType": "application/json", "buffer": exported})
    page.wait_for_function("document.querySelector('#toast').textContent === 'PROGRESSO IMPORTADO'")
    assert page.locator("#importFile").input_value() == ""
    page.evaluate("""() => {
        window.__pr8Writes = 0;
        const original = Storage.prototype.setItem;
        window.__pr8RestoreRetrySetItem = () => { Storage.prototype.setItem = original; };
        Storage.prototype.setItem = function(key, value) { if (key === 'triEchoSaveV1') window.__pr8Writes++; return original.call(this, key, value); };
        document.querySelector('#toast').textContent = '';
    }""")
    page.locator("#importFile").set_input_files({"name": "tri-echo-progress.json", "mimeType": "application/json", "buffer": exported})
    page.wait_for_function("document.querySelector('#toast').textContent === 'PROGRESSO IMPORTADO'")
    assert page.locator("#importFile").input_value() == ""
    assert page.evaluate("window.__pr8Writes") == 1
    page.evaluate("window.__pr8RestoreRetrySetItem()")
    assert json.loads(exported)["stats"]["shots"] == 99
    assert page.evaluate("JSON.parse(localStorage.getItem('triEchoSaveV1'))") == json.loads(exported)
    with page.expect_download() as second_download:
        page.locator("#exportBtn").click()
    assert json.loads(Path(second_download.value.path()).read_bytes()) == json.loads(exported)
    page.close()
    context.close()

    # Persisted sound=false is effective immediately after reload.
    page = browser.new_page(viewport={"width": 390, "height": 844})
    page.goto(ROOT, wait_until="networkidle")
    page.evaluate("localStorage.setItem('triEchoSaveV1', JSON.stringify({settings:{sound:false}}))")
    page.reload(wait_until="networkidle")
    page.locator("#playBtn").click()
    assert page.evaluate("window.__TRI_ECHO__.state().soundEnabled") is False
    page.close()
    browser.close()

# The ordinary Chromium characterization is also the PR9 regression entry
# point.  PR9_ONLY remains available for a focused CI/debug invocation.
run_pr9_fixture_matrix()

# PR10 runs in its own server/profile because it replaces Web Storage at the
# native boundary.  Keep it after every existing browser qualification,
# including the PR9 coherent-update matrix above.
import subprocess
import sys
subprocess.run([sys.executable, str(Path(__file__).with_name("storage-resilience.py"))], check=True)
subprocess.run([sys.executable, str(Path(__file__).with_name("lifecycle-recovery.py"))], check=True)
