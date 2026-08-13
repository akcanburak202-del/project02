# Nöbet Çizelgesi

Acil serviste çalışan doktorlar için, ay içindeki nöbet saatlerini **dört ayrı
etikette eşit dağıtan** çizelge aracı:

| Etiket | Anlamı |
|---|---|
| Hafta içi paylaşımsız | Hafta içi, hastanede tek başına geçen saatler |
| Hafta içi paylaşımlı | Hafta içi, başka bir doktorla birlikte geçen saatler |
| Hafta sonu paylaşımsız | Hafta sonu / resmî tatil, tek başına |
| Hafta sonu paylaşımlı | Hafta sonu / resmî tatil, birlikte |

Bir ayda tam eşitlik matematiksel olarak mümkün değilse (bir nöbet ikiye
bölünemez), fark **devir defterine** yazılır ve sonraki aylarda kapatılır.

---

## Hızlı başlangıç

Kurulum gerektirmez; hiçbir harici paket kullanılmaz. Node.js 20 veya üzeri yeterlidir.

```bash
node server/index.js
```

Tarayıcıdan `http://localhost:4173` adresine gidin. İlk çalıştırmada bir yönetici
hesabı oluşturulur ve kullanıcı adı/parola ekrana yazılır (varsayılan
`admin` / `nobet2026`). İlk girişte parola değiştirmeniz istenir.

Denemek için örnek kadro yüklemek isterseniz:

```bash
node server/seed.js --demo    # 8 doktor, parolaları: nobet2026
```

Testler:

```bash
npm test                      # 38 test: motor, adalet hesabı ve uçtan uca API
```

Kendi ortam ayarlarınız:

| Değişken | Varsayılan | Açıklama |
|---|---|---|
| `PORT` | `4173` | Dinlenecek port |
| `HOST` | `0.0.0.0` | Dinlenecek adres |
| `NOBET_DATA_DIR` | `./data` | Veri klasörü |
| `NOBET_ADMIN_USER` / `NOBET_ADMIN_PASS` | `admin` / `nobet2026` | İlk yönetici hesabı |

---

## Nasıl kullanılır — tipik aylık akış

**1. Kadroyu tanımla** (bir kez) — *Doktorlar* sekmesi.
Her doktora bir hesap açın. Kısa kod (D01, D02…) çizelgede görünen etikettir.
Sistemi kullanmaya geçmişten devam ederek başlıyorsanız, her doktorun
**açılış devri** alanına geçmiş fazla/eksik saatlerini girebilirsiniz.

**2. Ayı oluştur** — üst çubuktaki **+ Ay**.
Aktif doktorlar otomatik olarak listeye eklenir.

**3. Tercihleri topla.**
Doktorlar kendi hesaplarıyla girip takvimde gün işaretler:

- **İstiyorum** — mümkünse bu güne yaz
- **İstemiyorum** — mümkünse yazma *(eşit dağılımı bozmadığı sürece karşılanır)*
- **İzinliyim** — kesin kural, o güne asla nöbet yazılmaz ve aylık hedefi düşer

Telefonla gelen istekleri *Tercihler* sekmesinden doktor adına siz de
işaretleyebilirsiniz. Tercih girişini aynı ekrandan kapatabilirsiniz.

**4. Katılımı gözden geçir** — *Katılım* sekmesi.
Bu ay kimin görev alacağını, kimin ayın 15'inde ayrılıp kimin 20'sinde
katılacağını buradan girersiniz. Hedef saatler görev süresiyle orantılı
hesaplanır: yarım ay görev alan, yaklaşık yarım pay alır.

**5. Çizelgeyi üret** — *Çizelge* sekmesi → **Çizelgeyi üret**.
Saniyeler içinde hazırlanır. Sağ paneldeki **Denge** ve **Uyarılar** kutuları
sonucun kalitesini anında gösterir.

**6. Elle rötuş.**
Bir nöbete tıklayın: atanabilecek doktorlar, atanamayanların **nedeni**
(dinlenme yetersiz, aynı saatte başka nöbeti var, izinli…) ve her seçimin
dengeye etkisi listelenir. İki nöbeti karşılıklı değiştirmek için **Takas**
düğmesini kullanın — geçersiz takaslar gerekçesiyle reddedilir.

