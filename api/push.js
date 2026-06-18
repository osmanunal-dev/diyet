// /api/push  — mesaj bildirimi gönderir (FCM HTTP v1, firebase-admin)
// Vercel ortam değişkenleri: FIREBASE_SERVICE_ACCOUNT (servis hesabı JSON'u, tek satır)
const admin = require('firebase-admin');

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT))
  });
}
const db = admin.firestore();

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST kullan' }); return; }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const { idToken, hedefUid, baslik, govde, link } = body;
    if (!idToken || !hedefUid) { res.status(400).json({ error: 'idToken ve hedefUid gerekli' }); return; }

    // gönderen kimliğini doğrula
    const decoded = await admin.auth().verifyIdToken(idToken);
    const caller = decoded.uid;

    // yetki: caller admin mi / hedefin diyetisyeni mi / hedef caller'ın diyetisyeni mi
    const [callerDoc, hedefDoc] = await Promise.all([
      db.doc('kullanicilar/' + caller).get(),
      db.doc('kullanicilar/' + hedefUid).get()
    ]);
    const cRol = callerDoc.exists ? callerDoc.data().rol : null;
    const izin =
      cRol === 'admin' ||
      (hedefDoc.exists && hedefDoc.data().olusturan === caller) ||      // diyetisyen -> danışan
      (callerDoc.exists && callerDoc.data().olusturan === hedefUid);    // danışan -> diyetisyen
    if (!izin) { res.status(403).json({ error: 'yetki yok' }); return; }

    // hedefin cihaz token'ları
    const snap = await db.collection('kullanicilar/' + hedefUid + '/pushTokens').get();
    const tokens = snap.docs.map(d => d.data().token).filter(Boolean);
    if (!tokens.length) { res.status(200).json({ ok: true, sent: 0 }); return; }

    const r = await admin.messaging().sendEachForMulticast({
      tokens,
      data: {
        baslik: String(baslik || 'Yeni mesaj'),
        govde: String(govde || ''),
        link: String(link || '/'),
        tag: 'msg'
      }
    });

    // geçersiz token'ları temizle
    const sil = [];
    r.responses.forEach((resp, i) => {
      if (!resp.success) {
        const code = resp.error && resp.error.code ? resp.error.code : '';
        if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
          sil.push(snap.docs[i].ref.delete());
        }
      }
    });
    await Promise.allSettled(sil);

    res.status(200).json({ ok: true, sent: r.successCount });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
