# Ekran + Kamera Kurgu Masası

Ekran kaydını ve kamera kaydını tek bir videoda birleştiren bir video düzenleyici: tarayıcıda, Windows ve Mac'te,
Android'de, iPhone ve iPad'de çalışır.
Ekranı ve kamerayı editörün kendisiyle aynı anda kaydedebilir ya da hazır iki kaydı açabilirsiniz.
Ekran kaydı arka planda tam ekran oynar. Kamera kaydı onun üstünde, istediğiniz yere taşıyıp
istediğiniz boyuta getirebildiğiniz bir pencere olarak durur. İki kayıt farklı anlarda başladıysa editör
seslerini dinleyip onları kendisi eşler. Sonuç MP4 ya da WebM olarak kaydedilir.

Videolarınız hiçbir sunucuya yüklenmez; her şey kendi bilgisayarınızda, tarayıcının içinde işlenir.

## Özellikler

- **Ekran ve kamera kaydı:** üst çubuktaki **Kayıt** düğmesiyle ekranı (ya da bir pencereyi) ve kamerayı aynı anda
  kaydedin. Kamera, mikrofon ve isterseniz bilgisayarın sesi seçilir; kayıt duraklatılabilir. Ekran ve kamera ayrı
  dosyalara, aynı saate göre kaydedilir: bitirince ikisi de editöre yüklenir ve kamera, sesten eşlemeye gerek
  kalmadan hizalanır. Kayıtlar kaydedilirken tarayıcının diske ayırdığı alana yazılır, bu yüzden uzun kayıtlar
  belleği doldurmaz; ham dosyaları **İndir** düğmesiyle ayrıca saklayabilirsiniz.
- **Kamera penceresini taşıma:** fareyle (ya da parmakla) sürükleyin. Kenarlara, güvenli alan
  çizgilerine ve ortaya yaklaşınca mıknatıs gibi yapışır (Alt tuşu yapışmayı kapatır). Dokuz hazır konum da var.
- **Büyütme ve küçültme:** köşeden çekince oran korunur (Shift ile serbest), kenardan çekince pencerenin
  şekli değişir; görüntü bozulmaz, kırpılır. Fare tekerleği, boyut kaydırıcısı ve `+` / `−` tuşları da çalışır.
- **Görünüm:** dikdörtgen, yuvarlak köşe ya da daire; çerçeve kalınlığı ve rengi, gölge, ayna görüntüsü.
- **Otomatik senkron:** iki kayıt yüklenince editör seslerini dinler ve kamera kaydını ekran kaydıyla kendisi
  hizalar. Konuşmanız, bir el çırpması ya da tuş sesleri yeter. Senkron kartında eşleşen anı iki ses dalgası
  olarak görürsünüz; sonuç tek tıkla geri alınır. Editör emin olamazsa hiçbir şeyi değiştirmez, yalnızca öneri sunar.
- **Elle senkron:** kamera kaydını saniye saniye kaydırın ya da zaman çizelgesindeki kamera klibini sürükleyin.
- **Kesme:** başlangıç ve bitiş noktalarını seçerek yalnızca istediğiniz bölümü dışa aktarın.
- **Ses:** iki kaydın sesi ayrı ayrı açılıp kısılabilir; dışa aktarırken karıştırılır.
- **Geri al / yinele** ve klavye kısayolları.
- **Hızlı dışa aktarma:** WebCodecs destekleyen tarayıcılarda video, gerçek süresinden hızlı işlenir.
  Chrome ve Edge'de dosya doğrudan seçtiğiniz konuma yazılır, bu yüzden uzun kayıtlar belleği doldurmaz.
- Telefonla çekilmiş dikey ya da döndürülmüş videolar doğru yönde görünür.

## Nasıl açılır

