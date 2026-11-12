# Konser Modu — Sekme Yankı Efekti

Chrome'da açık bir sekmenin sesine **konser salonu yankısı** ekleyen, Manifest V3
tabanlı bir eklenti. Samsung Galaxy telefonlardaki *Concert Hall* (konser salonu)
efektinden esinlenmiştir; harici ses dosyası veya sunucu kullanmaz, tüm işlem
cihazın içinde gerçekleşir.

> **Önemli sınır:** Samsung'un efekti sistem genelinde çalışır. Chrome eklentileri
> ise sistem sesine erişemez. Bu eklenti yalnızca **seçtiğiniz sekmeyi** yakalayıp
> işler; diğer sekmelerin, oyunların veya masaüstü uygulamalarının sesine dokunmaz.

## Araştırma: Samsung "Concert Hall" nedir?

Samsung'un ses efektleri, uzun süredir müzik uygulamasında *SoundAlive* altında
sunulan bir **reverb** (yankı) simülasyonudur. "Concert hall" seçeneği, çalınan
sesi büyük bir konser salonunda dinleniyormuş gibi genişletir: doğrudan sesin
ardından gelen erken yansımalar ve saniyeler süren sönümlenen bir kuyruk ekler.
Yeni One UI sürümlerinde bu tür efektlere **Sound Assistant** üzerinden erişilir.

Bu eklenti aynı prensibi Web Audio API ile taklit eder:

- Ses, prosedürel olarak üretilen **stereo impuls yanıtı** (IR) ile convolution
  reverb'e sokulur.
- Erken yansımalar, gecikmeli ıslak ses ve frekans dengeli bir kuyruk eklenir.
- Samsung'un birebir kopyası değildir; kapalı formülü bilinmediği için benzer
  mekân hissi hedeflenmiştir. Samsung ve Concert Hall adları ilgili sahiplerine
  aittir.

## Özellikler

- Üç mekân: **Konser Salonu**, **Stadyum**, **Küçük Sahne**
- %0–100 arası **yankı yoğunluğu** kaydırıcısı; çalarken anlık güncellenir
- Popup kapansa bile efekt **arka planda** devam eder
- Etkin sekme kapatılınca yakalama otomatik biter ve ses normale döner
- Araç çubuğunda **ON** rozeti, klavye kısayolu: `Alt+Shift+C`
- Açık/koyu tema; ayarlar ve son durum hatırlanır
- Kayıt yapılmaz, veri dışarı gönderilmez; yalnızca `activeTab` erişimi kullanılır

## Kurulum

1. Chrome'da `chrome://extensions` adresini açın.
2. Sağ üstten **Geliştirici modu**nu açın.
3. **Paketlenmemiş öğe yükle** düğmesine tıklayın.
4. Bu eklentinin klasörünü seçin: `Projeler\konser-modu`
5. Araç çubuğundaki uzantı simgesine tıklayın. Simgeyi görmek için bulmaca
   düğmesinden **Konser Modu**nu sabitleyebilirsiniz.

Kod değiştirirseniz `chrome://extensions` sayfasındaki **Yenile** düğmesine
basmanız yeterlidir. Eklenti yeniden yüklenirse açık efekt kapanır.

## Kullanım

1. Ses çalan bir web sekmesi açın (YouTube, Spotify Web, radyo vb.).
2. Uzantı simgesine tıklayın.
3. Sağ üstteki güç düğmesine basın; sekme sesi yakalanır ve yankı devreye girer.
4. **Mekân** ve **Yankı yoğunluğu** ayarlarını canlı olarak değiştirebilirsiniz.
5. Durdurmak için güç düğmesine yeniden basın. Popup'ı kapatmanız efekti
   durdurmaz; arka planda çalmaya devam eder.

Efekt başka bir sekmede açıkken bu sekmeyi açtıysanız **Efekti bu sekmeye taşı**
düğmesi görünür. Bu durumda güç düğmesi de aynı işi yapar. Başka sekmedeki efekti
durdurmak için hedef satırındaki `×` düğmesini kullanabilirsiniz.

| Mekân | Yaklaşık kuyruk | Karakter |
| --- | --- | --- |
| Konser Salonu | 2,9 sn | Geniş ve sıcak; varsayılan |
| Stadyum | 4,1 sn | Uzun, güçlü, daha koyu |
| Küçük Sahne | 1,5 sn | Kısa, samimi, daha parlak |

`Alt+Shift+C` kısayolu, o an etkin sekmede efekti açar; efekt zaten açıksa kapatır.
Chrome'un kısayolları değiştirmesine izin veriyorsanız `chrome://extensions/shortcuts`
adresinden tuş birleşimini düzenleyebilirsiniz.

## Desteklenen ve desteklenmeyen sayfalar