**7. Yayınla.** Doktorlar kendi hesaplarından nöbetlerini görmeye başlar.

**8. Ay bitince Kesinleştir.**
Hedeften sapmalar devir defterine işlenir ve sonraki ayın hedefleri
kendiliğinden buna göre kaydırılır.

---

## Ay ortasında revizyon

Ayın 19'unda liste değişecekse, 19'una kadar uygulanmış plan **aynen kalmalıdır**.
Araç bunu doğrudan destekler:

1. *Çizelge* → **Yeniden planla**
2. **"Belirli bir tarihten itibaren yeniden planla"** seçeneği → tarih: 19
3. **"Öncesini dondur"** kutusu işaretli kalsın

Sonuç: 1–18 arası hiç değişmez (ve kilitlenerek yanlışlıkla değiştirilmesi
engellenir), yalnızca 19–31 arası yeniden düzenlenir. **Donmuş günlerde
çalışılan saatler denge hesabına dahil edilmeye devam eder**, dolayısıyla ayın
kalanı bu gerçeği telafi edecek şekilde planlanır.

Tek tek nöbetleri korumak için nöbete tıklayıp **Sabitle** diyebilirsiniz;
sabitlenen nöbet yeniden üretimde yerinde kalır.

---

## Ayarlar

**Vardiya düzeni.** Varsayılan düzen kullanıcının tarif ettiği şekildedir:

| Vardiya | Giriş | Çıkış | Süre |
|---|---|---|---|
| Gündüz | 09:00 | 24:00 | 15 sa |
| Akşam/Gece | 15:00 | ertesi gün 09:00 | 18 sa |

Kesişim 15:00–24:00 olduğundan gündüz doktoru 6 sa paylaşımsız + 9 sa
paylaşımlı, gece doktoru 9 sa paylaşımlı + 9 sa paylaşımsız çalışır.

Hafta içi ve hafta sonu için ayrı düzen tanımlanabilir; hazır şablonlar
(2'li ve 3'lü düzenler) tek tıkla uygulanır. Ertesi güne taşan çıkış saati
`09:00+1` biçiminde yazılır. Kaydetmeden önce sistem **24 saatin boşluksuz
kapsandığını** denetler; kapsama boşluğu bırakan bir düzen kaydedilemez.
Alışılmadık giriş saatleri (örneğin gece 03:00) uyarı üretir.

**Çalışma kuralları.** İki nöbet arası en az dinlenme (varsayılan 12 saat),
üst üste en fazla kaç gün nöbet tutulabileceği (varsayılan 2), aylık nöbet üst
sınırı ve devir telafi oranı.

**Öncelikler.** Tercihlere verilen ağırlık düşük/normal/yüksek seçilebilir.
Yüksekte istenmeyen günler daha kararlı korunur, karşılığında saat dağılımında
birkaç saatlik sapma oluşabilir. *İzin* işaretleri bu ayardan etkilenmez —
her zaman kesindir.

**Resmî tatiller.** Eklenen günler hafta sonu gibi değerlendirilir ve o günün
saatleri "hafta sonu" etiketiyle sayılır.

---

## Nasıl çalışıyor

### Saat etiketleri atamadan bağımsızdır

Bir nöbetin kaç saatinin paylaşımlı olduğu, o nöbete *kimin* atandığına bağlı
değildir; yalnızca vardiya saatlerinin kesişmesine bağlıdır. Çünkü her nöbet
mutlaka bir doktorla dolar ve aynı doktor kesişen iki nöbete atanamaz.

Bu nedenle her nöbetin dört etiketli saat dağılımı, ay başında **bir kez**
tarama (sweep-line) yöntemiyle kesin olarak hesaplanır. Geriye "bu sabit
vektörleri doktorlara adilce dağıtma" problemi kalır — bu da hem hızlıdır hem
de saat hesabında hiçbir yaklaşıklık içermez.

