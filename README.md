# Ekran + Kamera Kurgu Masası

Ekran kaydını ve kamera kaydını tek bir videoda birleştiren, tarayıcıda çalışan bir video düzenleyici.
Ekran kaydı arka planda tam ekran oynar. Kamera kaydı onun üstünde, istediğiniz yere taşıyıp
istediğiniz boyuta getirebildiğiniz bir pencere olarak durur. İki kayıt farklı anlarda başladıysa editör
seslerini dinleyip onları kendisi eşler. Sonuç MP4 ya da WebM olarak kaydedilir.

Videolarınız hiçbir sunucuya yüklenmez; her şey kendi bilgisayarınızda, tarayıcının içinde işlenir.

## Özellikler

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

- **En kolayı:** `editor.html` dosyasına çift tıklayın. Chrome ya da Edge önerilir.
  `index.html` ürünün tanıtım sitesidir; oradaki **Editörü aç** düğmesi de editöre götürür.
- **Tek dosya:** `npm run build` komutu `dist/ekran-kamera-kurgu.html` dosyasını üretir. Bu dosya her yere
  kopyalanabilir ve internet bağlantısı olmadan çalışır.
- **Yerel sunucu ya da GitHub Pages:** depo kökünü olduğu gibi yayınlamanız yeterli
  (ör. `python3 -m http.server` → `http://localhost:8000`).
- **iPhone ve iPad:** Dosyalar uygulamasından açılan HTML dosyası çalışmaz, uygulamayı bir web adresinden açın.
  GitHub Pages bunun için yeterli: depo ayarlarında **Pages** bölümünde kaynak olarak `main` dalını ve `/ (root)`
  klasörünü seçin; birkaç dakika sonra uygulama `https://<kullanıcı-adı>.github.io/<depo-adı>/` adresinde açılır.

## Kullanım

1. Sağdaki **Kayıtlar** bölümünden ekran kaydını ve kamera kaydını seçin ya da dosyaları sayfaya sürükleyip bırakın.
   Yanlış yere yüklediyseniz **Yerlerini değiştir** düğmesine basın.
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
- Tarayıcının oynatamadığı dosyalar (ör. bazı MKV ya da H.265 kayıtları) açılmaz; bu durumda kaydı MP4 (H.264)
  ya da WebM olarak dışa aktarıp yeniden deneyin.

## Geliştirme

Derleme adımı ve bağımlılık yoktur; dosyalar doğrudan tarayıcıda çalışır.

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
js/demo.js            hiç kayıt yüklenmemişken gösterilen örnek görüntü
js/app.js             durum, kontroller, geri al/yinele, tercihler
vendor/               Mediabunny 1.60.0 (MPL-2.0, lisans metni klasörde)
```

- `npm test` — birim testleri (Node 18 ve üzeri), otomatik senkron için yankılı, gürültülü ve farklı
  örnekleme hızlı sentetik kayıtlar dahil.
- `npm run test:e2e` — gerçek tarayıcıda uçtan uca deneme: aynı sesi duyan iki örnek video üretir, otomatik
  senkronun kaydırmayı bulduğunu denetler, kamerayı taşır ve boyutlandırır, dışa aktarır ve sonucu `ffprobe` ile
  denetler. ffmpeg ve Playwright gerektirir.
- `npm run build` — tek dosyalık sürüm (`--cdn` ile Mediabunny'yi jsDelivr'den yükleyen küçük sürüm).
