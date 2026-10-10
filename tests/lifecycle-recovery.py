#!/usr/bin/env python3
"""PR11 browser recovery acceptance, using a real history traversal.

The check deliberately removes Playwright's default BFCache disablement and
requires pageshow.persisted.  It never dispatches lifecycle events itself.
"""
from __future__ import annotations

import json
import os
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from playwright.sync_api import sync_playwright


HERE = Path(__file__).resolve().parents[1]
APP_ROOT = Path(os.environ.get("PR11_APP_ROOT", HERE / "dist" / "client")).resolve()
OUT = Path(os.environ.get("PLAYTEST_ARTIFACTS", HERE / "tests" / "artifacts"))
OUT.mkdir(parents=True, exist_ok=True)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, directory=None, **kwargs):
        super().__init__(*args, directory=str(APP_ROOT), **kwargs)

    def translate_path(self, path):
        path = urlparse(path).path
        if path == "/away":
            return str(APP_ROOT / "__away__.html")
        if not (path == "/client" or path.startswith("/client/")):
            return str(APP_ROOT / "__missing__")
        candidate = (APP_ROOT / unquote(path.removeprefix("/client/") or "index.html")).resolve()
        return str(candidate if candidate.is_relative_to(APP_ROOT) else APP_ROOT / "__missing__")

    def do_GET(self):
        if urlparse(self.path).path == "/away":
            body = b"<!doctype html><title>Away</title><p>away</p>"
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()

    def log_message(self, *_):
        pass


def serve():
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    return httpd, f"http://127.0.0.1:{httpd.server_port}"


def state(page):
    return page.evaluate("window.__TRI_ECHO__.state()")


def durable(page):
    return page.evaluate("localStorage.getItem('triEchoSaveV1')")


def install_log(page):
    page.evaluate("""() => {
      window.__pr11Lifecycle = [];
      if (window.__pr11Installed) return;
      window.__pr11Installed = true;
      for (const type of ['pagehide','pageshow']) addEventListener(type, e => {
        const s = window.__TRI_ECHO__.state();
        window.__pr11Lifecycle.push({type, persisted:e.persisted,
          snapshot:s && {ballState:s.ballState,cueSpeed:s.cueSpeed,totalStrokes:s.totalStrokes}});
      });
    }""")


def cycle(page, origin, url, away_ms=80):
    install_log(page)
    page.goto(origin + '/away', wait_until='load')
    page.wait_for_timeout(away_ms)
    # BFCache does not emit a new load. Require genuine restore, never reload.
    page.evaluate('history.back()')
    page.wait_for_url(url, wait_until='commit', timeout=5000)
    page.wait_for_function("window.__pr11Lifecycle?.some(e=>e.type==='pageshow' && e.persisted)", timeout=3000)
    events = page.evaluate('window.__pr11Lifecycle')
    assert len([e for e in events if e['type']=='pageshow' and e['persisted']]) == 1, events
    return events


def pointer(page, selector, kind, pointer_id, x, y):
    page.dispatch_event(selector, kind, {'pointerId':pointer_id,'clientX':x,'clientY':y})


def shot(page, pull=48):
    # Normal UI gesture + production Physics, not fixture resolution.
    box = page.locator('#game').bounding_box(); s = state(page)
    x=box['x']+box['width']*s['cue']['x']; y=box['y']+box['height']*s['cue']['y']
    for kind,offset in [('pointerdown',0),('pointermove',pull),('pointerup',pull)]:
        pointer(page,'#game',kind,911,x+offset,y)


def settle(page):
    page.wait_for_function("!window.__TRI_ECHO__.state().active && !window.__TRI_ECHO__.state().interactionLocked", timeout=12000)


FILE_HOOK = """(() => {
 const original = File.prototype.text;
 File.prototype.text = function(){
   if(!window.__pr11DeferFileText) return original.call(this);
   return new Promise(resolve => {window.__pr11ResolveFileText=resolve});
 };
})()"""
AUDIO_HOOK = """(() => {
 window.__pr11Audio={created:0,resume:0,suspend:0};window.__pr11Unhandled=[];
 addEventListener('unhandledrejection',e=>window.__pr11Unhandled.push(String(e.reason)));
 class Context {
  constructor(){window.__pr11Audio.created++;this.state='suspended'}
  resume(){window.__pr11Audio.resume++;return Promise.reject(Error('blocked resume'))}
  suspend(){window.__pr11Audio.suspend++;return Promise.reject(Error('blocked suspend'))}
 }
 window.AudioContext=Context;window.webkitAudioContext=Context;
})()"""


