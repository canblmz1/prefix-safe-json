"""Optional local browser acceptance test; requires Python Playwright + Chromium."""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

base_url=os.environ.get('DEVAM_TEST_URL','http://127.0.0.1:4317')
output=Path('artifacts/devam-ui')
output.mkdir(parents=True,exist_ok=True)

with sync_playwright() as p:
    browser=p.chromium.launch(headless=True)
    context=browser.new_context(viewport={'width':1440,'height':1080},reduced_motion='reduce',permissions=['clipboard-read','clipboard-write'])
    page=context.new_page()
    errors=[]
    requests=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('request',lambda request:requests.append(request.url))
    page.goto(base_url)
    page.wait_for_load_state('networkidle')
    expect(page.locator('.requirement')).to_have_count(3)
    first=page.locator('.requirement').first
    expect(first.get_by_role('button',name='Dosyayı ve maddeyi inceledim')).to_be_disabled()

    first.get_by_role('button',name='AI beyanı ekle').click()
    malicious='<img src=x onerror="window.injected=true"> Tamamlandı.'
    page.get_by_label('Tamamlandığı söylenen iş').fill(malicious)
    page.get_by_role('button',name='AI beyanını kaydet').click()
    expect(first.locator('.status')).to_have_text('AI bildirdi')
    expect(first.locator('.claim')).to_have_text(malicious)
    expect(first.locator('img')).to_have_count(0)

    first.locator('input[type=file]').set_input_files({'name':'sonuc.txt','mimeType':'text/plain','buffer':b'original result'})
    expect(first.get_by_role('button',name='Dosyayı ve maddeyi inceledim')).to_be_enabled()
    first.get_by_role('button',name='Dosyayı ve maddeyi inceledim').click()
    expect(page.locator('#review-count')).to_have_text('1 / 3 incelendi')
    first.get_by_role('button',name='İncelemeyi geri al').click()
    expect(page.locator('#review-count')).to_have_text('0 / 3 incelendi')
    first.get_by_role('button',name='Dosyayı ve maddeyi inceledim').click()
    page.reload()
    expect(page.locator('#review-count')).to_have_text('1 / 3 incelendi')
    first=page.locator('.requirement').first

    first.locator('input[type=file]').set_input_files({'name':'sonuc.txt','mimeType':'text/plain','buffer':b'changed result'})
    expect(page.locator('#review-count')).to_have_text('0 / 3 incelendi')
    first.get_by_role('button',name='Dosyayı ve maddeyi inceledim').click()
    with page.expect_download() as event:
        page.get_by_role('button',name='Kaydı indir').click()
    before_path=output/'before-revision.devam.json'
    event.value.save_as(before_path)
    previous=json.loads(before_path.read_text(encoding='utf-8'))

    page.get_by_role('button',name='Düzenle').click()
    page.get_by_label('AI’den istediğin iş').fill(previous['goal']+' Yalnızca taslak hazırla.')
    page.get_by_role('button',name='Güncel isteği kaydet').click()
    expect(first.locator('.status')).to_have_text('Yeniden incele')
    expect(page.locator('#revision')).to_have_text('İSTEK 02')

    page.locator('.report-panel summary').click()
    old={'formatVersion':1,'projectId':previous['id'],'intentId':previous['intentId'],'baseRevision':1,'claims':[{'requirementId':'r1','note':'old report'}],'nextSteps':[]}
    page.get_by_label('AI devam raporu',exact=True).fill(json.dumps(old))
    page.get_by_role('button',name='Beyanları ekle').click()
    expect(page.locator('#notice')).to_contain_text('eski veya farklı')
    expect(first.locator('.status')).to_have_text('Yeniden incele')

    packet=page.locator('#handoff-preview').input_value()
    current_template=json.loads(packet.split('```json\n')[-1].split('\n```')[0])
    current={**old,'intentId':current_template['intentId'],'baseRevision':2,'claims':[{'requirementId':'r1','note':'Duyuru taslağı hazır.'}]}
    page.get_by_label('AI devam raporu',exact=True).fill('```json\n'+json.dumps(current)+'\n```')
    page.get_by_role('button',name='Beyanları ekle').click()
    expect(first.locator('.status')).to_have_text('AI bildirdi')
    first.get_by_role('button',name='Dosyayı ve maddeyi inceledim').click()
    page.get_by_role('button',name='Devam paketini kopyala').click()
    expect(page.locator('#notice')).to_contain_text('kopyalandı')
    copied=page.evaluate('navigator.clipboard.readText()')
    assert 'Yalnızca taslak hazırla.' in copied and 'İstek sürümü: 2' in copied
    assert 'Dosya içeriği bu pakette yoktur.' in copied

    with page.expect_download() as event:
        page.get_by_role('button',name='Kaydı indir').click()
    saved=output/'reviewed.devam.json'
    event.value.save_as(saved)
    page.locator('#project-file').set_input_files(saved)
    expect(first.locator('.status')).to_have_text('Yeniden incele')
    expect(page.locator('#project-title')).to_have_text('Atölye duyurusu')

    page.get_by_role('button',name='AI ile kodlama').click()
    expect(page.locator('#project-title')).to_have_text('CSV dışa aktarması')
    page.get_by_role('button',name='AI uygulamaları').click()
    expect(page.locator('#project-title')).to_have_text('Araç çağrısı sınırı')
    page.screenshot(path=str(output/'desktop.png'),full_page=True)

    page.set_viewport_size({'width':390,'height':844})
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    page.get_by_role('button',name='+ Yeni çalışma',exact=True).click()
    page.get_by_label('Çalışma adı',exact=True).fill('Mobil çalışma')
    page.get_by_label('AI’den istediğin iş').fill('Verdiğim notları kullanarak kısa bir etkinlik özeti hazırla.')
    page.get_by_label('İş maddeleri').fill('En fazla üç madde olsun.\nEksik tarihleri uydurma.')
    page.get_by_role('button',name='Güncel isteği kaydet').click()
    expect(page.locator('.requirement')).to_have_count(2)
    page.screenshot(path=str(output/'mobile.png'),full_page=True)
    assert not page.evaluate('document.documentElement.scrollWidth > innerWidth')
    assert errors==[], errors
    assert all(url.startswith(base_url) for url in requests), requests
    (output/'acceptance.json').write_text(json.dumps({'passed':True,'browserErrors':errors,'requestsStayLocal':True,'viewportWidths':[1440,390],'flows':['claim-not-review','escaped-input','local-file-hash','review-persistence','changed-file-invalidates','changed-request-invalidates','stale-report-refused','current-report','clipboard','portable-export-import','three-audiences','mobile-new-project']},indent=2),encoding='utf-8')
    print('PASS: 12 browser flows; no browser errors, external requests, or horizontal overflow.')
    browser.close()
