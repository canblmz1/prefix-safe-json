# PSJ: kullanıcı kazanımı ve bakım yol haritası

Tarih: **22 Ekim 2026**. İlk değerlendirme dönemi: **22 Ekim–21 Kasım 2026**.
Dayanak: [devam/arşiv kararı](ADOPTION_DIAGNOSIS.md#october-22-2026-continue-or-archive)
ve [mevcut pilot kaydı](ADOPTION_PILOTS.md).

## Hedef ve başlangıç

| Ölçüt | Doğrulanmış başlangıç | Hedef |
| --- | --- | --- |
| Core, tamamlanmış son 30 UTC günündeki npm indirmeleri | 22 Eylül–21 Ekim: **3.153** | Uzun vadede **200.000**; yaklaşık 63,4 kat büyüme. Henüz tarihli büyüme tahmini yok |
| Bağımsız proje | Bir tarihî Sandbase entegrasyonu; kampanyada sıfır yeni doğrulanmış proje | Core veya companion için toplam **beş bağımsız, sürdürülen entegrasyon**; aynı proje bir kez sayılır |
| 30 günlük karar eşiği | Henüz karşılanmadı | En az bir **yeni** bağımsız projenin kendi uygulamasında çalıştırması ve gerekçeli tutma kararı |
| Companion indirmeleri | API 404; registry'de 0.3.2 mevcut | Ayrı ölçülür; veri yokluğu sıfır sayılmaz |

İncelenen main: `deab898cf4eb96fa7600ef37926e3ceaddcadb77`.
Core 0.6.3 / companion 0.3.2 yayımlanmış ve mevcut yayın kanıtları hazır.
Bu işleri yeniden bir yayın hazırlığına çevirmeyeceğiz. Bu belge bir plandır;
aşağıdaki gelecek görevler yapılmış veya kontrolleri geçmiş sayılmaz.

## Çalışma düzeni

- Teknik yürütücü: mevcut paketin bakımı, pilotun küçük diff'i, doğrulama ve kanıt kaydı.
- Somut bir diff olduğunda en fazla iki alt ajan: biri doğruluk ve adil native
  karşılaştırma incelemesi, diğeri izole kurulum ve ilgili test doğrulaması.
- Aynı anda **bir aktif entegrasyon diff'i**. Diğer bakımcı yanıtları sırada
  değerlendirilir; yanıtsız bir teklif aktif kodlama işini bloke etmez.
- Rutin efor sınırı: haftada iki 60 dakikalık pilot/kanıt bloğu ve 30 dakikalık
  bakım gözden geçirmesi. Doğrulanmış bir correctness düzeltmesinin kapsamı
  ayrıca belirlenir. Bu bir çalışma bütçesidir; yeni arka plan otomasyonu kurulmaz.
- Mevcut araçlar ve takip dosyaları kullanılır. Yeni CRM, demo altyapısı,
  benchmark veya talep kanıtı olmayan adapter ailesi açılmaz.
- İnceleme, yerel değişiklik ve gerekli testler teknik yürütücüde kalır.
  Merge Kübra'nın kararındadır. Yayın, dış mesaj, dış repoya PR ve gerçek
  archive/deprecation işlemi için ilgili açık yetki somut çıktı hazırken kontrol edilir.
  Onaylanan üç mesaj zaten gönderildi; bu onay yeni hatırlatmaları kapsamaz.

## 1. Aşama — 22–25 Ekim: bakım ve takip temelini tamamla

### T1 — Yeni temasların takip diff'ini incelemeye hazırla

- Dosyalar: `.github/adoption-watch.json`, `docs/ADOPTION_PILOTS.md`;
  mevcut watcher: `scripts/watch-adoption.mjs`.
- Çıktı: Kept #183 ve AgentKit #73 için mevcut yerel iki takip girdisi,
  gönderim bağlantıları ve doğru yanıt sınıfları. Sandbase mevcut kullanıcıdır.
- Önce #90'ın güncel diff'ini incele; uygunsa aynı PR üzerinden ilerle.
  Mevcut kayıtları koru ve aynı iş için yinelenen PR açma.
- Kabul: her konu bir kez izlenir; Kept'in nested replies yanıtları kapsanır;
  AgentKit #73'ün #74 nedeniyle kapanması PSJ kabulü/reddi sayılmaz.
- Doğrulama: `node --test test/scripts/adoption-watch.test.mjs`, ilgili
  konular üzerinde read-only watcher ve `git diff --check`. API hatası
  başarısız kontrol olarak kaydedilir. Birleşirse ilk gerçek schedule koşusu
  üzerinden main kapsamı doğrulanır; birleşene kadar iki yeni konu elle kontrol edilir.
- Bağımlılık: yok. Merge izni bu görevde varsayılmaz.

### T2 — Teknik bakım kuyruğunu daralt

- Kayıtlar: GitHub issues/PR'lar, `docs/ADOPTION_DIAGNOSIS.md`,
  `docs/COMPATIBILITY.md`, `packages/ai-sdk/README.md`.
- Çıktı: yalnız yeniden üretilmiş hata, mevcut kullanıcı engeli ve kanıtlanmış
  SDK/provider regresyonundan oluşan öncelik sırası. Geçerli sürüm pinleri korunur.
- #90 ve #93'ün native eşitlik sonuçları değerlendirme kaydında görünür kalır.
  Core 0.6.3 için tamamlanmış release testleri yeniden görev yapılmaz.
- Kabul: her teknik işin reproducer veya bakımcı kaynak bağlantısı, etkilenen
  desteklenen akışı ve ilgili doğrulama komutu vardır.
- Doğrulama: kaynak/kanıt incelemesi; gerçek değişiklik yoksa geniş test koşusu yok.
- Bağımlılık: yok; T1 ile ayrı dosyalarda paralel değerlendirilebilir.

25 Ekim çıktısı: incelenebilir takip diff'i ve somut bakım kuyruğu.
Bakımcı yanıtı gelmemesi bu iki teknik çıktının tamamlanmasını engellemez.

## 2. Aşama — 26 Ekim–1 Kasım: bir gönüllü pilot seç

### T3 — Mevcut tekliflerden tek akış ve kabul ölçütü belirle

| Mevcut aday | Seçilebilecek küçük iş | Başlamadan gerekli kanıt |
| --- | --- | --- |
| localmd #1 | Companion 0.3.2 ile mevcut dokuz geliştirme testi ve typecheck | Bakımcının SDK yükseltmelerinde bu kontrolü değerlendirmeyi istemesi |
| Kept #183 | `update_thing` argümanlarının proposal kaydından önce değerlendirilmesi | Duplicate-member politikasının bakımcı tarafından istenmesi; mevcut onay/hash/replay akışı korunur |
| AgentKit #73 | `save_memory` için gerçek kayıt ve devam davranışı | Bakımcının seçtiği mevcut SDK adayı; Responses yolunda core kullanımı, mevcut Redis test kapsamı |
| AgentUse #25 | Mevcut raw-batch/Code Mode geliştirme karşılaştırması | Dar testin istenmesi; önceden kaydedilmiş genel approval test hataları ayrıca belirtilir |
| Phoronis #12 | Provider yükseltmesinde özgün çağrı kimliği regresyonu | Bakımcının bu upgrade kontrolüne ihtiyacını doğrulaması; mevcut admin kontrolü korunur |

Sandbase #965 ayrı bir bakım/tercih görüşmesidir. #93 eşitlik sonucuna göre
PSJ'yi veya küçük native kontrolü seçmeleri kabul edilir; yeniden deneme istenmez.

- Çıktı: seçilen akış, kilitli SDK/provider sürümleri, yayımlanmış PSJ sürümü,
  sağlıklı kontrol, anlamlı ret politikası ve keep/remove sorusu mevcut pilot kaydına yazılır.
- Kabul: somut akış bakımcı tarafından seçilmiştir. Sessizlik onay değildir.
- Bağımlılık: bakımcı yanıtı. Yanıt yoksa entegrasyon kodlaması başlamaz;
  T1/T2 ve diğer mevcut adayların değerlendirilmesi ilerler.

### T4 — Gerekirse tek, küçük ek teklif paketi hazırla

- Koşul: 1 Kasım'da hâlâ istekli pilot yoksa mevcut tekliflerin uyumunu ve
  ilk engellerini gözden geçir. Sessizliği ret diye sınıflandırma.
- En fazla iki ek hedef ancak güncel bir issue/kaynakta somut ham-kanıt
  ihtiyacı ve mevcut API ile yürütmeden önce entegrasyon uyumu gösterilirse seçilir.
  Sayıyı doldurmak için aday eklenmez; geniş repo taraması açılmaz.
- Çıktı: proje kaynağı, küçük native alternatif, tek pilot, tam adres ve kısa
  mesaj mevcut kayıtta hazırlanır. Dış gönderim için tek somut onay paketi sunulur.
- Kabul: eski davet yinelenmez, olumsuz yanıt verene tekrar gidilmez ve
  yeni aday 21 Kasım karar tarihini kendiliğinden uzatmaz.
- Doğrulama: güncel önceki-temas kontrolü ve kaynak incelemesi. İlk temas
  öncesi bütün adaylara entegrasyon kodlanmaz.
- Bağımlılık: T3'ün 1 Kasım durum kaydı; gönüllü pilot varsa bu iş açılmaz.

## 3. Aşama — 2–8 Kasım: seçilen pilotu teslim et

### T5 — En küçük uygulama diff'ini hazırla

- Konum: bakımcının seçtiği repo ve mevcut uygun pilot dalı/PR'ı. Örneğin
  localmd'de `src/agent/run.test.ts`, `src/agent/tool-stream-regression.test.ts`,
  `src/agent/tool-stream-recording.test.ts`; Kept'te mevcut assistant testleri;
  AgentKit'te `packages/ai-sdk/src/memory.test.ts` çevresindeki dar test akışı.
- Girdi: T3'ün kabul edilmiş akışı. Aynı fixture, SDK sürümü ve uygulama
  kontrolleriyle native, makul küçük native kontrol ve PSJ değerlendirilir.
- Çıktı: tek review edilebilir diff ve kısa kurulum/test talimatı. Bağımlılık
  değişirse manifest ve lock birlikte güncellenir; temiz kurulumda peer denetimi korunur.
- Kabul: sağlıklı input/result kimliği ve continuation korunur. Rette
  beklenmeyen yan etki oluşmaz. Onaylı/persist edilen uygulamada kayıt argümanı,
  onay öncesi/sonrası gerçek yazma ve tekrar onay ayrıca ölçülür.
- Doğrulama: mevcut ilgili testler ve proje typecheck'i; gerekli repo kontrolleri.
  Alt ajanlar doğruluk/adillik ve kurulum doğrulamasını ayrı yürütür.
- Native aynı politikayı karşılıyorsa eşit sonuç yazılır. PSJ lehine sonuç
  bulmak için yeni senaryolar veya daraltılmış native kontroller eklenmez.
- Bağımlılık: T3. Dış PR izni gerekiyorsa soru hazır diff ve sonuçlardan sonra gelir.

### T6 — Bağımsız değerlendirmeyi kaydet

- Çıktı: bakımcının kendi ortamındaki sürümler, çalıştırdığı komut, sonuç,
  ilk engel ve tutma/kaldırma gerekçesinin tarihli bağlantısı.
- Kabul: bizim koşumuzdan ayrı bir own-project run kanıtı vardır. Taslak PR,
  bizim CI veya yalnız olumlu ilgi mesajı kullanıcı kazanımı olarak yazılmaz.
- Doğrulama: bakımcı yorumu, bağımsız run veya kendi repo commit'i incelenir;
  kanıt yetersizse durum bekliyor kalır.
- Bağımlılık: T5'in teknik teslimi ve bağımsız bakımcının zamanı.

Bu tarihler dış yanıtların teslim garantisi değildir. T3/T6 beklerken yeni
özellik işi açılmaz; diğer mevcut adayların yanıtları ve gerçek bakım işleri izlenir.

## 4. Aşama — 9–21 Kasım: kullanım kararını doğrula

### T7 — Tutma kararını ve sonraki kullanımı ayır

- Dosya: `docs/ADOPTION_PILOTS.md`; doğrulanmış kanıt varsa mevcut watcher
  yapılandırmasındaki manuel kayıt da uygun sınıflamayla güncellenir.
- Çıktı: bağımsız çalıştırma, entegrasyonun kabulü, sonraki kullanım ve
  30 gün tutulma için ayrı tarihler. Core+companion aynı projede tek sayılır.
- Kabul: bir yeni projenin gerekçeli tutma kararı doğrulanmıştır. İlk
  kullanım Kasım'daysa 21 Kasım'da 30 günlük retention iddiası yapılmaz.
- Doğrulama: bağımlılık/entegrasyon commit'i, bakımcı yanıtı veya sonraki
  gerçek SDK yükseltmesindeki bağımsız kullanım. Bu sonraki kontrol için otomatik mesaj gönderilmez.
- Bağımlılık: T6. Bakımcı native kontrolü seçerse gerekçe negatif sonuç olarak kaydedilir.

### T8 — 21 Kasım kararını ver

| O günkü kanıt | Karar |
| --- | --- |
| En az bir yeni bağımsız own-project run ve gerekçeli tutma kararı | Dar büyüme çalışmasına devam; beş sürdürülen projeye ilerle, sonraki kullanım kanıtını topla |
| Yalnız bizim test/PR/CI, indirme artışı, ilgi veya yanıtsız teklifler | Eşik karşılanmadı; aktif kullanıcı kazanma ve özellik yatırımını durdur, bilinen kullanıcılara sınırlı bakım sürdür |
| Bilinen mevcut entegrasyonun da ihtiyacı kalmamış veya sürdürülebilir bakım sağlanamıyor | Archive/deprecation için ayrı, somut karar hazırla; işlem otomatik yapılmaz |

Çıktı: mevcut teşhis kaydında tek tarihli karar, açık bakım işleri ve gerçek
kanıt bağlantıları. Yeni projeyi saymadan önce kaydın bağımsızlığı kontrol edilir.
Bağımlılık: T1/T2 durumları ve elde edilebilen T3–T7 sonuçları; tüm bakımcıların
yanıt vermesi karar tarihinin önkoşulu değildir.

## Eşik geçilirse: beş projeden 200 bin indirmeye

Bu bölüm koşulludur; önceden verilmiş bir büyüme takvimi değildir.

1. Aynı küçük entegrasyon sürecini doğrulanmış ihtiyaçlarla beş bağımsız
   projeye taşı. Yeni API yalnız gerçek engel için açılır. Her proje için
   ilk kabul ve devam eden kullanım ayrı tutulur.
2. Gerçek entegrasyonu, bakımcının izniyle kurulabilir bir örnek ve kısa
   vaka çalışmasına dönüştür. Sonucu ve native alternatifin eşit kaldığı
   noktaları göster; sentetik vakayı production sıklığı gibi sunma.
3. İhtiyacın oluştuğu mevcut ekosistemde bir sürdürülen dağıtım yolu kur:
   bakımcının kabul ettiği dokümantasyon/örnek entegrasyonu veya gerçek
   bağımlı proje. Dış katkı/gönderim yetkisi somut içerikle ele alınır.
4. Core'un tamamlanmış 30 günlük npm penceresini haftalık kaydet; companion'ı
   ayrı izle. Proje sayısını, retention'ı ve indirmeyi ayrı raporla. Eksik API
   verisini doldurma; indirme artışını nedensellik kanıtı olmadan bir kanala bağlama.
5. Beş sürdürülen entegrasyon ve tekrar eden bir dağıtım sinyali oluşunca
   200 bin hedefinin zamanlamasını gerçek veriden yeniden değerlendir.
   Yapay install/CI döngüleri başarı ölçütünü karşılamaz.

## Riskler ve geri dönüş

| Risk | Uygulanacak davranış |
| --- | --- |
| Hiçbir bakımcı dönmez | T4'teki sınırlı seçenek ve 21 Kasım karar kapısı; sınırsız yeni tarama veya hatırlatma yok |
| İstenen akış mevcut adapter veya şema sözleşmesine uymaz | Önce native alternatif ve daha küçük desteklenen sınır değerlendirilir; pilot ihtiyacı olmadan yeni framework geliştirilmez |
| Temiz kurulum/test engeli çıkar | İlk anlamlı hata, ortam ve unchanged-source kontrolü kaydedilir; geçmiş gibi raporlanmaz |
| Küçük native çözüm eşit/tercih edilir | Gerçek sonuç korunur; kullanım gerekçesi yoksa paket dayatılmaz |
| Pilot yanlış ret veya sağlıklı akış bozulması üretir | Geliştirme diff'i geri alınır, mevcut uygulama kontrolleri korunur; gerçekleşmiş yan etkileri geri alma garantisi verilmez |
| Tracking diff'i henüz main'e girmemiştir | Canlı schedule kapsamı açıkça belirtilir ve yeni konular elle kontrol edilir |

Rollback: yalnız pilotun izole geliştirme değişikliğini kaldır; mevcut
üretim sağlayıcı döngüsünü ve uygulama korumalarını koru. Paket yayımlama,
koruma ayarı değişikliği ve archive bu planın kendiliğinden uyguladığı işler değildir.

Bu plan hazırlanırken kod değişikliği, dış gönderim veya yeni test koşusu yapılmadı.