def main():
    httpd, origin = serve(); url=origin+'/client/?triEchoTest=1'
    result={'appRoot':str(APP_ROOT),'buildInfo':json.loads((APP_ROOT/'build-info.json').read_text()),
            'releaseId':json.loads((APP_ROOT/'precache-manifest.json').read_text())['releaseId'],
            'cases':[], 'physicalDeviceQualification':'A12 pending; no device equivalence claimed'}
    browser=None; contexts=[]
    def record(criterion, name, **evidence):
        result['cases'].append(dict(id=criterion,name=name,**evidence))
        print(f'{criterion}: {name} PASS',flush=True)
    try:
        with sync_playwright() as p:
            try:
                browser=p.chromium.launch(channel='chromium',headless=True,ignore_default_args=['--disable-back-forward-cache'])
                result['browserVersion']=browser.version
                def fresh(mode='golf', audio=False):
                    ctx=browser.new_context(viewport={'width':390,'height':844},service_workers='allow',accept_downloads=True)
                    contexts.append(ctx);ctx.add_init_script(FILE_HOOK);ctx.add_init_script('Date.now=()=>624063493')
                    if audio:ctx.add_init_script(AUDIO_HOOK)
                    page=ctx.new_page();page.set_default_timeout(5000)
                    errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
                    page.goto(url,wait_until='networkidle');page.evaluate('navigator.serviceWorker.ready')
                    if not page.evaluate('!!navigator.serviceWorker.controller'):page.reload(wait_until='networkidle')
                    assert page.evaluate('!!navigator.serviceWorker.controller')
                    page.locator('#playBtn').click()
                    page.evaluate('mode=>window.__TRI_ECHO_TEST__.startFixture({mode})',mode)
                    return ctx,page,errors
                # A04/A05: actual history restores for all pending resolver paths.
                cases=[('golf-miss','golf',{}),('golf-hole','golf',{'pocketedIds':[1]}),
                       ('classic-hole','classic',{'contacts':[1,2]}),
                       ('trick-hole','trick',{'pocketedIds':[1],'objectCushions':1}),
                       ('american-reset','american',{}),('british-reset','british',{})]
                for name,mode,facts in cases:
                    ctx,page,errors=fresh(mode)
                    page.evaluate('window.__TRI_ECHO_TEST__.configureFixture({strokes:1,totalStrokes:1})')
                    before=page.evaluate('facts=>window.__TRI_ECHO_TEST__.resolveShot(facts)',facts)
                    saved=durable(page);assert before['interactionLocked'] and before['pendingRoundTasks']==1
                    events=cycle(page,origin,url);settle(page);after=state(page)
                    assert after['canAcceptGameplayInput'] and after['pendingRoundTasks']==0
                    for key in ['score','totalStrokes','inventory','activePower','holeIndex']:assert after[key]==before[key],(name,key)
                    assert durable(page)==saved and errors==[]
                    record('A04' if mode=='golf' else 'A05',name,before=before,after=after,events=events)
                    ctx.close();contexts.remove(ctx)
                # Real path + Forge witness: effects were already applied before suspension.
                ctx,page,errors=fresh()
                page.evaluate("window.__TRI_ECHO_TEST__.configureFixture({activePower:'forge'})")
                shot(page,150);page.wait_for_timeout(350);assert state(page)['active']
                before=page.evaluate('window.__TRI_ECHO_TEST__.resolveShot({pocketedIds:[1]})')
                saved=durable(page);assert before['inventory']['forge']==0 and before['rails']==1
                assert json.loads(saved)['stats']['shots']==1 and len(json.loads(saved)['stats']['recent'])==1
                events=cycle(page,origin,url);settle(page);after=state(page)
                assert after['score']==before['score'] and after['inventory']==before['inventory']
                assert after['rails']==before['rails'] and durable(page)==saved
                record('A04','forge-effect-conservation',before=before,after=after,events=events)
                assert errors==[];ctx.close();contexts.remove(ctx)
                # A05: six settled holes, BFCache during both endGame and nested menu.
                for mode in ['daily','tour']:
                    ctx,page,errors=fresh(mode)
                    for index in range(5):
                        page.evaluate('window.__TRI_ECHO_TEST__.resolveShot({pocketedIds:[1]})');settle(page)
                        assert state(page)['holeIndex']==index+1
                    before=page.evaluate('window.__TRI_ECHO_TEST__.resolveShot({pocketedIds:[1]})')
                    events=cycle(page,origin,url)
                    page.wait_for_function('window.__TRI_ECHO__.state().finished')
                    assert not page.locator('#menu').evaluate('e=>e.open')
                    saved=durable(page);nested=cycle(page,origin,url)
                    page.wait_for_function("document.querySelector('#menu').open")
                    after=state(page);assert after['holeIndex']==6 and after['score']==before['score']
                    assert after['dailyDayKey']==before['dailyDayKey'] and after['seed']==before['seed']
                    assert durable(page)==saved and after['pendingRoundTasks']==0
                    if mode=='daily':assert json.loads(saved)['dailies'].count(after['dailyDayKey'])==1
                    record('A05',mode+'-completion-and-nested-menu',before=before,after=after,events=events,nestedEvents=nested)
                    assert errors==[];ctx.close();contexts.remove(ctx)
                # A06: frozen physics across >1 second absent, then one real resolution.
                ctx,page,errors=fresh();shot(page);page.wait_for_function('window.__TRI_ECHO__.state().active')
                before=state(page);events=cycle(page,origin,url,1200)
                hidden=next(e['snapshot'] for e in events if e['type']=='pagehide')
                shown=next(e['snapshot'] for e in events if e['type']=='pageshow')
                assert hidden==shown, (hidden,shown)
                settle(page);after=state(page);saved=json.loads(durable(page))
                assert after['totalStrokes']==1 and saved['stats']['shots']==1 and len(saved['stats']['recent'])==1
                record('A06','moving-shot-no-absence-catchup',before=before,after=after,events=events,awayMs=1200)
                assert errors==[];ctx.close();contexts.remove(ctx)
                # A07: each modal gates input after a real return, then closes coherently.
                ctx,page,errors=fresh()
                for dialog in ['settings','progress','menu']:
                    if dialog=='settings':page.locator('#settingsBtn').click()
                    else:
                        page.locator('#homeBtn').click()
                        if dialog=='progress':page.locator('#progressBtn').click()
                    events=cycle(page,origin,url);assert state(page)['paused'] and not state(page)['canAcceptGameplayInput']
                    if dialog=='menu':page.locator('#continueBtn').click()
                    else:
                        page.locator('#'+dialog+' .close').click()
                        if dialog=='progress':page.locator('#continueBtn').click()
                    assert state(page)['canAcceptGameplayInput']
                    record('A07',dialog+'-return',events=events)
                # Hidden-modal closure is a separately labelled state simulation.
                page.locator('#settingsBtn').click()
                page.evaluate("Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange'));document.querySelector('#settings').close()")
                page.wait_for_timeout(50);assert state(page)['paused'] and state(page)['lifecycleSuspended']
                page.evaluate("delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))")
                assert state(page)['canAcceptGameplayInput']
                page.evaluate('window.__TRI_ECHO_TEST__.resolveShot({})')
                page.locator('#homeBtn').click();page.locator('#playBtn').click();before=state(page)
                page.wait_for_timeout(700);after=state(page)
                assert after['seed']==before['seed'] and after['holeIndex']==0 and after['totalStrokes']==0 and after['pendingRoundTasks']==0
                page.locator('#retryBtn').click();assert state(page)['canAcceptGameplayInput']
                record('A07','hidden-modal-close-and-new-game-invalidation',method='hidden getter/events simulation plus real UI restart',after=after)
                assert errors==[];ctx.close();contexts.remove(ctx)
                # A08: native pointer capture must be established before cancelling.
                for owner,selector in [('gameplay','#game'),('contact','#cueFace'),('move','#moveContact')]:
                    ctx,page,errors=fresh();box=page.locator(selector).bounding_box()
                    x=box['x']+box['width']/2;y=box['y']+box['height']/2
                    old=state(page);saved=durable(page)
                    page.mouse.move(x,y);page.mouse.down();page.mouse.move(x+15,y+15)
                    held=state(page)
                    if owner=='gameplay':assert held['dragActive'] and held['activeGameplayPointerId']==1
                    elif owner=='contact':assert held['contact']!=old['contact']
                    else:assert held['controlPos']!=old['controlPos']
                    events=cycle(page,origin,url)
                    pointer(page,selector,'pointermove',1,x+60,y+60);pointer(page,selector,'pointerup',1,x+60,y+60)
                    after=state(page)
                    assert after['totalStrokes']==old['totalStrokes'] and durable(page)==saved
                    assert after['contact']==held['contact'] and after['controlPos']==held['controlPos']
                    assert not after['dragActive'] and after['activeGameplayPointerId'] is None
                    page.mouse.up();page.set_viewport_size({'width':844,'height':390});resized=state(page)
                    assert resized['ballState']==after['ballState'] and resized['holeIndex']==after['holeIndex']
                    record('A08',owner+'-stale-owner-and-viewport-resize',held=held,after=after,events=events,orientationMethod='viewport only, not physical device')
                    assert errors==[];ctx.close();contexts.remove(ctx)
                # A09: fake browser audio at the native API boundary, rejected promises.
                ctx,page,errors=fresh(audio=True)
                assert page.evaluate('window.__pr11Audio.created')==0
                shot(page);settle(page);before=page.evaluate('structuredClone(window.__pr11Audio)')
                assert before['created']==1 and before['resume']==1
                events=cycle(page,origin,url);after=page.evaluate('structuredClone(window.__pr11Audio)')
                assert after['created']==before['created'] and after['resume']==before['resume'] and after['suspend']>before['suspend']
                page.locator('#settingsBtn').click();page.locator('#sound').uncheck();page.locator('#settings .close').click()
                disabled=page.evaluate('structuredClone(window.__pr11Audio)');shot(page);settle(page)
                assert page.evaluate('window.__pr11Audio')==disabled and state(page)['totalStrokes']==2
                assert page.evaluate('window.__pr11Unhandled')==[] and errors==[]
                record('A09','rejected-audio-no-autoplay-and-disabled-gesture',before=before,after=after,events=events)
                ctx.close();contexts.remove(ctx)
                # A10: valid deferred read cancelled by real lifecycle; positive control.
                ctx,page,errors=fresh();page.locator('#settingsBtn').click();saved=durable(page)
                payload=json.dumps({'stats':{'shots':999}})
                upload={'name':'progress.json','mimeType':'application/json','buffer':payload.encode()}
                page.evaluate('window.__pr11DeferFileText=true');page.locator('#importFile').set_input_files(upload)
                page.wait_for_function('!!window.__pr11ResolveFileText');events=cycle(page,origin,url)
                page.evaluate('value=>window.__pr11ResolveFileText(value)',payload);page.wait_for_timeout(100)
                assert durable(page)==saved and page.locator('#toast').text_content()!='PROGRESSO IMPORTADO'
                with page.expect_download() as download:page.locator('#exportBtn').click()
                assert json.loads(Path(download.value.path()).read_text())==json.loads(saved)
                page.evaluate('window.__pr11DeferFileText=false');page.locator('#importFile').set_input_files(upload)
                page.wait_for_function("document.querySelector('#toast').textContent==='PROGRESSO IMPORTADO'")
                assert json.loads(durable(page))['stats']['shots']==999 and errors==[]
                record('A10','cancelled-valid-import-live-export-and-positive-control',events=events)
                ctx.close();contexts.remove(ctx)
            finally:
                for ctx in contexts:ctx.close()
                if browser:browser.close()
    except BaseException as error:
        result['failure']=repr(error);raise
    finally:
        (OUT/'lifecycle-recovery-results.json').write_text(json.dumps(result,indent=2)+'\n')
        httpd.shutdown();httpd.server_close()


if __name__=='__main__':
    main()