Saat etiketi, saatin **gerçek takvim damgasına** göre verilir: Cuma 15:00'te
başlayıp Cumartesi 09:00'da biten nöbetin 15:00–24:00 kısmı hafta içi,
00:00–09:00 kısmı hafta sonu sayılır. Ayın son gecesi ertesi aya taşar; o
saatler de eksiksiz hesaplanır.

### Adalet ve devir

Hedef = *toplam saat × (doktorun müsait gün oranı × yük katsayısı) / toplam ağırlık*

Kesinleştirmede her doktor için `gerçek − adil pay` farkı devir defterine
eklenir. Yeni ay planlanırken hedefler bu birikim kadar **ters yönde** kaydırılır,
böylece borç kapanır. Defterin toplamı her zaman sıfırdır — kimsenin fazlası
başkasının eksiği demektir. Bir ayda kapatılacak miktar "devir telafi oranı"
ile sınırlandırılır ki tek bir ay aşırı dengesizleşmesin.

Devir, geçmiş **kesinleşmiş** ayların farkları toplanarak her seferinde yeniden
hesaplanır. Bu yüzden eski bir ayı yeniden açmak hedefleri bozmaz ve
"kesinleştirmeyi geri al" güvenlidir.

### Çözücü

Sert kurallar hiçbir zaman ihlal edilmez: müsaitlik, izin, görev başlangıç/bitiş
tarihi, dinlenme süresi, aynı anda iki nöbet, üst üste gün sınırı, aylık üst sınır.

Yumuşak hedefler en aza indirilir: dört etiketin hedeften sapması (kareli ceza),
tercihler, nöbet/gece/hafta sonu sayılarının dengesi ve nöbetlerin aya
dengeli yayılması.

Yöntem: en kısıtlı nöbetten başlayan açgözlü ilk çözüm + tavlama benzetimi ile
yerel arama. **Aynı girdi ve aynı tohum her zaman aynı çizelgeyi üretir**;
sonuç denetlenebilir ve tekrar üretilebilirdir. Farklı bir alternatif görmek
için "Gelişmiş" bölümünden tohumu değiştirebilirsiniz.

Kadro çok darsa çözücü bir nöbeti boş bırakmak yerine dinlenme/üst üste gün
kurallarını gevşetir, ancak bunu **her zaman uyarı olarak bildirir** — sessizce
kural çiğnemez.

---

## Veri ve yedekleme

Tüm veri tek bir dosyada tutulur: `data/db.json`. Yedeklemek için dosyayı
kopyalamak yeterlidir. Yazma işlemleri geçici dosya + yeniden adlandırma ile
atomik yapılır; yarım yazılmış dosya oluşmaz. Bozuk bir dosya tespit edilirse
üzerine yazılmaz, `data/backups/` altına kopyalanır.

Veriyi sıfırlamak (önce otomatik yedek alır):

```bash
npm run reset -- --evet
```

Parolalar `scrypt` ile saltlanarak saklanır. Oturumlar bellekte tutulur,
sunucu yeniden başladığında kullanıcılar tekrar giriş yapar.

> Sunucuyu kurum ağı dışına açacaksanız önüne HTTPS sonlandıran bir ters
> vekil (nginx, Caddy) koyun. Oturum çerezi `X-Forwarded-Proto: https`
> başlığını gördüğünde `Secure` olarak işaretlenir.

---

## Dosya düzeni

```
engine/          Çizelge motoru (arayüzden ve sunucudan bağımsız, saf hesap)
  time.js        Saat ayrıştırma; gece yarısını aşan vardiyalar
  calendar.js    Ay günleri, hafta sonu ve tatil tespiti
  slots.js       Nöbet üretimi + dört etiketli saat hesabı (sweep-line)
  fairness.js    Ağırlıklar, hedefler, devir defteri
  scheduler.js   Sert kurallar, maliyet fonksiyonu, çözücü
  index.js       Motor giriş noktası
server/          HTTP sunucusu ve REST API (harici bağımlılık yok)
public/          Tarayıcı arayüzü (derleme adımı yok)
test/            38 test — motor, adalet hesabı ve uçtan uca API
```
