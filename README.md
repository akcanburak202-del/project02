# Nöbet Çizelgesi

Acil serviste çalışan doktorlar için, ay içindeki nöbet saatlerini **dört ayrı
etikette eşit dağıtan** çizelge aracı:

| Etiket | Anlamı |
|---|---|
| Fiilî mesai (hafta içi / hafta sonu) | Bulunma saatinin, o an görevli doktor sayısına bölünmüş hâli — **birincil ölçüt** |
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
npm test                      # 89 test: motor, saat planı, kurallar, adalet ve uçtan uca API
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

**İzin ve raporu yalnızca siz girersiniz** — *Tercihler* sekmesinde ilgili
hücreye tıklayarak ya da *Katılım* sekmesindeki "İzin ekle" ile. İzin kesin
kuraldır: o güne asla nöbet yazılmaz ve doktorun aylık hedefi düşer.
Telefonla gelen istek/istememe taleplerini de aynı ekrandan doktor adına
işaretleyebilir, tercih girişini oradan kapatabilirsiniz.

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

## Giriş ve çıkış saatlerini araç belirler

**Bu, aracın eşitliği sağlayabilmesinin anahtarıdır.**

Saatler sabitlenirse (ör. her gün 09:00–24:00 ve 15:00–09:00) her nöbetin dört
etikete katkısı da sabitlenir. O zaman bir doktorun "hafta içi paylaşımlı"
toplamı ancak 9'un katları olabilir; hedef 47,3 saat ise **tutturulamaz**.
Eşitlik algoritmanın değil, yapının sınırıdır.

Bu yüzden devir ve geliş/çıkış saatleri birer **karar değişkenidir**. Yönetici
makul aralıkları ve tercih edilen saati tanımlar; araç bu aralıklar içinde gün
gün oynayarak dört etiketi eşitler.

Varsayılan tercih değerleri tam olarak klasik düzeni verir — 09:00 devir,
15:00 geliş, 24:00 çıkış — yani araç bu düzenden **yalnızca eşitlik için
gerektiği kadar** sapar.

### Ölçülen fark

8 doktor, Ağustos 2026 (31 gün, 62 nöbet), aynı kurallar:

| | Sabit saatler | Saatleri araç belirler |
|---|---|---|
| Ortalama mutlak sapma | 2,51 sa | **0,42 sa** |
| Hafta içi paylaşımlı yayılım | 9,0 sa | **1,0 sa** |
| Toplam saat yayılımı | 9,0 sa | **0,5 sa** |
| Nöbet sayıları | 7–9 | **7–8** (teorik minimum) |
| Üretim süresi | 0,1 sn | 1,9 sn |

### Model

Bir günde k doktor görev alır. Günün iskeleti şu değişkenlerle tanımlanır:

- `h[d]` — sabah devri: gündüz ekibi gelir, gece ekibi çıkar
- geliş saatleri — 2 … k'ncı vardiyaların hastaneye giriş saati
- çıkış saatleri — 1 … (k−1)'inci vardiyaların çıkış saati

Son vardiya, ertesi günün devir saatine kadar sürer. Böylece 24 saat
kesintisiz kapanır ve ardışık vardiyaların kesişimi paylaşımlı mesaiyi
oluşturur.

*Ayarlar → Vardiya düzeni* ekranından her pencere için **en erken / tercih
edilen / en geç** değerlerini girersiniz. Araç, girişleri asla bu aralıkların
dışına taşımaz — gece 03:00 gibi saatler yapısal olarak imkânsızdır.

**Saat esnekliği** ayarı ne kadar oynayacağını belirler:

| Ayar | Davranış |
|---|---|
| Kapalı | Saatler hep tercih edilen değerde. En öngörülebilir, eşitlik en zayıf. |
| Az | Nadiren ve az oynar. |
| Ölçülü *(varsayılan)* | Eşitlik için gerektiği kadar oynar. |
| Serbest | Eşitlik önce gelir; saatler gün gün daha çok değişir. |

