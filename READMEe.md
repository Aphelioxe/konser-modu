# Bir Soru, Bir Yıl — Eren'in kilitli günlüğü

Her gün tek bir kişisel soru. Yaz, kaydet ve istediğin zaman PIN'inle oku.

## Nasıl açılır?

Masaüstündeki **Bir Soru, Bir Yıl** kısayoluna çift tıkla. İlk açılışta 4-8 haneli bir PIN belirle. Her yeni açılışta bu PIN istenir.

## Nasıl çalışır?

- 130 soruluk havuz Eren'in hayatına göre hazırlandı: 10. sınıf, okul, satranç, arkadaşlarla oyunlar, anime önerileri, Kastamonu, büyüme ve aklının köşesindeki kişi (isim yok).
- Sorular uygulama dosyalarında düz metin olarak durmaz; şifreli bir hazineden yalnızca o günün sorusu çözülür.
- **Bugün** sekmesinde yalnızca bugünün sorusu görünür. Önceki/sonraki soru, atlama veya cevap düzenleme yoktur.
- **Kaydet** denince cevap, PIN'inden türetilen anahtarla **AES-256-GCM** kullanılarak şifrelenir. Anahtar yalnızca bellekte tutulur ve günlük kilitlenince silinir.
- **Günlüğüm** sekmesi yalnızca kaydettiğin sayfaları listeler. PIN ile açtığın sürece cevapları istediğin zaman okuyabilirsin.
- Kaydetmeden sayfayı kapatırsan yazdıkların saklanmaz; kapatmadan önce tarayıcı seni uyarır.
- Aynı gün için tek kayıt tutulur; kaydettikten sonra o günün sayfası "Kaydedildi" olarak görünür.

## Güvenlik

- PIN, PBKDF2-SHA256 ile 600.000 iterasyon kullanılarak anahtara dönüştürülür. PIN'in kendisi saklanmaz; yalnızca doğrulama için şifreli bir kontrol kaydı tutulur.
- Kayıtlar tarayıcının `localStorage` alanında şifreli olarak saklanır; hiçbir sunucuya gönderilmez.
- **PIN'ini unutursan** kayıtlar açılamaz. "PIN'i unuttum" seçeneği PIN, kayıtlar ve tüm günlük verilerini siler.
- Tarayıcı verilerini temizlersen PIN ve kayıtlar da silinir. Şifreli kayıtların tarayıcı dışında bir yedeği yoktur.
- Gizli/incognito sekmede kalıcı olarak saklanmaz.

## Eski sürümden geçiş

- Daha eski, düz metin kayıtlar ilk kurulumda yeni PIN'inle şifrelenir ve **Günlüğüm**'de okunabilir.
- Önceki sürümde "Mühürle" ile oluşturulan kayıtlar, o sürümde anahtar atıldığı için **geri açılamaz**. Bu kayıtlar silinmez; Günlüğüm'de kaç tanesinin okunamadığına dair bir not görünür. Bu sürümden sonra kaydedilenler PIN'inle okunabilir.

## Dosyalar

- `index.html` — arayüz
- `style.css` — tamamen siyah görünüm
- `app.js` — kilit, PIN anahtarı, kayıt, Günlüğüm ve eski veri geçişi mantığı
- `vault.js` — şifrelenmiş 130 soruluk havuz (düz metin soru listesi yoktur)
- `favicon.svg` — siyah uygulama simgesi
