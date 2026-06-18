// /api/meal-reminders  — yaklaşan ÖĞÜN ve SU hatırlatmalarını push olarak gönderir
// HARİCİ bir zamanlayıcı (ör. cron-job.org) ile her ~15 dk'da bir çağrılmalı:
//   GET https://<alan>.vercel.app/api/meal-reminders?key=CRON_SECRET
// Vercel ortam değişkenleri: FIREBASE_SERVICE_ACCOUNT, CRON_SECRET,
//   (ops.) HATIRLATMA_PENCERE, SU_SAATLERI
const admin = require('firebase-admin');
 
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}
const db = admin.firestore();
 
const PENCERE = Number(process.env.HATIRLATMA_PENCERE || 15); // dakika
const SU_SAATLERI = (process.env.SU_SAATLERI || '10:00,12:30,15:00,17:30,20:00')
  .split(',').map(s => s.trim()).filter(Boolean);
 
function saatToMin(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; }
function suDocMl(d) { if (!d) return 0; return d.ml != null ? d.ml : (d.bardak ? d.bardak * 250 : 0); }
function istBilgi() {
  const now = new Date();
  const gun = new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long' }).format(now);
  const hm  = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul' }).format(now); // yyyy-mm-dd
  const [H, M] = hm.split(':').map(Number);
  const gunAdi = gun.charAt(0).toLocaleUpperCase('tr-TR') + gun.slice(1);
  return { gunAdi, dakika: H * 60 + M, iso, hm };
}
 
module.exports = async (req, res) => {
  const key = (req.query && req.query.key) || (req.headers.authorization || '').replace('Bearer ', '');
  if (!process.env.CRON_SECRET || key !== process.env.CRON_SECRET) { res.status(401).json({ error: 'yetkisiz' }); return; }
  try {
    const { gunAdi, dakika, iso, hm } = istBilgi();
    const suDue = SU_SAATLERI.filter(s => { const t = saatToMin(s); return t != null && t - dakika >= 0 && t - dakika <= PENCERE; });
 
    const snap = await db.collection('kullanicilar').where('rol', '==', 'danisan').get();
    let gonderim = 0;
 
    for (const d of snap.docs) {
      const data = d.data();
      const gorevler = []; // { anahtar, baslik, govde, tag }
 
      // --- ÖĞÜN ---
      const liste = ((data.diyet && data.diyet.gunler) || {})[gunAdi] || [];
      liste.forEach((m, i) => {
        const t = saatToMin(m.saat);
        if (t != null && t - dakika >= 0 && t - dakika <= PENCERE) {
          gorevler.push({
            anahtar: i + '@' + m.saat,
            baslik: (m.ad || 'Öğün') + ' zamanı yaklaşıyor',
            govde: (m.saat || '') + ' · ' + String(m.icerik || '').slice(0, 80),
            tag: 'meal-' + i
          });
        }
      });
 
      // --- SU --- (zamanı gelen su saati varsa ve hedef tutmadıysa)
      if (suDue.length) {
        const suSnap = await db.doc('kullanicilar/' + d.id + '/su/' + iso).get();
        const ml = suSnap.exists ? suDocMl(suSnap.data()) : 0;
        const hedef = data.suHedefMl || (data.suHedef ? data.suHedef * 250 : 2000);
        if (ml < hedef) {
          suDue.forEach(slot => {
            gorevler.push({
              anahtar: 'su@' + slot,
              baslik: 'Su molası',
              govde: 'Bugün ' + (ml / 1000).toFixed(2) + ' / ' + (hedef / 1000).toFixed(1) + ' L. Bir bardak su içmeye ne dersin?',
              tag: 'su'
            });
          });
        }
      }
 
      if (!gorevler.length) continue;
 
      const logRef = db.doc('kullanicilar/' + d.id + '/hatirlatmaLog/' + iso);
      const logSnap = await logRef.get();
      const gonderilen = (logSnap.exists && logSnap.data().idx) || [];
      const yeni = gorevler.filter(g => !gonderilen.includes(g.anahtar));
      if (!yeni.length) continue;
 
      const tokSnap = await db.collection('kullanicilar/' + d.id + '/pushTokens').get();
      const tokens = tokSnap.docs.map(t => t.data().token).filter(Boolean);
      if (tokens.length) {
        for (const g of yeni) {
          await admin.messaging().sendEachForMulticast({
            tokens,
            data: { baslik: g.baslik, govde: g.govde, link: '/', tag: g.tag }
          });
          gonderim++;
        }
      }
      await logRef.set({ idx: [...gonderilen, ...yeni.map(g => g.anahtar)] }, { merge: true });
    }
 
    res.status(200).json({ ok: true, gonderim, gun: gunAdi, saat: hm, suSaatleri: suDue });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
