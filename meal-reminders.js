// /api/meal-reminders  — yaklaşan öğünler için push gönderir
// HARİCİ bir zamanlayıcı (ör. cron-job.org) ile her ~15 dk'da bir çağrılmalı:
//   GET https://<alan>.vercel.app/api/meal-reminders?key=CRON_SECRET
// Vercel ortam değişkenleri: FIREBASE_SERVICE_ACCOUNT, CRON_SECRET, (ops.) HATIRLATMA_PENCERE
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}
const db = admin.firestore();

const PENCERE = Number(process.env.HATIRLATMA_PENCERE || 15); // dakika
function saatToMin(s) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '')); return m ? (+m[1]) * 60 + (+m[2]) : null; }
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
    const snap = await db.collection('kullanicilar').where('rol', '==', 'danisan').get();
    let gonderim = 0;

    for (const d of snap.docs) {
      const data = d.data();
      const liste = ((data.diyet && data.diyet.gunler) || {})[gunAdi] || [];
      if (!liste.length) continue;

      const due = [];
      liste.forEach((m, i) => {
        const t = saatToMin(m.saat);
        if (t != null && t - dakika >= 0 && t - dakika <= PENCERE) due.push({ i, m, anahtar: i + '@' + m.saat });
      });
      if (!due.length) continue;

      // aynı öğünü iki kez göndermemek için günlük log
      const logRef = db.doc('kullanicilar/' + d.id + '/hatirlatmaLog/' + iso);
      const logSnap = await logRef.get();
      const gonderilen = (logSnap.exists && logSnap.data().idx) || [];
      const yeni = due.filter(x => !gonderilen.includes(x.anahtar));
      if (!yeni.length) continue;

      const tokSnap = await db.collection('kullanicilar/' + d.id + '/pushTokens').get();
      const tokens = tokSnap.docs.map(t => t.data().token).filter(Boolean);
      if (tokens.length) {
        for (const x of yeni) {
          await admin.messaging().sendEachForMulticast({
            tokens,
            data: {
              baslik: (x.m.ad || 'Öğün') + ' zamanı yaklaşıyor',
              govde: (x.m.saat || '') + ' · ' + String(x.m.icerik || '').slice(0, 80),
              link: '/',
              tag: 'meal-' + x.i
            }
          });
          gonderim++;
        }
      }
      await logRef.set({ idx: [...gonderilen, ...yeni.map(x => x.anahtar)] }, { merge: true });
    }

    res.status(200).json({ ok: true, gonderim, gun: gunAdi, saat: hm });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