- **Masaüstü uygulaması:** Windows ve Mac için kurulum dosyaları aşağıdaki
  [Masaüstü uygulaması](#masaüstü-uygulaması) bölümünde.
- **Telefon ve tablet:** Android uygulaması ve iPhone/iPad için ana ekran uygulaması aşağıdaki
  [Telefon ve tablet](#telefon-ve-tablet) bölümünde.
- **En kolayı:** `editor.html` dosyasına çift tıklayın. Chrome ya da Edge önerilir.
  `index.html` ürünün tanıtım sitesidir; oradaki **Editörü aç** düğmesi de editöre götürür.
- **Tek dosya:** `npm run build` komutu `dist/ekran-kamera-kurgu.html` dosyasını üretir. Bu dosya her yere
  kopyalanabilir ve internet bağlantısı olmadan çalışır.
- **Yerel sunucu ya da GitHub Pages:** depo kökünü olduğu gibi yayınlamanız yeterli
  (ör. `python3 -m http.server` → `http://localhost:8000`).
- **iPhone ve iPad:** Dosyalar uygulamasından açılan HTML dosyası çalışmaz, uygulamayı bir web adresinden açın.
  GitHub Pages bunun için yeterli: depo ayarlarında **Pages** bölümünde kaynak olarak `main` dalını ve `/ (root)`
  klasörünü seçin; birkaç dakika sonra uygulama `https://<kullanıcı-adı>.github.io/<depo-adı>/` adresinde açılır.
  Site bir web adresinden açıldığında kurulabilir bir uygulamadır (`manifest.webmanifest`, `sw.js`): bir kez
  açıldıktan sonra internetsiz de çalışır.

## Masaüstü uygulaması

Editör, Windows ve Mac için uygulama olarak da var. Aynı editördür; internet olmadan açılır, kendi penceresinde
çalışır ve kendi kodlayıcılarıyla geldiği için dışa aktarmayı her bilgisayarda hızlı yoldan yapar.

Uygulamada ekran ve kamera kaydı da var. Windows'ta kaydedilecek ekranı ya da pencereyi uygulamanın kendi
listesinden seçersiniz ve bilgisayarın sesi de kaydedilebilir; macOS 15 ve sonrasında sistemin kendi seçicisi
açılır. Kayıt sürerken pencere isterseniz küçülür; kaydı menü çubuğundaki (Windows'ta görev çubuğunun sağındaki)
kırmızı simgeden duraklatır ya da bitirirsiniz. Mac'te ilk kayıtta kamera, mikrofon ve **Ekran ve Sistem Sesi
Kaydı** izinleri istenir; ekran kaydı izni verildikten sonra uygulamayı bir kez kapatıp açmak gerekir.

- **Windows 10 ve 11 (64 bit):** [Kurgu-Masasi-Windows.exe](https://github.com/bayramavci46/ekran0/releases/latest/download/Kurgu-Masasi-Windows.exe).
  Tek tıkla kurulur, yönetici izni istemez.
- **macOS 12 ve sonrası (Apple Silicon ve Intel):** [Kurgu-Masasi-Mac.dmg](https://github.com/bayramavci46/ekran0/releases/latest/download/Kurgu-Masasi-Mac.dmg).
  Açın ve uygulamayı Uygulamalar klasörüne sürükleyin.

Uygulama henüz bir geliştirici sertifikasıyla imzalanmadığı için ilk açılışta sistem uyarır:

- **Windows:** "Windows kişisel bilgisayarınızı korudu" penceresinde **Ek bilgi**, sonra **Yine de çalıştır**.
- **Mac:** "açılmadı" uyarısı çıkarsa **Sistem Ayarları → Gizlilik ve Güvenlik** bölümünde **Yine de Aç**.

Bu uyarıları kaldırmak için Windows'ta bir kod imzalama sertifikası, Mac'te Apple Developer Programı üyeliği
(Developer ID ile imzalama ve notarization) gerekir. İkisi de derleme iş akışına sonradan eklenebilir.

## Telefon ve tablet

- **Android 7 ve sonrası:** [Kurgu-Masasi-Android.apk](https://github.com/bayramavci46/ekran0/releases/latest/download/Kurgu-Masasi-Android.apk).
  İndirilen dosyayı açın; telefon izin isterse bu kaynaktan yüklemeye izin verin (uygulama henüz Google Play'de
  olmadığı için bu izin bir kez istenir).
- **iPhone ve iPad (iOS 16 ve sonrası):** editörü Safari'de web adresinden açın (bkz. GitHub Pages yukarıda),
  **Paylaş → Ana Ekrana Ekle**'ye dokunun. Kurgu Masası ana ekranda kendi simgesiyle, uygulama gibi ve internetsiz
  açılır. Sürüm sayfasında imzasız bir `Kurgu-Masasi-iOS.ipa` da vardır; AltStore ya da Sideloadly gibi araçlarla
  kendi Apple kimliğinizle imzalanıp yüklenebilir. App Store için Apple Developer Programı üyeliği gerekir.

Telefon uygulaması aynı editördür. Ekranı telefonun kendi ekran kaydıyla, kendinizi kamerayla kaydedip iki
videoyu açarsınız (dikey çekilmiş videolar doğru yönde görünür); editör onları sesten eşler. Bitirdiğiniz video
**Kaydet ya da paylaş** düğmesiyle sistemin paylaşım menüsüne gider: Fotoğraflar'a, Galeri'ye, Dosyalar'a ya da
başka bir uygulamaya. Uzun videolar dışa aktarılırken belleğe değil cihazın deposuna yazılır. Android'de geri tuşu
önce açık paneli kapatır.

## Kullanım

1. Üst çubuktaki **Kayıt** düğmesine basın (ya da `R`): kamerayı ve mikrofonu seçin, **Kaydı başlat**'a basıp
   kaydedilecek ekranı ya da pencereyi seçin. Bitirince iki kayıt da editöre gelir. Hazır kayıtlarınız varsa
   sağdaki **Kayıtlar** bölümünden seçin ya da dosyaları sayfaya sürükleyip bırakın. Yanlış yere yüklediyseniz
   **Yerlerini değiştir** düğmesine basın.
2. Önizlemedeki kamera penceresini sürükleyerek taşıyın, köşelerinden çekerek büyütüp küçültün.
3. Kayıtlar aynı anda başlamadıysa editör iki kaydın sesinden kaydırmayı kendisi bulur ve uygular (**Senkron**
   kartındaki anahtarla kapatılabilir). İnce ayar için kamera klibini zaman çizelgesinde sürükleyin ya da
   Senkron kartındaki düğmeleri kullanın. Kayda başlarken bir kez el çırpmak eşlemeyi kolaylaştırır.
4. Videonun başını ve sonunu kırpmak için oynatma konumunu ayarlayıp `I` (başlangıç) ve `O` (bitiş) tuşlarına basın
   ya da zaman çizelgesindeki `[` `]` işaretlerini sürükleyin.
5. **Dışa aktar** bölümünden çözünürlük, kare hızı, kalite ve biçimi seçip **Videoyu dışa aktar** düğmesine basın.

## Klavye kısayolları

| Tuş | İşlev |
| --- | --- |
| `Boşluk` | Oynat / duraklat |
| `←` `→` ya da `,` `.` | Bir kare geri / ileri |
| `Shift` + `←` `→` | 1 saniye geri / ileri |
| `I` / `O` | Başlangıç / bitiş noktasını buraya koy |
| `Home` / `End` | Başlangıç / bitiş noktasına git |
| Kamera seçiliyken ok tuşları | Kamerayı taşı (Shift ile daha hızlı) |
| Kamera seçiliyken `+` / `−` | Kamerayı büyüt / küçült |
| `Ctrl` + `Z` / `Ctrl` + `Shift` + `Z` | Geri al / yinele |
| `R` | Ekranı ve kamerayı kaydet |
| `?` | Kısayol listesini aç |

## Tarayıcı desteği

- **Chrome ve Edge (Windows, macOS):** hızlı dışa aktarma, MP4 (H.264 + AAC). En iyi deneyim bunlarda.
- **Safari (Mac, iPhone, iPad):** önizleme ve düzenleme çalışır. Yeni sürümlerde dışa aktarma da hızlı yöntemle yapılır;
  eski sürümlerde video gerçek zamanlı oynatılarak MP4 olarak kaydedilir. iPhone ve iPad, önizlemede ses düzeyinin
  değiştirilmesine izin vermez (yalnızca sesi kapatıp açabilirsiniz); seçtiğiniz düzey dışa aktarılan videoya uygulanır.
- **Diğer tarayıcılar:** uygulama, tarayıcının kodlayabildiği biçimi kendisi seçer ve **Biçim** menüsünde gösterir
  (ör. WebM: VP9 + Opus). Hızlı yöntem kullanılamıyorsa video gerçek zamanlı oynatılarak kaydedilir; bu
  sırada sekme açık ve görünür kalmalıdır.
- **Otomatik senkron** sesi çözebilen her tarayıcıda çalışır: Chrome, Edge, Firefox ve Safari 26 ve sonrası
  WebCodecs ile; daha eski Safari sürümleri Web Audio ile.
- **Ekran ve kamera kaydı**, ekran paylaşımı ve WebCodecs olan bilgisayar tarayıcılarında açılır: Chrome ve Edge'de
  denendi; Firefox'un ve Safari 26'nın güncel sürümlerinde de gereken özellikler var. Tarayıcı bunları desteklemiyorsa
  **Kayıt** düğmesi görünmez. Telefonlarda tarayıcılar ekran kaydına izin vermez. Bilgisayarın sesi Chrome ve Edge'de
  paylaşım penceresindeki ses kutusuyla eklenir; macOS'ta tarayıcılar çoğunlukla yalnızca bir sekmenin sesini verir.
- Tarayıcının oynatamadığı dosyalar (ör. bazı MKV ya da H.265 kayıtları) açılmaz; bu durumda kaydı MP4 (H.264)
  ya da WebM olarak dışa aktarıp yeniden deneyin.

## Geliştirme

Web sürümünün derleme adımı ve bağımlılığı yoktur; dosyalar doğrudan tarayıcıda çalışır. Masaüstü uygulaması
`desktop/`, telefon uygulaması `mobile/` klasöründe ayrı birer npm projesidir.

```
index.html            tanıtım sitesi
site/                 sitenin kendi görünümü (site.css) ve küçük canlı demoları (site/js)
editor.html           editörün arayüzü
css/base.css          ortak tasarım sistemi: renkler, yazılar, hareket ve bileşenler; site ile editör birlikte kullanır
css/app.css           editörün yerleşimi (açık ve koyu tema)
js/ui.js              ortak arayüz parçaları: kayan seçici, açılır panel, çekmece, bildirim, akordeon
js/geometry.js        kamera penceresi hesapları: taşıma, boyutlandırma, yapışma, kırpma
js/renderer.js        bir kareyi çizer; önizleme ve dışa aktarma aynı kodu kullanır
js/player.js          iki videoyu birlikte oynatır ve senkron tutar
js/stage.js           önizlemedeki kamera penceresiyle etkileşim
js/timeline.js        zaman çizelgesi: oynatma konumu, kesme işaretleri, kamera klibi
js/audio-mix.js       dışa aktarmada iki sesi yeniden örnekleyip karıştırır
js/auto-sync.js       otomatik senkron: iki kaydın sesinden ne kadar kaydığını bulur
js/export.js          dışa aktarma: hızlı yol (Mediabunny + WebCodecs) ve gerçek zamanlı yedek yol
js/recorder.js        ekran ve kamera kaydı: iki dosya, ortak saat, diske yazarak (Mediabunny + WebCodecs)
js/record-panel.js    kayıt paneli: kamera ve mikrofon seçimi, önizleme, süre, duraklatma, masaüstü seçicisi
js/demo.js            hiç kayıt yüklenmemişken gösterilen örnek görüntü
js/app.js             durum, kontroller, geri al/yinele, tercihler
js/native.js          telefon uygulamasında: paylaşım menüsü, Android'in geri tuşu
js/offline.js, sw.js  kurulabilir web uygulaması: internetsiz açılış (manifest.webmanifest, icons/)
vendor/               Mediabunny 1.60.0 (MPL-2.0, lisans metni klasörde)
scripts/              tek dosyalık sürüm ve editörü uygulamalara kopyalayan ortak betik (bundle-app.mjs)
desktop/              masaüstü uygulaması (Electron): pencere, menüler, kurulum ayarları, simge
mobile/               telefon uygulaması (Capacitor): Android ve iOS projeleri, simgeler, imza anahtarı, uygulama içi deneme
.github/workflows/    bütün uygulamaları derleyip deneyen ve yayımlayan iş akışı (apps.yml)
```

- `npm test` — birim testleri (Node 18 ve üzeri), otomatik senkron için yankılı, gürültülü ve farklı
  örnekleme hızlı sentetik kayıtlar dahil.
- `npm run test:e2e` — gerçek tarayıcıda uçtan uca deneme: aynı sesi duyan iki örnek video üretir, otomatik
  senkronun kaydırmayı bulduğunu denetler, kamerayı taşır ve boyutlandırır, dışa aktarır ve sonucu `ffprobe` ile
  denetler; sonra Chromium'un sahte ekranı, kamerası ve mikrofonuyla duraklatmalı bir kayıt yapıp iki dosyanın
  editöre hizalı geldiğini denetler. ffmpeg ve Playwright gerektirir.
- `npm run build` — tek dosyalık sürüm (`--cdn` ile Mediabunny'yi jsDelivr'den yükleyen küçük sürüm).

### Masaüstü uygulamasını derlemek

```
cd desktop
npm install
npm start          # uygulamayı açar
npm run dist       # bu işletim sistemi için kurulum dosyası, desktop/dist içine
npm run smoke      # paketlenmiş uygulamayı açıp denetler
```

`npm run dist` önce editörü `desktop/app` içine kopyalar: yazı tipleri uygulamaya gömülür ve sayfa yalnızca kendi
dosyalarını yükleyebilir. `npm run smoke`, paketlenmiş uygulamayı gizli olarak açar; bilgisayarın kendi
kodlayıcılarıyla iki deneme kaydı üretir, otomatik senkronu çalıştırır, iki saniyelik bir dışa aktarma yapar ve
editörün kaydedicisiyle çizilmiş bir ekran ile kamera görüntüsünü kaydeder.

### Telefon uygulamasını derlemek

```
cd mobile
npm install
npm run sync                     # editörü mobile/www içine kopyalar, Android ve iOS projelerine aktarır
npx cap open android             # Android Studio'da açar (Android SDK gerekir)
npx cap open ios                 # Xcode'da açar (Mac gerekir)
```

`node scripts/copy-app.mjs --smoke` ile hazırlanan deneme sürümü açıldığında kendini dener: iki deneme videosunu
(biri telefon gibi dikey) açar, otomatik senkronu bekler, iki saniye dışa aktarır ve sonucu paylaşım için cihaza
yazar; sonuçları uygulama günlüğüne basar. `node scripts/smoke-device.mjs android|ios <uygulama>` bu sürümü
Android öykünücüsünde ya da iOS simülatöründe açıp sonuçları okur. Simgeler `mobile/assets` içindeki SVG'lerden
`node scripts/make-icons.mjs` ile üretilir.

Android sürümleri `mobile/signing/kurgu-masasi.p12` anahtarıyla imzalanır; parolası depoda değil, GitHub'da
`ANDROID_KEYSTORE_PASSWORD` adlı bir gizli değer olarak durur (bkz. `mobile/signing/README.md`). iOS uygulaması
imzasız derlenir; App Store ya da TestFlight için Apple Developer Programı üyeliği ve imza ayarları gerekir.

### Sürüm yayımlamak

`desktop/package.json` ve `mobile/package.json` içindeki sürümü artırın ve `v` ile başlayan bir etiket gönderin
(ör. `git tag v1.2.1 && git push origin v1.2.1`) ya da GitHub'da **Actions → Uygulamalar → Run workflow** ile sürüm
numarasını yazarak çalıştırın. GitHub Actions Windows ve Mac kurulum dosyalarını, Android uygulamasını ve iOS
uygulamasını derler; her birini açıp dener (Android'i öykünücüde, iOS'u simülatörde) ve hepsini tek bir sürüm
olarak yayımlar. Sürüm notları `.github/release-notes.md` dosyasından gelir. Sitedeki indirme bağlantıları her zaman
en son sürümü indirir.