Mevzuat sabit saat gerektiriyorsa *Ayarlar → Vardiya düzeni → **Saatler
sabit*** seçeneğiyle eski davranışa dönebilirsiniz; o zaman eşitsizlik devir
defterine yazılıp sonraki aylarda kapatılır.

Üretilen saatler çizelgeyle birlikte kaydedilir; ay yeniden açıldığında
değişmez. Vardiya düzeni ayarları değiştirilirse kesinleşmemiş ayların saat
planı sıfırlanır ve yeniden üretim beklenir.

---

## Fiilî mesai — asıl dengelenen büyüklük

Hastanede geçirilen bir saatin iş yükü, **o an görevli doktor sayısına
bölünür**. Tek başınayken 1 saat = 1 saat; iki kişiyken 1 saat = 0,5 saat.

Bu ölçütün belirleyici özelliği şudur:

> **Günlük toplam fiilî mesai, vardiya düzeni ne olursa olsun tam 24 saattir.**

Çünkü her an serviste bir birimlik iş vardır ve kaç kişiyse aralarında
bölüşürler:

| Düzen | Hastanede bulunma | Fiilî mesai |
|---|---|---|
| Tek nöbetçi 24 sa | 24 sa | 24,0 |
| Klasik ikili 09–24 / 15–09 | 33 sa | 10,5 + 13,5 = **24,0** |
| İki kişi de 09–09 | 48 sa | 12,0 + 12,0 = **24,0** |
| Üçlü kademeli | 37 sa | 8,3 + 5,8 + 9,8 = **24,0** |

Havuz sabit olduğu için — bulunma saatinin aksine — fiilî mesai gerçekten
eşitlenebilir. Bu yüzden **birincil adalet ölçütü budur**; hastanede bulunma
saatleri ikincil olarak gözetilir ve ayrıca raporlanır.

Ayın toplam havuzunun tam 24 × gün sayısı kalması için ayın ilk ve son devir
saati sabit tutulur; aradaki günlerin devir saati serbestçe optimize edilir.

**Ölçülen sonuç** (8 doktor, Ağustos 2026):

| | Yayılım |
|---|---|
| Fiilî mesai | **0** (herkes 93,0 sa) |
| Hastanede bulunma | 0,5 sa |
| Nöbet sayısı | 7 / 8 (teorik minimum) |

---

## Gün desenleri — esnekliği öngörülebilir kılan yapı

Çizelge ne kadar esnek olursa fiilî mesai o kadar iyi eşitlenir. Ama sınırsız
esneklik, listeyi hazırlayanın sonucu öngörememesi demektir: "Bu gün kaç kişi
olacak?" sorusunun cevabı her ay sürpriz olursa araç güvenilir olmaz.

Çözüm: esneklik serbest değil, **adlandırılmış bir kümeden** seçilir.

- Yönetici bir **gün deseni kütüphanesi** tanımlar (Ayarlar → Vardiya düzeni).
- Her günün hangi deseni kullanacağını yönetici seçer; takvimde her gün,
  kullandığı desenin adıyla etiketlenir.
- Kütüphanede olmayan bir düzen asla ortaya çıkmaz.
- Kütüphane tek desene indirilirse sonuç tamamen öngörülebilir olur.

Yani **günün şekli insanın kararı** (kadro kararı), **saatler ve kimin nöbet
tutacağı aracın işi** (matematik problemi).

### Hazır desenler

| Desen | Vardiyalar | Fiilî mesai |
|---|---|---|
| Klasik ikili | 09:00–24:00 + 15:00–09:00⁺ | 10,5 + 13,5 |
| İki kişi tam gün | 09:00–09:00⁺ × 2 | 12 + 12 |
| Tek nöbetçi 24 saat | 09:00–09:00⁺ | 24 |
| Tam gün + gündüz desteği | 09:00–09:00⁺ ve 10:00–19:00 | 19,5 + 4,5 |
| Üçlü kademeli | 09–20, 14–24, 20–09⁺ | 8 + 5 + 11 |

Bir desen, günün devir saatinden ertesi günün devir saatine kadarki döngüyü
kapsayan vardiya listesidir. Vardiya uçları `devir`, `devir+1` ya da esnek bir
saat penceresi olabilir; araç pencereler içinde oynayarak dengeyi kurar.
Kaydetmeden önce her desen, **en olumsuz saat kombinasyonuyla** kapsama
boşluğuna karşı denetlenir.

