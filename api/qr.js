/**
 * ডাইনামিক ডাউনলোড-লিঙ্ক QR: যে হোস্ট থেকে ডাকা হয়, সেই হোস্টেরই
 * /bajardor.apk লিঙ্কের QR কোড তৈরি করে — তাই কাস্টম ডোমেইনেও কাজ করে।
 */
module.exports = function handler(req, res) {
  const host = (req.headers && (req.headers.host || req.headers['x-forwarded-host'])) || '';
  const proto = (req.headers && req.headers['x-forwarded-proto']) || 'https';
  const apkUrl = `${proto}://${host}/bajardor.apk`;
  const qr = 'https://api.qrserver.com/v1/create-qr-code/?size=360x360&margin=12&data=' + encodeURIComponent(apkUrl);
  res.setHeader('Cache-Control', 'public, max-age=86400');
  return res.redirect(302, qr);
};