| Sayfa türü | Destek |
| --- | --- |
| Normal `http://` ve `https://` siteleri | ✅ |
| Yerel `file://` medya (dosya erişimi izniyle) | ✅ / koşullu |
| `chrome://` iç sayfaları, `chrome-extension://` | ❌ |
| Chrome Web Store | ❌ |
| DRM korumalı bazı içerikler (ör. kimi Netflix yayınları) | ❌ veya sessiz |
| Diğer sekmeler ve masaüstü uygulamaları | ❌ (tasarım gereği) |

Chrome, yakalanan sekmenin sesini normal çıkıştan keser ve eklentiye verir. Eklenti
sesi efekten geçirip yeniden hoparlöre verdiği için çift ses duyulmaz. Yakalama
sırasında Chrome adres çubuğunda bir **yakalama göstergesi** görünür. Sekmeyi
kapatmak veya güç düğmesi yakalamayı bitirir; ses otomatik olarak normale döner.

## İzinler

| İzin | Neden |
| --- | --- |
| `activeTab` | Yalnızca kullanıcının tıkladığı sekmenin başlığına/adresine erişim ve o sekmeyi yakalama yetkisi. Tüm siteler için kalıcı erişim istemez. |
| `tabCapture` | Sekmenin ses akışını almak. |
| `offscreen` | MV3 servis çalışanı Web Audio çalıştıramadığı için ses grafiğini barındıran gizli belge. |
| `storage` | Mekân/yoğunluk ayarını ve oturum durumunu hatırlamak. |

`activeTab` sayesinde kurulumda "tüm sitelerdeki verilerinizi oku" uyarısı çıkmaz.
Eklentinin uzak sunucusu, analitiği veya reklamı yoktur.

## Nasıl çalışır?

```text
popup  ──mesaj──▶  service worker
                     │  chrome.tabCapture.getMediaStreamId()
                     ▼
              offscreen belgesi
                     │  getUserMedia({ chromeMediaSource: 'tab' })
                     ▼
   kaynak ─▶ kuru ses ───────────────────────────────┐
          └▶ ön gecikme ─▶ A/B convolver ─▶ yankı ───┤
             (prosedürel stereo IR)   highpass/lowpass
                                      ▶ kompresör ─▶ hoparlör
```

- **Neden offscreen?** Manifest V3 servis çalışanlarında `AudioContext` ve
  `getUserMedia` yoktur. Ses işleme, `USER_MEDIA` + `AUDIO_PLAYBACK` gerekçeleriyle
  oluşturulan gizli bir belgede yapılır.
- **Impuls yanıtı:** Sönümlenen stereo gürültü ve erken yansımalardan her açılışta
  üretilir; dosya indirmek gerekmez. Her kanalın enerjisi normalize edilir.
- **Preset geçişi:** İki convolver arasında 180 ms'lik çapraz geçiş yapılır; ses
  kesilmez. Yoğunluk değişimleri de yumuşak rampalarla uygulanır.
- **Tek akış kuralı:** Chrome aynı anda tek offscreen belgesine izin verir. Yeni
  sekmede başlatmak eski yakalamayı kapatır; stream kimliği tek kullanımlıktır.

## Dosya yapısı

```text
konser-modu/
├─ manifest.json      Uzantı tanımı, izinler, kısayol
├─ background.js      Durum, tabCapture akışı, offscreen yönetimi
├─ audio-engine.js    Prosedürel IR, convolver, preset ve yoğunluk motoru
├─ offscreen.html     Gizli ses belgesi
├─ offscreen.js       getUserMedia, AudioContext ve yaşam döngüsü
├─ popup.html         Türkçe arayüz
├─ popup.css          Açık/koyu tema, animasyonlar
├─ popup.js           UI mantığı ve arka planla haberleşme
├─ icons/             16/32/48/128 px simgeler
└─ README.md
```

## Sorun giderme

- **Ses gelmiyor:** Sekmenin gerçekten ses çaldığından emin olun. Yakalama
  başladıysa Chrome'un sekme yakalama göstergesi görünür; ses, eklenti grafiği
  üzerinden gelir. Başka bir eklenti de sesi yakalıyorsa çakışabilir.
- **"Bu sayfada çalışmaz":** `chrome://` sayfaları, uzantı sayfaları ve Chrome Web
  Store yakalanamaz. Normal bir web sekmesi açın.
- **Sessiz kalıyor:** Ses sekmesini yenileyip tekrar deneyin. DRM korumalı
  içeriklerde tarayıcı ses akışını vermeyebilir.
- **Kısayol çalışmıyor:** Başka bir uzantı `Alt+Shift+C` kullanıyor olabilir.
  `chrome://extensions/shortcuts` üzerinden değiştirin.
- **Efekt takıldı:** Uzantıyı `chrome://extensions` sayfasından yenileyin veya
  sekmeyi kapatın; yakalama kendiliğinden biter.

## Gizlilik

Ses akışı yalnızca bellekte işlenir; kaydedilmez, saklanmaz ve hiçbir sunucuya
gönderilmez. Eklentinin ağ isteği yoktur. Yakalanan ses, Web Audio grafiğinden
doğrudan hoparlöre/çıkış cihazına yönlendirilir.