Bir güne tıklayıp desenini değiştirdiğinizde, seçenekler üreteceği fiilî mesai
dağılımıyla birlikte gösterilir — seçmeden önce sonucu görürsünüz.
"Tümüne uygula" ile ayın tüm hafta içi veya hafta sonu günlerine yayabilirsiniz.

> Not: Uç desenler (örneğin tek nöbetçi 24 saat) eşitliği zorlaştırır — 24
> saatlik tek parça iş yükü bölünemez. Karışık desenli bir ayda fiilî mesai
> yayılımı 0 yerine 2–3 saate çıkabilir; fark yine devir defterine yazılır.

### Desen öner — araç arar, siz karar verirsiniz

Desenleri tek tek denemek yerine araç kombinasyonları kendisi tarayabilir:
çizelge ekranında **"Desen öner"**.

Bunun somut bir faydası var. Desen seçimi ayın **toplam nöbet sayısını**
değiştirir, bu da nöbetlerin doktorlara tam bölünüp bölünmediğini belirler.
8 doktor, Ağustos 2026 ölçümü:

| Yapılandırma | Nöbet | Kişi başı | Nöbet dağılımı | Fiilî fark |
|---|---|---|---|---|
| Hepsi klasik ikili | 62 | 7,75 | 7,7,8,8,8,8,8,8 | 0,50 sa |
| 2 hafta içi günü üçlü | 64 | 8,00 | **herkes 8** | **0,25 sa** |

Elle bulunması zor, savunması kolay bir kazanç: iki günün düzenini değiştirmek
nöbet sayısını herkeste eşitliyor.

**Ama arama serbest bırakılamaz.** İki koruma var:

1. **Sınırları siz koyarsınız.** Günde en az/en çok kaç doktor bulunacağını
   pencerede belirtirsiniz. Bu bir adalet değil, **hasta güvenliği** kararıdır
   ve araç hasta yoğunluğunu bilmez; sınır dışına çıkan hiçbir öneri üretilmez.
   (Sınırsız bırakılsaydı arama "6 gün tek nöbetçi" gibi çalışma koşullarını
   ağırlaştıran çözümler de önerirdi — ölçümde fiilî fark 0'dan 1,5 saate çıktı.)
2. **Kadro artışı bedava değildir.** Günlük toplam fiilî mesai her zaman 24
   saattir; bir güne doktor eklemek iş yükünü azaltmaz, aynı işi daha çok
   nöbete böler. Puanlamada kadro değişikliği "kişi başı nöbet farkı" olarak
   cezalandırılır: nöbet sayısını tam böldüren küçük bir ekleme kazanabilir,
   büyük bir kadro artışı kazanamaz.

Ayrıca **dondurulmuş günlere ve elle desen seçtiğiniz günlere dokunulmaz**,
ve aynı sonucu veren daha az istisnalı yapılandırma tercih edilir
(öngörülebilirlik).

Sonuç bir tabloda mevcut düzenle yan yana gösterilir: nöbet sayısı, kişi başı
dağılım, fiilî mesai farkı, bulunma saati farkı ve uyarı sayısı. Uygulamak
isteyip istemediğinize siz karar verirsiniz — **arama hiçbir şeyi kendiliğinden
değiştirmez**. Uyguladıktan sonra çizelgeyi yeniden üretmeniz gerekir.

Mevcut düzen zaten sınırlarınız içindeki en iyi düzense araç bunu açıkça söyler
ve öneri üretmez.

---

## Nöbet sayıları ve kalan denge açıkları

### Nöbet sayısı

Ayın nöbet sayısı doktor sayısına tam bölünmüyorsa **tam eşitlik mümkün
değildir**: 62 nöbet / 8 doktor = 7,75. Bir nöbet ikiye bölünemez, yani
kimileri 7 kimileri 8 nöbet tutacaktır.

Yapılabilecek en iyi şey, kimsenin bu iki değerin dışına çıkmamasıdır ve araç
bunu **sert kural** olarak uygular: her doktorun nöbet sayısı, kendi beklenen
payının tabanı ile tavanı arasında kalmak zorundadır. "Birine 9, ötekine 6"
gibi sonuçlar yapısal olarak imkânsızdır.

| Doktor | Nöbet sayıları | Teorik olarak mümkün olan |
|---|---|---|
| 4 | 15, 15, 16, 16 | 15/16 |
| 6 | 10, 10, 10, 10, 11, 11 | 10/11 |
| 8 | 7, 7, 8, 8, 8, 8, 8, 8 | 7/8 |
| 10 | 6×8, 7, 7 | 6/7 |
| 12 | 5×10, 6, 6 | 5/6 |

Yarım zamanlı ve ay ortasında katılan/ayrılan doktorlarda da aynı kural
işler: pay orantılı hesaplanır, sınır o payın tabanı/tavanı olur.

### Saatler

Nöbet sayısı eşitlenemese bile **saatler eşitlenebilir** — çünkü giriş/çıkış
saatleri esnektir. 7 nöbet tutan doktora biraz uzun, 8 nöbet tutana biraz kısa
vardiyalar denk getirilir.

8 doktorlu Ağustos 2026'da fiilî mesai **herkeste 93,0 saat** (sapma sıfır),
hastanede bulunma 121,5–122 saat.

### Bulunma saatinde neden tam sıfır değil

Üç yapısal sınır kalıyor:

1. **Zaman ızgarası.** Saatler 30 dakikalık adımlarla seçilir, dolayısıyla en
   küçük ayar birimi yarım saattir. *Ayarlar → Saat adımı*'nı 15 dakikaya
   çekerek yarıya indirebilirsiniz.
2. **Saat değişkenleri iki doktoru birden etkiler.** Sabah devrini bir yarım
   saat öteye almak, gece nöbetçisinin mesaisini uzatırken gündüz
   nöbetçisininkini kısaltır. Yani bir kişinin açığını kapatmak her zaman
   başka birinin dengesini oynatır; sistem sıfır toplamlıdır.
3. **Tercih edilen saatlerden sapma bedeli.** Varsayılan "ölçülü" ayarında
   araç, eşitlik uğruna saatleri sınırsız oynatmaz; öngörülebilirlik ile
   eşitlik arasında denge kurar. *Saat esnekliği: Serbest* seçilirse açık
   daha da kapanır, karşılığında saatler gün gün daha çok değişir.

Kalan yarım saatlik farklar da kaybolmaz: ay kesinleştirildiğinde **devir
defterine** yazılır ve sonraki ayın hedefleri ters yönde kaydırılarak kapatılır.

---

## Çizelge oluşturulurken uyulan kurallar

### Asla çiğnenmeyen (sert) kurallar

1. **İzinli/raporlu günlere nöbet yazılmaz.** Bu işaret kesin kuraldır ve
   doktorun aylık hedef saatini de düşürür.
2. **Görev tarihleri dışına nöbet yazılmaz.** Gece nöbeti ertesi sabaha
   taştığı için, görev bitiş gününde gece nöbeti verilmez.
3. **Aynı gün iki vardiya verilmez.**
4. **Nöbet sayısı, beklenen payın tabanı ile tavanı arasında kalır** — kimse
   ortalamanın bir nöbetten fazla üstüne veya altına inemez.
5. **Üst üste iki gün nöbet verilmez** — iki nöbet arasında en az bir tam
   gün boş kalır. *(Ayarlanabilir: `Üst üste en fazla kaç gün nöbet`,
   varsayılan 1. Bunu 2 yaparsanız ardışık nöbete izin verilir.)*
6. **İki nöbet arası en az 12 saat dinlenme** bırakılır. Önceki aydan
   devreden gece nöbeti de hesaba katılır, yani ayın 1'i planlanırken
   bir önceki ayın son gecesi bilinir. *(Ayarlanabilir.)*
7. **Aylık nöbet üst sınırı** aşılmaz (genel ayardan ya da kişi bazında
   Katılım ekranından verilebilir).
8. **Günün 24 saati boşluksuz kapsanır**, hiçbir nöbet boş bırakılmaz.

Kadro bu kurallar için fazla darsa çizelge yine üretilir; ancak dinlenme veya
üst üste gün kuralı gevşetilen her nöbet **uyarı olarak bildirilir** —
sessizce çiğnenmez. Boş kalan slot da kırmızı uyarı olarak görünür.

> 4 doktorluk kadroya kadar (31 günde kişi başı ~15,5 nöbet) hiçbir kural
> gevşetilmeden eksiksiz çizelge üretildiği testlerle doğrulanmıştır.

### Elden geldiğince gözetilenler (yumuşak hedefler)

- Dört etiketin hedeften sapması (kareli ceza — büyük sapmalar çok daha
  ağır cezalandırılır)
- **Toplam saatin** hedeften sapması — dört kategori tek tek dengeli olsa bile
  sapmalar aynı doktorda aynı yönde birikebildiği için ayrıca gözetilir
- Nöbet, gece ve hafta sonu **sayılarının** dengesi
- "İstemiyorum" günlerinden kaçınmak, "istiyorum" günlerini tercih etmek
- Nöbetlerin aya dengeli yayılması (birbirine yakın nöbetler cezalandırılır)
- **Haftalık yoğunluk** — 7 günlük kayan pencerede adil payın üzerine nöbet
  yığılmaması (aşağıya bakınız)
- **Aylar arası ritim** — aynı haftagününün ve yoğun haftaların hep aynı kişiye
  denk gelmemesi (aşağıya bakınız)
- Gündüz/gece ağırlıklı çalışma tercihi

Bu kuralların güncel hâli, kendi ayarlarınıza göre yazılmış olarak
**Ayarlar → Çalışma kuralları** ekranının altında da listelenir.

### Yoğunluk ve ritim — saat tablosunda görünmeyen eşitsizlik

Saatler tıpatıp eşit olsa bile o saatlerin **günlere** nasıl düştüğü kişiden
kişiye çok farklı olabilir. İki ayrı sorun var ve ikisi de saat tablosunda
görünmez:

1. **Birinin haftası ağır, birininki hafif.** İki nöbet arasındaki mesafe
   kuralı yalnızca *komşu* iki nöbete bakar; haftanın tamamını görmez. 2-2-2
   günlük aralıklar (bir haftada dört nöbet) ile 2-6-2 aralıkları oradan
   neredeyse aynı görünür, oysa yaşanan yük çok farklıdır.
2. **Aylar boyu hep aynı kişiye denk gelmesi.** Bir ayda her haftagününden
   yalnızca dört-beş tane vardır; hepsini herkese eşit dağıtamazsınız. Bu
   yüzden ölçü ay değil, **aylar** olmalıdır.

**Ölçüm (8 doktor, hiç tercih verisi yok, bu özellikler eklenmeden önce):**

| | önce | sonra |
|---|---|---|
| Bir haftaya düşen en çok nöbet (aylık) | 4 | 3 |
| 12 ayda en büyük haftagünü farkı | **11** (biri 19 çarşamba, biri 8) | **5** |
| 12 ayda yoğun hafta yükü farkı | 7 (3–10) | 3 (6–9) |

Bunun bedeli ölçülebilir düzeyde yok: aylık fiilî mesai yayılımı ortalaması
0,563 sa'ten 0,583 sa'e çıktı, nöbet sayısı dengesi hiç değişmedi.

**Nasıl çalışır.** Geçmiş ayların atamalarından iki büyüklük çıkarılır: kim
hangi haftagününde kaç nöbet tuttu, ve 7 günlük pencerelerde adil payın
üzerine kaç nöbet taştı. Yeni ayın çözümünde, geçmişte ortalamanın üzerinde
yük almış doktor için aynı yönde bir nöbet almak biraz daha pahalıdır. Fark
kendiliğinden kapanır — devir defteriyle aynı mantık, farklı bir büyüklükte.

**Kişinin kendi tercihi her zaman önce gelir.** Bir gün için açık bir tercih
(*istiyorum* / *istemiyorum*) girilmişse ritim yönlendirmesi o gün için devre
dışı kalır. Bu bilinçli bir kural: aksi hâlde ritim, tercihi sessizce iptal
edebiliyordu — ölçümde "hep çarşamba tuttum" geçmişi olan bir doktorun açıkça
istediği dört çarşambanın dördü de elinden alınıyordu.

**Ayrıca saklanan bir defter yok.** Ritim geçmişi, önceki ayların
atamalarından her seferinde yeniden hesaplanır (son 6 ay), böylece defterle
gerçek çizelge birbirinden kayamaz.

Bu tablo **Denge → Ritim** sekmesinde görünür: bu ayın yoğun hafta yükü ve son
ayların haftagünü dağılımı; ortalamadan belirgin sapanlar renklendirilir.

### İzin ve rapor yetkisi

Doktorlar kendi ekranlarından yalnızca **istiyorum** ve **istemiyorum**
işaretleyebilir. **İzin/rapor kaydını sadece yönetici girebilir** —
sunucu, doktordan gelen izin işaretlerini kabul etmez. Yöneticinin girdiği
izin günleri doktorun ekranında kırmızı ve salt okunur görünür; doktor
kendi tercihlerini kaydettiğinde bu kayıtlar silinmez.

---

## Sunucusuz deneme sürümü

Kurulumla uğraşmadan arayüzü denemek için tek dosyalık bir sürüm üretilir:

```bash
node tools/build-demo.js
# demo/nobet-cizelgesi-demo.html
```

Dosyayı çift tıklayıp tarayıcıda açmanız yeterli — sunucu, kurulum ve
internet gerekmez. Motorun tamamı (saat hesabı, adalet, çözücü) tarayıcıda
gerçek hâliyle çalışır; yalnızca depolama katmanı `localStorage`'a alınır.

| | |
|---|---|
| Yönetici | `admin` / `admin` |
| Doktorlar | `d01` / `d01` … `d08` / `d08` |

Demo sürümünün bilinçli sınırları: parolalar düz metindir, veri yalnızca o
tarayıcıda durur ve CSV indirme kapalıdır. Gerçek kullanım için
`node server/index.js` ile çalıştırın.

---

## Ayarlar

**Vardiya düzeni.** Bkz. yukarıdaki *"Giriş ve çıkış saatlerini araç belirler"*
bölümü. Hafta içi ve hafta sonu ayrı tanımlanır; günde kaç doktor görev alacağı
(1–5) buradan seçilir. Sabit modda hazır şablonlar tek tıkla uygulanır ve
kaydetmeden önce **24 saatin boşluksuz kapsandığı** denetlenir.

**Çalışma kuralları.** İki nöbet arası en az dinlenme (varsayılan 12 saat),
üst üste en fazla kaç gün nöbet tutulabileceği (varsayılan 1 — yani ardışık
gün yok), aylık nöbet üst sınırı ve devir telafi oranı. Bu ekranın altında,
o anki ayarlarınıza göre yazılmış kural özeti yer alır.

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
  shiftplan.js   Giriş/çıkış saatlerinin karar modeli (esnek vardiya düzeni)
  patterns.js    Gün desenleri — esnekliği öngörülebilir kılan kütüphane
  rhythm.js      Yoğunluk ve haftagünü hafızası (aylar arası ritim dengesi)
  propose.js     Desen arama ve önerme (uygulama kararı yöneticinin)
  fairness.js    Ağırlıklar, hedefler, devir defteri
  scheduler.js   Sert kurallar, maliyet fonksiyonu, çözücü
  policy.js      Tercih girişi yetki kuralları (izin yalnızca yöneticide)
  index.js       Motor giriş noktası
server/          HTTP sunucusu ve REST API (harici bağımlılık yok)
public/          Tarayıcı arayüzü (derleme adımı yok)
  state.js       Paylaşılan durum; görünümler kabuğa geri bağlanmaz
  demo-api.js    Sunucusuz demo için tarayıcı içi arka uç
tools/           build-demo.js — tek dosyalık sunucusuz sürümü üretir
test/            89 test — motor, saat planı, kurallar, adalet ve uçtan uca API
```
